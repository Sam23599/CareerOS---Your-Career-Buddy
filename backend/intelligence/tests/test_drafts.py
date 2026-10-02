import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.core.errors import IntelligenceError
from app.core.settings import Settings
from app.llm.models import ModelRegistry, StructuredRequest, StructuredResult
from app.llm.providers.base import LLMProvider, ProviderRegistry
from app.llm.providers.openai import OpenAIProvider
from app.llm.service import LLMService
from app.parsing.models import Extraction
from app.resumes.evidence import EvidenceVerifier
from app.resumes.models import DraftHistory, DraftSummary, ResumeDraft, Source
from app.resumes.service import ResumeDraftService
from app.storage.base import DraftRepository


def fact(value=None, page=1):
    return {"value": value, "evidence": [{"page": page, "quote": value}] if value else []}


def draft():
    return ResumeDraft.model_validate({
        "fullName": fact("Resume Tester"), "headline": fact("Software engineer"), "summary": fact(),
        "location": fact(), "phone": fact(), "email": fact(), "skills": [fact("Python")],
        "technologies": [], "roles": [], "experience": [], "education": [], "certifications": [],
        "projects": [], "links": [], "languages": [], "keywords": [], "careerPreferences": [], "additionalSections": [],
    })


def extraction(text="Resume Tester\nSoftware engineer\nPython"):
    return Extraction.model_validate({"schemaVersion": 1, "parser": {"name": "pypdf", "version": "6.19.0"},
                                     "status": "extracted", "pageCount": 1, "pages": [{"number": 1, "text": text}],
                                     "text": text, "warnings": []})


class MemoryDraftRepository(DraftRepository):
    ready = True

    def __init__(self):
        self.records = {}
        self.deleted = set()

    async def get(self, owner, source, model=None, reasoning=None, analysis_id=None):
        records = [record for (user, _), record in self.records.items() if user == owner and record.source == source
                   and (model is None or (record.model == model and record.reasoning == reasoning))
                   and (analysis_id is None or record.id == analysis_id)]
        return records[-1] if records else None

    async def save(self, owner, record):
        if (owner, record.source.resumeId) in self.deleted:
            raise IntelligenceError(404, "RESUME_NOT_FOUND")
        if (owner, record.id) in self.records:
            return self.records[owner, record.id]
        version = max((item.version for (user, _), item in self.records.items()
                       if user == owner and item.source.resumeId == record.source.resumeId), default=0) + 1
        record = record.model_copy(update={"version": version})
        self.records[owner, record.id] = record
        return record

    async def history(self, owner, source, before_version=None):
        records = sorted((item for (user, _), item in self.records.items() if user == owner and item.source == source
                          and (before_version is None or item.version < before_version)), key=lambda item: item.version, reverse=True)
        versions = [DraftSummary.model_validate({key: getattr(item, key) for key in DraftSummary.model_fields}) for item in records[:20]]
        return DraftHistory(versions=versions, nextBeforeVersion=versions[-1].version if len(records) > 20 else None)

    async def delete(self, owner, resume_id):
        self.deleted.add((owner, resume_id))
        self.records = {key: record for key, record in self.records.items()
                        if key[0] != owner or record.source.resumeId != resume_id}


class FakeProvider(LLMProvider):
    calls = 0

    async def generate(self, request):
        self.calls += 1
        return StructuredResult(draft(), 100, 200)


def service(provider=None, settings=None):
    providers = ProviderRegistry()
    provider = provider or FakeProvider()
    providers.register("openai", provider)
    return ResumeDraftService(LLMService(settings or Settings(), providers, ModelRegistry()), MemoryDraftRepository()), provider


@pytest.mark.parametrize("model,effort", [("gpt-4.1", "medium"), ("gpt-6.1-sol", "none"),
                                           ("gpt-6-luna", "ultra"), ("unknown", None)])
def test_model_options_reject_before_network(model, effort):
    async def run():
        drafts, provider = service()
        with pytest.raises(IntelligenceError) as caught:
            await drafts.llm.generate(model, effort, "instructions", "text", ResumeDraft)
        assert caught.value.code == "INVALID_INPUT"
        assert provider.calls == 0
    asyncio.run(run())


