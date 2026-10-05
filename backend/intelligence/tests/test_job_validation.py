import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.core.errors import IntelligenceError
from app.core.settings import Settings
from app.jobs.evidence import JobEvidenceVerifier
from app.jobs.models import JobRequirements
from app.jobs.service import JobAnalysisService
from app.llm.models import StructuredRequest, StructuredResult
from app.llm.providers.openai import OpenAIProvider
from app.llm.validation import ResponseValidationError
from test_drafts import service
from test_jobs import JobProvider, MemoryJobs, requirements, source


def changed_skill(value, quote):
    return JobRequirements.model_validate({**requirements().model_dump(), "skills": [
        {"value": value, "evidence": [{"section": "description", "quote": quote}]}
    ]})


def test_whitespace_recovery_preserves_original_unicode_offsets_and_priority():
    original = source(source().sections[-1].text + "\nRequired skills:\nPython\tand\nTypeScript")
    result = JobEvidenceVerifier().verify(changed_skill("Python", "Python and TypeScript"), original)
    skill = result.skills[0]
    evidence = skill.evidence[0]
    assert evidence.quote == "Python\tand\nTypeScript"
    assert original.sections[-1].text[evidence.start:evidence.end] == evidence.quote
    assert skill.priority == "required"
    assert skill.priorityEvidence[0].quote == "Required skills:"


@pytest.mark.parametrize("text,quote,reason", [
    ("Python\nand Rust", "Python and TypeScript", "quote_not_in_source"),
    ("Python\nand TypeScript", "TypeScript and Python", "quote_not_in_source"),
    ("Python\nand TypeScript", "Python, and TypeScript", "quote_not_in_source"),
    ("Python\nand TypeScript\nPython\tand TypeScript", "Python and TypeScript", "ambiguous_quote"),
    ("Python" + " " * 6000 + "TypeScript", "Python TypeScript", "quote_limit"),
    ("Python", " \t ", "empty_quote"),
])
def test_whitespace_recovery_never_rewrites_words_or_guesses_ambiguous_offsets(text, quote, reason):
    with pytest.raises(ResponseValidationError) as caught:
        JobEvidenceVerifier.quote(text, {"section": "description", "quote": quote}, "skills.0.evidence.0")
    assert caught.value.reason == reason


def test_evidence_diagnostics_expose_field_and_reason_without_source_text(caplog):
    with pytest.raises(ResponseValidationError) as caught:
        JobEvidenceVerifier().verify(changed_skill("PRIVATE-INVENTED-VALUE", "Python"), source())
    assert caught.value.field == "skills.0" and caught.value.reason == "value_not_in_quote"
    assert "field=skills.0" in caplog.text and "reason=value_not_in_quote" in caplog.text
    assert "PRIVATE-INVENTED-VALUE" not in caplog.text
    assert str(caught.value) == "LLM_RESPONSE_INVALID"


def test_job_retry_recovers_once_saves_one_version_and_counts_both_completed_calls():
    async def run():
        requests = []

        class RecoveringProvider(JobProvider):
            async def generate(self, request):
                requests.append(request)
                value = changed_skill("Rust", "Python") if len(requests) == 1 else requirements()
                return StructuredResult(value, 100, 200)

        drafts, _ = service(RecoveringProvider())
        jobs = JobAnalysisService(drafts.llm, MemoryJobs())
        record = await jobs.analyze(str(uuid4()), source(), "gpt-6-luna", "medium")
        assert len(requests) == 2 and record.version == 1 and len(jobs.repository.records) == 1
        assert record.usage.inputTokens == 200 and record.usage.outputTokens == 400
        assert "skills.0 (value_not_in_quote)" in requests[1].instructions
        assert "Rust" not in requests[1].instructions
        assert requests[0].input == requests[1].input and requests[0].model == requests[1].model
        assert requests[0].reasoning == requests[1].reasoning == "medium"
        assert jobs.llm.gate.active is None

    asyncio.run(run())


@pytest.mark.parametrize("code,expected_calls", [("LLM_RESPONSE_INVALID", 2), ("LLM_REFUSED", 1),
                                                ("LLM_RATE_LIMITED", 1), ("LLM_TIMEOUT", 1),
                                                ("LLM_BUDGET_LIMIT", 1), ("ANALYSIS_UNAVAILABLE", 1)])
def test_retry_is_bounded_and_other_provider_errors_never_retry(code, expected_calls):
    async def run():
        class FailingProvider(JobProvider):
            async def generate(self, _):
                self.calls += 1
                raise IntelligenceError(502, code)

        drafts, provider = service(FailingProvider())
        jobs = JobAnalysisService(drafts.llm, MemoryJobs())
        with pytest.raises(IntelligenceError) as caught:
            await jobs.analyze(str(uuid4()), source(), "gpt-6-luna", "medium")
        assert caught.value.code == code and provider.calls == expected_calls
        assert not jobs.repository.records and jobs.llm.gate.active is None

    asyncio.run(run())


