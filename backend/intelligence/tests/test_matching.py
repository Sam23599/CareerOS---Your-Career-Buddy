import asyncio
import os
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.matching import MatchingController
from app.core.errors import IntelligenceError
from app.jobs.models import Requirement
from app.matching.baseline import SkillCoverageMatcher
from app.matching.models import MatchInput, ProfileSkills
from app.matching.service import MatchingService
from app.resumes.models import DraftRecord, Fact, Source, Usage
from test_drafts import MemoryDraftRepository, draft, extraction, fact
from test_jobs import MemoryJobs, record


def resume():
    return DraftRecord(id=str(uuid4()), version=1, source=Source(resumeId=str(uuid4()), resumeVersion=2, sha256="b" * 64),
                       model="gpt-6-luna", reasoning="medium", usage=Usage(inputTokens=1, outputTokens=1),
                       createdAt="2026-10-06T00:00:00Z", draft=draft(), extraction=extraction())


def requirement(value, priority="required"):
    return Requirement(value=value, priority=priority, evidence=[{"section": "description", "quote": value, "start": 0, "end": len(value)}], priorityEvidence=[])


def job_with(skills, technologies=None):
    job = record()
    job.analysis = job.analysis.model_copy(update={"skills": skills, "technologies": technologies or []})
    return job


def test_documented_weights_and_other_requirements_are_visible_without_scoring():
    result = SkillCoverageMatcher().compare(resume(), record())
    assert (result.score, result.matchedWeight, result.totalWeight) == (75, 3, 4)
    assert [item.status for item in result.items[:2]] == ["matched", "not_found"]
    assert result.items[0].candidate.evidence[0].page == 1
    assert result.items[2].category == "experience" and result.items[2].weight == 0
    assert result.items[2].status == "needs_review"
    assert "education" in result.notStated


def test_aliases_case_whitespace_and_deduplication_preserve_strongest_priority():
    cv = resume()
    cv.draft.skills = [Fact.model_validate(fact("JavaScript"))]
    job = job_with([requirement(" js ", "preferred"), requirement("JavaScript", "required")],
                   [requirement("JAVASCRIPT", "unspecified")])
    result = SkillCoverageMatcher().compare(cv, job)
    assert len([item for item in result.items if item.weight]) == 1
    assert result.items[0].requirement.priority == "required"
    assert (result.score, result.totalWeight) == (100, 3)


@pytest.mark.parametrize("candidate,required", [("JavaScript", "Java"), ("Google", "Go"), ("C++", "C"), ("C#", "C"), ("React Native", "React")])
def test_substrings_and_distinct_technologies_do_not_match(candidate, required):
    cv = resume(); cv.draft.skills = [Fact.model_validate(fact(candidate))]
    result = SkillCoverageMatcher().compare(cv, job_with([requirement(required)]))
    assert result.score == 0 and result.items[0].status == "not_found"


def test_profile_is_optional_and_resume_evidence_takes_precedence():
    cv = resume(); job = record()
    without = SkillCoverageMatcher().compare(cv, job)
    with_profile = SkillCoverageMatcher().compare(cv, job, ProfileSkills(version=4, skills=["TypeScript", "Python"]))
    assert without.score == 75 and without.source.profileVersion is None
    assert with_profile.score == 100 and with_profile.source.profileVersion == 4
    assert with_profile.items[0].candidate.source == "resume"
    assert with_profile.items[1].candidate.source == "profile" and with_profile.items[1].candidate.evidence == []


def test_empty_or_ambiguous_requirements_do_not_produce_an_invented_score():
    for skills in [[], [requirement("Python or Java")], [requirement("experience with Python")]]:
        result = SkillCoverageMatcher().compare(resume(), job_with(skills))
        assert result.score is None and result.totalWeight == 0
        assert all(item.status == "needs_review" for item in result.items)


def test_negation_and_conflicting_source_warnings_require_review():
    cv = resume(); job = job_with([requirement("Python")])
    job.analysis.skills[0].evidence[0].quote = "Python is not required"
    assert SkillCoverageMatcher().compare(cv, job).score is None
    job = job_with([requirement("Python")])
    cv.draft.skills[0].evidence[0].quote = "No experience with Python"
    assert SkillCoverageMatcher().compare(cv, job).score is None
    cv = resume()
    from app.jobs.models import AnalysisWarning
    job.analysis.warnings = [AnalysisWarning(code="POSSIBLE_CONTRADICTION", message="Review", evidence=job.analysis.skills[0].evidence)]
    assert SkillCoverageMatcher().compare(cv, job).score is None