def test_evidence_rejects_wrong_pages_quotes_invented_values_and_substring_skills():
    original = draft().model_dump()
    for changed in [fact("Python", 2), {"value": "Rust", "evidence": [{"page": 1, "quote": "Python"}]},
                    {"value": "Python", "evidence": []}, {"value": None, "evidence": [{"page": 1, "quote": "Python"}]},
                    {"value": "Go", "evidence": [{"page": 1, "quote": "Google"}]}]:
        with pytest.raises(IntelligenceError) as caught:
            EvidenceVerifier().verify(ResumeDraft.model_validate({**original, "skills": [changed]}), extraction("Resume Tester Software engineer Python Google"))
        assert caught.value.code == "LLM_RESPONSE_INVALID"
    EvidenceVerifier().verify(draft(), extraction())
    with pytest.raises(ValidationError):
        ResumeDraft.model_validate({**original, "owner": "foreign"})


def test_successful_analysis_saves_numbered_versions_and_delete_blocks_late_writes():
    async def run():
        drafts, provider = service()
        owner = str(uuid4()); source = Source(resumeId=str(uuid4()), resumeVersion=1, sha256="a" * 64)
        record = await drafts.analyze(owner, source, extraction(), "gpt-6-luna", "medium")
        second = await drafts.analyze(owner, source, extraction(), "gpt-6-luna", "medium")
        assert second.id != record.id and (record.version, second.version) == (1, 2)
        assert provider.calls == 2
        assert await drafts.repository.get(owner, source, analysis_id=record.id) == record
        assert [item.version for item in (await drafts.repository.history(owner, source)).versions] == [2, 1]
        assert await drafts.repository.get(str(uuid4()), source) is None
        assert await drafts.repository.get(owner, source.model_copy(update={"sha256": "b" * 64})) is None
        other = await drafts.analyze(owner, source, extraction(), "gpt-4.1", None)
        assert other.id != record.id and other.version == 3 and provider.calls == 3
        await drafts.repository.delete(owner, source.resumeId)
        assert await drafts.repository.get(owner, source) is None
        with pytest.raises(IntelligenceError) as caught:
            await drafts.repository.save(owner, record)
        assert caught.value.code == "RESUME_NOT_FOUND"
    asyncio.run(run())


def test_failed_analysis_does_not_create_or_consume_a_version():
    async def run():
        class FailingProvider(FakeProvider):
            async def generate(self, request):
                raise IntelligenceError(504, "LLM_TIMEOUT")
        drafts, _ = service(FailingProvider())
        owner = str(uuid4()); source = Source(resumeId=str(uuid4()), resumeVersion=1, sha256="a" * 64)
        with pytest.raises(IntelligenceError):
            await drafts.analyze(owner, source, extraction(), "gpt-6-luna", "medium")
        assert not drafts.repository.records and drafts.active is None
        drafts.llm.providers.register("openai", FakeProvider())
        assert (await drafts.analyze(owner, source, extraction(), "gpt-6-luna", "medium")).version == 1
    asyncio.run(run())


def test_input_budget_rejects_without_truncating_or_calling_provider():
    async def run():
        drafts, provider = service(settings=Settings(max_input_bytes=10))
        with pytest.raises(IntelligenceError) as caught:
            await drafts.llm.generate("gpt-6-luna", "medium", "instructions", "large text", ResumeDraft)
        assert caught.value.code == "LLM_BUDGET_LIMIT" and provider.calls == 0
    asyncio.run(run())


def test_analysis_cancellation_releases_single_slot():
    async def run():
        started = asyncio.Event()
        class SlowProvider(FakeProvider):
            async def generate(self, request):
                started.set()
                await asyncio.Future()
        drafts, _ = service(SlowProvider())
        source = Source(resumeId=str(uuid4()), resumeVersion=1, sha256="a" * 64)
        task = asyncio.create_task(drafts.analyze(str(uuid4()), source, extraction(), "gpt-6-luna", "medium"))
        await started.wait()
        with pytest.raises(IntelligenceError) as caught:
            await drafts.analyze(str(uuid4()), source, extraction(), "gpt-6-luna", "medium")
        assert caught.value.code == "INTELLIGENCE_BUSY"
        task.cancel(); await asyncio.gather(task, return_exceptions=True)
        assert drafts.active is None and not drafts.repository.records
    asyncio.run(run())


