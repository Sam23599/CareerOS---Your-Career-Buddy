import asyncio
from uuid import uuid4
from typing import get_origin

import pytest

from app.core.errors import IntelligenceError
from app.jobs.evidence import JobEvidenceVerifier, RequirementPriority
from app.jobs.models import JobAnalysisHistory, JobAnalysisRecord, JobAnalysisSummary, JobRequirements, JobSource
from app.jobs.service import JobAnalysisService
from app.llm.models import StructuredResult
from app.llm.providers.base import LLMProvider
from app.resumes.models import Usage, Source
from app.storage.jobs_base import JobAnalysisRepository
from test_drafts import service, extraction


def source(description="Build APIs 🚀.\nRequired qualifications:\nPython\n3+ years of experience\nPreferred skills:\nTypeScript\nResponsibilities:\nBuild APIs\nRemote within Europe"):
    value = JobSource(jobId="a" * 64, normalizerVersion="job-source-v1", sha256="a" * 64,
                      sections=[{"id": key, "text": text} for key, text in zip(["title", "company", "location", "description"],
                                ["Backend engineer", "Example Co", "Europe", description])])
    return value.model_copy(update={"sha256": JobEvidenceVerifier.source_hash(value)})


def fact(value=None, section="description"):
    return {"value": value, "evidence": [{"section": section, "quote": value}] if value else []}


def requirements():
    value = {key: [] if get_origin(field.annotation) is list else fact() for key, field in JobRequirements.model_fields.items()}
    value.update(title=fact("Backend engineer", "title"), company=fact("Example Co", "company"), location=fact("Europe", "location"),
                 workMode=fact("Remote within Europe"), skills=[fact("Python")], technologies=[fact("TypeScript")],
                 experience=[fact("3+ years of experience")], responsibilities=[fact("Build APIs")])
    return JobRequirements.model_validate(value)


def record():
    original = source()
    return JobAnalysisRecord(schemaVersion=1, id="11111111-1111-1111-1111-111111111111", version=1, source=original,
                             analyzerVersion="job-analysis-v1", provider="openai", model="gpt-6-luna", reasoning="medium",
                             usage=Usage(inputTokens=100, outputTokens=200), createdAt="2026-10-05T00:00:00Z",
                             analysis=JobEvidenceVerifier().verify(requirements(), original))


class MemoryJobs(JobAnalysisRepository):
    ready = True

    def __init__(self):
        self.records = {}; self.deleted = set()

    async def get(self, owner, job_id, source_hash, analysis_id=None):
        items = [item for (user, _), item in self.records.items() if user == owner and item.source.jobId == job_id and (analysis_id is None or item.id == analysis_id)]
        return max(items, key=lambda item: (item.source.sha256 == source_hash, item.version)) if items else None

    async def save(self, owner, item):
        if (owner, item.source.jobId) in self.deleted:
            raise IntelligenceError(404, "JOB_NOT_FOUND")
        if (owner, item.id) in self.records:
            return self.records[owner, item.id]
        version = max((stored.version for (user, _), stored in self.records.items() if user == owner and stored.source.jobId == item.source.jobId), default=0) + 1
        item = item.model_copy(update={"version": version}); self.records[owner, item.id] = item
        return item

    async def history(self, owner, job_id, before_version=None):
        items = sorted((item for (user, _), item in self.records.items() if user == owner and item.source.jobId == job_id and (before_version is None or item.version < before_version)), key=lambda item: item.version, reverse=True)
        versions = [JobAnalysisSummary(id=item.id, version=item.version, model=item.model, reasoning=item.reasoning, createdAt=item.createdAt, sourceHash=item.source.sha256) for item in items[:20]]
        return JobAnalysisHistory(versions=versions, nextBeforeVersion=versions[-1].version if len(items) > 20 else None)

    async def delete(self, owner, job_id):
        self.deleted.add((owner, job_id))
        self.records = {key: item for key, item in self.records.items() if key[0] != owner or item.source.jobId != job_id}


class JobProvider(LLMProvider):
    calls = 0

    async def generate(self, request):
        self.calls += 1
        assert "untrusted data" in request.instructions and "pages" not in request.input
        return StructuredResult(requirements(), 100, 200)


def test_job_evidence_offsets_are_derived_and_priority_uses_explicit_scope():
    result = record()
    assert result.analysis.skills[0].priority == "required"
    assert result.analysis.technologies[0].priority == "preferred"
    assert result.analysis.experience[0].priority == "required"
    assert result.analysis.compensation.value is None
    for item in result.analysis.skills[0].evidence + result.analysis.skills[0].priorityEvidence:
        text = next(section.text for section in result.source.sections if section.id == item.section)
        assert text[item.start:item.end] == item.quote


def test_repeated_quotes_do_not_assign_an_arbitrary_requirement_priority():
    original = source(source().sections[-1].text + "\nPython")
    checked = JobEvidenceVerifier().verify(requirements(), original)
    assert checked.skills[0].priority == "unspecified" and not checked.skills[0].priorityEvidence


@pytest.mark.parametrize("text,priority", [("Python is required", "required"), ("Python is preferred", "preferred"),
                                          ("Python is not required", "unspecified"), ("Python required or preferred", "unspecified"),
                                          ("Python", "unspecified"), ("Required skills:\nPython", "required"),
                                          ("Required skills:\nBenefits:\nPython", "unspecified")])
def test_priority_rules_are_conservative(text, priority):
    start = text.index("Python")
    result, _ = RequirementPriority.resolve({"description": text}, {"section": "description", "start": start, "end": start + 6})
    assert result == priority