def test_project_and_experience_skills_count_but_summary_keyword_mentions_do_not():
    from app.resumes.models import Project
    cv = resume(); cv.draft.skills = []
    project = {key: [] if key in ("skills", "achievements", "links") else fact() for key in Project.model_fields}
    project["skills"] = [fact("Python")]
    cv.draft.projects = [Project.model_validate(project)]
    result = SkillCoverageMatcher().compare(cv, record())
    assert result.score == 75 and result.items[0].candidate.field == "projects.0.skills"
    cv.draft.projects = []; cv.draft.keywords = [Fact.model_validate(fact("Python"))]
    cv.draft.summary = Fact.model_validate(fact("Python"))
    assert SkillCoverageMatcher().compare(cv, record()).score == 0


def test_service_resolves_exact_owner_versions_and_rejects_stale_deleted_inputs_without_ai():
    async def run():
        drafts, jobs = MemoryDraftRepository(), MemoryJobs()
        owner = str(uuid4()); cv = await drafts.save(owner, resume()); job = await jobs.save(owner, record())
        service = MatchingService(drafts, jobs)
        context = MatchInput(resume=cv.source, draftId=cv.id, jobId=job.source.jobId, jobHash=job.source.sha256,
                             jobAnalysisId=job.id, profile=None)
        result = await service.compare(owner, context)
        assert result.source.draftId == cv.id and result.source.jobAnalysisId == job.id
        # A newer saved version never silently replaces the explicitly selected one.
        await drafts.save(owner, cv.model_copy(update={"id": str(uuid4())}))
        assert (await service.compare(owner, context)).source.draftVersion == 1
        for changed, expected in [(context.model_copy(update={"jobHash": "c" * 64}), "JOB_ANALYSIS_STALE"),
                                  (context.model_copy(update={"draftId": str(uuid4())}), "ANALYSIS_NOT_FOUND")]:
            with pytest.raises(IntelligenceError) as caught:
                await service.compare(owner, changed)
            assert caught.value.code == expected
        with pytest.raises(IntelligenceError) as caught:
            await service.compare(str(uuid4()), context)
        assert caught.value.code == "ANALYSIS_NOT_FOUND"
        await drafts.delete(owner, cv.source.resumeId)
        with pytest.raises(IntelligenceError): await service.compare(owner, context)
        assert len(jobs.records) == 1
    asyncio.run(run())


def test_internal_controller_authenticates_before_body_and_bounds_trusted_context():
    class NeverCalled:
        async def compare(self, owner, context):
            raise AssertionError("Invalid input reached the matcher")
    controller = MatchingController("a" * 64, NeverCalled())
    app = FastAPI()
    from fastapi.responses import JSONResponse

    @app.exception_handler(IntelligenceError)
    async def error_handler(request, error):
        return JSONResponse({"code": error.code}, status_code=error.status)
    app.add_api_route("/compare", controller.compare, methods=["POST"])
    with TestClient(app) as client:
        assert client.post("/compare", content="x" * 17000).status_code == 401
        headers = {"Authorization": "Bearer " + "a" * 64, "X-Owner-Id": str(uuid4()), "Content-Type": "application/json"}
        assert client.post("/compare", headers=headers, content="x" * 17000).status_code == 413
        assert client.post("/compare", headers=headers, json={"owner": str(uuid4())}).status_code == 400


@pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"), reason="Explicit isolated PostgreSQL test configuration required")
def test_matching_uses_saved_postgres_versions_after_restart_and_honors_deletion():
    from psycopg import AsyncConnection, sql
    from psycopg.conninfo import make_conninfo
    from app.storage.postgres import PostgresDraftRepository
    from app.storage.jobs_postgres import PostgresJobAnalysisRepository

    async def run():
        url = os.environ["TEST_DATABASE_URL"]
        database = "matching_test_" + uuid4().hex
        admin = await AsyncConnection.connect(url, autocommit=True)
        await admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database)))
        repository = PostgresDraftRepository(make_conninfo(url, dbname=database))
        try:
            await repository.start()
            owner = str(uuid4()); cv = await repository.save(owner, resume())
            jobs = PostgresJobAnalysisRepository(repository); job = await jobs.save(owner, record())
            context = MatchInput(resume=cv.source, draftId=cv.id, jobId=job.source.jobId, jobHash=job.source.sha256,
                                 jobAnalysisId=job.id, profile=None)
            await repository.save(owner, cv.model_copy(update={"id": str(uuid4())}))
            await repository.close()
            repository = PostgresDraftRepository(make_conninfo(url, dbname=database)); await repository.start()
            matching = MatchingService(repository, PostgresJobAnalysisRepository(repository))
            result = await matching.compare(owner, context)
            assert result.score == 75 and result.source.draftId == cv.id and result.source.draftVersion == 1
            with pytest.raises(IntelligenceError): await matching.compare(str(uuid4()), context)
            await repository.delete(owner, cv.source.resumeId)
            with pytest.raises(IntelligenceError) as caught: await matching.compare(owner, context)
            assert caught.value.code == "ANALYSIS_NOT_FOUND"
        finally:
            await repository.close()
            await admin.execute(sql.SQL("DROP DATABASE {}").format(sql.Identifier(database)))
            await admin.close()
    asyncio.run(run())