@pytest.mark.parametrize("model,effort", [("gpt-4.1", None), ("gpt-6-luna", "none"), ("gpt-6.1-sol", "high")])
def test_openai_adapter_uses_structured_responses_store_false_and_supported_reasoning(model, effort):
    async def run():
        called = {}
        async def parse(**options):
            called.update(options)
            return SimpleNamespace(status="completed", output=[SimpleNamespace(type="message", content=[SimpleNamespace(type="output_text")])],
                                   output_parsed=draft(), usage=SimpleNamespace(input_tokens=10, output_tokens=20))
        provider = OpenAIProvider("fake-key", 1, SimpleNamespace(responses=SimpleNamespace(parse=parse)))
        result = await provider.generate(StructuredRequest(model, effort, "instructions", "text", ResumeDraft, 100))
        assert result.value == draft() and result.output_tokens == 20
        assert called["store"] is False and called["model"] == model and called["text_format"] is ResumeDraft
        assert called.get("reasoning") == ({"effort": effort} if effort else None)
        assert not any(key in called for key in ["temperature", "top_p", "max_tokens"])
        actual = OpenAIProvider("fake-key", 1)
        assert actual.client.max_retries == 0
        await actual.close()
    asyncio.run(run())


@pytest.mark.parametrize("mode,code", [("refused", "LLM_REFUSED"), ("incomplete", "LLM_RESPONSE_INVALID"),
                                        ("missing", "LLM_RESPONSE_INVALID"), ("ambiguous", "LLM_RESPONSE_INVALID"),
                                        ("timeout", "LLM_TIMEOUT"), ("invalid", "LLM_RESPONSE_INVALID")])
def test_openai_failures_are_safe(mode, code):
    async def run():
        async def parse(**_):
            if mode == "timeout":
                raise TimeoutError("private resume and provider details")
            message = SimpleNamespace(type="message", content=[SimpleNamespace(type="refusal" if mode == "refused" else "output_text")])
            return SimpleNamespace(status="incomplete" if mode == "incomplete" else "completed",
                                   output=[message, message] if mode == "ambiguous" else [message],
                                   output_parsed=None if mode == "missing" else {"secret": "private resume"} if mode == "invalid" else draft(), usage=None)
        provider = OpenAIProvider("fake", 1, SimpleNamespace(responses=SimpleNamespace(parse=parse)))
        with pytest.raises(IntelligenceError) as caught:
            await provider.generate(StructuredRequest("gpt-6-luna", "medium", "instructions", "text", ResumeDraft, 100))
        assert caught.value.code == code
        assert "private" not in str(caught.value)
    asyncio.run(run())


def test_pdf_source_hash_mismatch_rejects_before_worker():
    from hashlib import sha256
    from starlette.requests import Request
    from app.parsing.service import ExtractionService

    async def run():
        class Runner:
            calls = 0
            async def run(self, _):
                self.calls += 1
                return extraction().model_dump()
        runner = Runner(); parser = ExtractionService(runner); parser.ready = True
        sent = False
        async def receive():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": b"%PDF-synthetic", "more_body": False}
            await asyncio.Future()
        request = Request({"type": "http", "headers": [(b"content-type", b"application/pdf")]}, receive)
        with pytest.raises(IntelligenceError) as caught:
            await parser.extract(request, sha256(b"different source").hexdigest())
        assert caught.value.code == "INVALID_INPUT" and runner.calls == 0 and parser.active is None
    asyncio.run(run())


def test_shared_llm_service_accepts_a_registered_provider_and_its_capabilities():
    from app.llm.models import ModelCapability

    async def run():
        providers = ProviderRegistry(); provider = FakeProvider()
        providers.register("fixture-provider", provider)
        models = ModelRegistry([ModelCapability("fixture-model", (), "fixture-provider")])
        llm = LLMService(Settings(provider="fixture-provider"), providers, models)
        result = await llm.generate("fixture-model", None, "instructions", "synthetic text", ResumeDraft)
        assert result.value == draft() and provider.calls == 1 and llm.available
        assert models.describe("openai") == []
        assert models.describe("fixture-provider") == [{"id": "fixture-model", "reasoningOptions": []}]
    asyncio.run(run())