def test_repeated_invalid_evidence_keeps_existing_saved_version():
    async def run():
        drafts, _ = service(JobProvider())
        jobs = JobAnalysisService(drafts.llm, MemoryJobs())
        owner = str(uuid4())
        first = await jobs.analyze(owner, source(), "gpt-6-luna", "medium")

        class InvalidProvider(JobProvider):
            async def generate(self, _):
                self.calls += 1
                return StructuredResult(changed_skill("Rust", "Python"), 100, 200)

        provider = InvalidProvider()
        jobs.llm.providers.register("openai", provider)
        with pytest.raises(IntelligenceError):
            await jobs.analyze(owner, source(), "gpt-6-luna", "medium")
        assert provider.calls == 2 and len(jobs.repository.records) == 1
        assert await jobs.repository.get(owner, source().jobId, source().sha256) == first

    asyncio.run(run())


def test_retry_uses_one_total_deadline_and_cancellation_releases_the_slot():
    async def run():
        second_started = asyncio.Event()

        class SlowRetry(JobProvider):
            async def generate(self, _):
                self.calls += 1
                if self.calls == 1:
                    raise IntelligenceError(502, "LLM_RESPONSE_INVALID")
                second_started.set()
                await asyncio.Future()

        drafts, provider = service(SlowRetry(), Settings(timeout=0.02))
        jobs = JobAnalysisService(drafts.llm, MemoryJobs())
        with pytest.raises(IntelligenceError) as caught:
            await jobs.analyze(str(uuid4()), source(), "gpt-6-luna", "medium")
        assert caught.value.code == "LLM_TIMEOUT" and provider.calls == 2
        assert jobs.llm.gate.active is None and not jobs.repository.records

        second_started.clear()
        drafts, _ = service(SlowRetry())
        jobs = JobAnalysisService(drafts.llm, MemoryJobs())
        pending = asyncio.create_task(jobs.analyze(str(uuid4()), source(), "gpt-6-luna", "medium"))
        await second_started.wait()
        pending.cancel()
        await asyncio.gather(pending, return_exceptions=True)
        assert jobs.llm.gate.active is None and not jobs.repository.records

    asyncio.run(run())


def test_provider_schema_diagnostics_hide_extra_field_names_and_values(caplog):
    async def run():
        async def parse(**_):
            JobRequirements.model_validate({**requirements().model_dump(), "PRIVATE-EXTRA-NAME": "PRIVATE-EXTRA-VALUE"})

        provider = OpenAIProvider("fake-key", 1, SimpleNamespace(responses=SimpleNamespace(parse=parse)))
        with pytest.raises(ResponseValidationError) as caught:
            await provider.generate(StructuredRequest("gpt-6-luna", "medium", "instructions", "PRIVATE-INPUT", JobRequirements, 100))
        assert caught.value.field == "unknown" and caught.value.stage == "schema"
        assert "stage=schema reason=schema_invalid field=unknown" in caplog.text
        assert "PRIVATE" not in caplog.text and "fake-key" not in caplog.text

    asyncio.run(run())


@pytest.mark.parametrize("phases,accepted", [(["commentary", "final_answer"], True),
                                            (["commentary", None], True),
                                            (["final_answer", "final_answer"], False),
                                            (["commentary"], False)])
def test_provider_uses_one_final_result_and_ignores_intermediate_commentary(phases, accepted):
    async def run():
        async def parse(**_):
            return SimpleNamespace(status="completed", usage=None, output_parsed=requirements(), output=[
                SimpleNamespace(type="message", phase=phase, content=[SimpleNamespace(type="output_text")])
                for phase in phases
            ])

        provider = OpenAIProvider("fake-key", 1, SimpleNamespace(responses=SimpleNamespace(parse=parse)))
        request = StructuredRequest("gpt-6-luna", "medium", "instructions", "source", JobRequirements, 100)
        if accepted:
            assert (await provider.generate(request)).value == requirements()
        else:
            with pytest.raises(ResponseValidationError) as caught:
                await provider.generate(request)
            assert caught.value.reason == "final_message_count"

    asyncio.run(run())


def test_token_limit_response_is_a_budget_error_instead_of_retrying_invalid_output():
    async def run():
        async def parse(**_):
            return SimpleNamespace(status="incomplete", usage=None, output_parsed=None, output=[],
                                   incomplete_details=SimpleNamespace(reason="max_output_tokens"))

        provider = OpenAIProvider("fake-key", 1, SimpleNamespace(responses=SimpleNamespace(parse=parse)))
        with pytest.raises(IntelligenceError) as caught:
            await provider.generate(StructuredRequest("gpt-6-luna", "medium", "instructions", "source", JobRequirements, 100))
        assert caught.value.code == "LLM_BUDGET_LIMIT"

    asyncio.run(run())