@pytest.mark.parametrize("value", [{"value": "Rust", "evidence": [{"section": "description", "quote": "Python"}]},
                                  {"value": "Python", "evidence": [{"section": "description", "quote": "Invented quote"}]},
                                  {"value": "Python", "evidence": []}, {"value": None, "evidence": [{"section": "description", "quote": "Python"}]}])
def test_invalid_job_claims_never_pass_evidence_validation(value):
    generated = JobRequirements.model_validate({**requirements().model_dump(), "skills": [value]})
    with pytest.raises(IntelligenceError) as caught:
        JobEvidenceVerifier().verify(generated, source())
    assert caught.value.code == "LLM_RESPONSE_INVALID"


def test_job_analysis_saves_fresh_versions_and_empty_or_wrong_sources_do_not_call_provider():
    async def run():
        drafts, _ = service(); provider = JobProvider(); drafts.llm.providers.register("openai", provider)
        jobs = JobAnalysisService(drafts.llm, MemoryJobs()); owner = str(uuid4())
        first = await jobs.analyze(owner, source(), "gpt-6-luna", "medium")
        second = await jobs.analyze(owner, source(), "gpt-6-luna", "medium")
        assert (first.version, second.version) == (1, 2) and first.id != second.id and provider.calls == 2
        for original, code in [(source("") , "JOB_TEXT_EMPTY"), (source().model_copy(update={"sha256": "b" * 64}), "INVALID_INPUT")]:
            with pytest.raises(IntelligenceError) as caught:
                await jobs.analyze(owner, original, "gpt-6-luna", "medium")
            assert caught.value.code == code
        assert provider.calls == 2
        assert await jobs.repository.get(str(uuid4()), source().jobId, source().sha256, first.id) is None
        await jobs.repository.delete(owner, source().jobId)
        with pytest.raises(IntelligenceError):
            await jobs.repository.save(owner, first)
    asyncio.run(run())


def test_job_and_resume_share_busy_limit_cancellation_and_shutdown():
    async def run():
        started = asyncio.Event()
        class SlowProvider(JobProvider):
            async def generate(self, request):
                started.set(); await asyncio.Future()
        drafts, _ = service(); drafts.llm.providers.register("openai", SlowProvider())
        jobs = JobAnalysisService(drafts.llm, MemoryJobs())
        pending = asyncio.create_task(jobs.analyze(str(uuid4()), source(), "gpt-6-luna", "medium"))
        await started.wait()
        with pytest.raises(IntelligenceError) as caught:
            await drafts.analyze(str(uuid4()), Source(resumeId=str(uuid4()), resumeVersion=1, sha256="a" * 64), extraction(), "gpt-6-luna", "medium")
        assert caught.value.code == "INTELLIGENCE_BUSY"
        await drafts.close(); await asyncio.gather(pending, return_exceptions=True)
        assert drafts.llm.gate.active is None and not jobs.repository.records
        drafts.llm.providers.register("openai", JobProvider())
        assert (await jobs.analyze(str(uuid4()), source(), "gpt-6-luna", "medium")).version == 1
    asyncio.run(run())


def test_private_job_routes_authenticate_validate_inputs_and_isolate_saved_history():
    from fastapi.testclient import TestClient
    from app.api.jobs import JobAnalysisController
    from app.core.settings import Settings
    from app.main import IntelligenceApplication

    drafts, _ = service(); provider = JobProvider(); drafts.llm.providers.register("openai", provider)
    jobs = JobAnalysisService(drafts.llm, MemoryJobs())
    app = IntelligenceApplication().build()
    token = "ab" * 32; owner = str(uuid4())
    app.state.jobs = JobAnalysisController(Settings(service_token=token), jobs)
    client = TestClient(app)
    original = source(); path = f"/internal/v1/jobs/{original.jobId}"
    headers = {"Authorization": f"Bearer {token}", "X-Owner-Id": owner, "X-Source-Sha256": original.sha256,
               "X-LLM-Model": "gpt-6-luna", "X-LLM-Reasoning": "medium"}
    assert client.post(path + "/analyze", json=original.model_dump()).status_code == 401
    assert client.post(path + "/analyze", headers={**headers, "X-Owner-Id": "foreign"}, json=original.model_dump()).status_code == 400
    assert client.post(path + "/analyze", headers={**headers, "X-LLM-Model": "gpt-4.1"}, json=original.model_dump()).status_code == 400
    assert client.post(path + "/analyze", headers=headers, json={**original.model_dump(), "owner": owner}).status_code == 400
    assert client.post(path + "/analyze", headers=headers, content="x" * 60001).status_code == 415
    assert client.post(path + "/analyze", headers={**headers, "Content-Type": "application/json"}, content="x" * 60001).status_code == 413
    assert provider.calls == 0
    first = client.post(path + "/analyze", headers=headers, json=original.model_dump())
    assert first.status_code == 200
    second = client.post(path + "/analyze", headers=headers, json=original.model_dump())
    assert second.status_code == 200 and second.json()["version"] == 2
    assert client.get(path + "/analysis", headers={**headers, "X-Analysis-Id": first.json()["id"]}).json()["id"] == first.json()["id"]
    assert client.get(path + "/analysis", headers={**headers, "X-Owner-Id": str(uuid4())}).status_code == 404
    assert [item["version"] for item in client.get(path + "/analyses", headers=headers).json()["versions"]] == [2, 1]
    assert client.get(path + "/analyses?beforeVersion=0", headers=headers).status_code == 400
    assert client.get(path + "/analyses?beforeVersion=2&beforeVersion=1", headers=headers).status_code == 400
    assert client.get(path + "/analyses?beforeVersion=2", headers=headers).json()["versions"][0]["version"] == 1
    assert provider.calls == 2
    assert client.delete(path + "/analysis", headers=headers).status_code == 200
    assert client.get(path + "/analysis", headers=headers).status_code == 404
