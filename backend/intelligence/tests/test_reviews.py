import asyncio
import os
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from app.api.reviews import ResumeReviewController
from app.core.errors import IntelligenceError
from app.jobs.models import JobFact
from app.matching.baseline import SkillCoverageMatcher
from app.matching.models import ProfileSkills
from app.parsing.models import Warning
from app.resumes.models import Experience, Fact
from app.reviews.models import ReviewInput, ReviewJob
from app.reviews.rules import KeywordChecker, ResumeChecker
from app.reviews.service import ResumeReviewService
from test_drafts import MemoryDraftRepository, extraction, fact
from test_jobs import MemoryJobs, record
from test_matching import job_with, requirement, resume


def test_missing_analysis_sections_are_suggestions_without_invented_evidence_or_ats_score():
    cv = resume()
    original = cv.model_dump_json()
    result = ResumeChecker().check(cv)
    assert sum(section.present for section in result.sections) == 2
    assert {item.code for item in result.findings} == {"CONTACT_NOT_FOUND", "SUMMARY_NOT_FOUND", "EXPERIENCE_NOT_FOUND", "EDUCATION_NOT_FOUND"}
    assert all(not item.evidence for item in result.findings)
    assert all(item.severity == "suggestion" for item in result.findings if item.code != "CONTACT_NOT_FOUND")
    assert result.match is None and result.preparation == [] and result.keywords == []
    assert cv.model_dump_json() == original


def test_either_email_or_phone_counts_as_contact_and_project_skills_count_without_a_skill_section():
    from app.resumes.models import Project
    cv = resume(); cv.draft.email = Fact.model_validate(fact("test@example.com")); cv.draft.skills = []
    entry = {key: [] if key in ("skills", "achievements", "links") else fact() for key in Project.model_fields}
    entry["skills"] = [fact("Python")]; cv.draft.projects = [Project.model_validate(entry)]
    result = ResumeChecker().check(cv)
    assert next(item for item in result.sections if item.section == "skills").present
    assert not {"CONTACT_NOT_FOUND", "SKILLS_NOT_FOUND"} & {item.code for item in result.findings}
    cv.draft.email = Fact.model_validate(fact()); cv.draft.phone = Fact.model_validate(fact("123456789"))
    assert not any(item.code == "CONTACT_NOT_FOUND" for item in ResumeChecker().check(cv).findings)


def test_incomplete_work_entries_reference_recognized_facts_without_inventing_outcomes():
    cv = resume()
    entry = {key: [] if key in ("skills", "achievements") else fact() for key in Experience.model_fields}
    entry["role"] = fact("Engineer"); cv.draft.experience = [Experience.model_validate(entry)]
    result = ResumeChecker().check(cv)
    incomplete = next(item for item in result.findings if item.code == "EXPERIENCE_DETAILS_INCOMPLETE")
    assert incomplete.fields == ["experience.0.company"] and incomplete.evidence[0].quote == "Engineer"
    assert "only when you can support them" in next(item for item in result.findings if item.code == "ACHIEVEMENTS_NOT_FOUND").action
    cv.draft.experience[0].achievements = [Fact.model_validate(fact("Reduced latency"))]
    assert not any(item.code == "ACHIEVEMENTS_NOT_FOUND" for item in ResumeChecker().check(cv).findings)


def test_saved_parser_warnings_are_retained_and_shown_before_optional_suggestions():
    cv = resume(); cv.extraction = extraction("Resume Tester\nSoftware engineer\nPython\n\n")
    cv.extraction.warnings = [Warning(code="PDF_STRUCTURE_REPAIRED", message="Review repaired PDF reading.")]
    result = ResumeChecker().check(cv)
    warning = result.findings[0]
    assert warning.code == "PDF_STRUCTURE_REPAIRED" and warning.message == cv.extraction.warnings[0].message
    assert warning.fields == ["extraction.warnings"] and warning.evidence == []


def test_preparation_prioritizes_required_then_unspecified_then_preferred_and_keeps_manual_review_separate():
    cv = resume(); job = job_with([requirement("Ruby", "preferred"), requirement("Go", "required"), requirement("Rust", "unspecified"), requirement("Python or Java")])
    result = ResumeChecker().check(cv, SkillCoverageMatcher().compare(cv, job))
    assert [result.match.items[item.matchIndex].requirement.value for item in result.preparation[:4]] == ["Go", "Rust", "Ruby", "Python or Java"]
    assert all(item.kind == "review" for item in result.preparation[3:])
    assert result.preparation[0].kind == "not_found" and result.preparation[-1].kind == "review"
    assert "First check whether you already have" in result.preparation[0].action


def test_profile_only_skill_is_an_evidence_gap_and_does_not_become_an_invented_learning_gap():
    cv = resume(); job = record()
    match = SkillCoverageMatcher().compare(cv, job, ProfileSkills(version=3, skills=["TypeScript"]))
    result = ResumeChecker().check(cv, match)
    item = next(item for item in result.preparation if item.kind == "profile_only")
    assert result.match.score == 100 and result.match.items[item.matchIndex].requirement.value == "TypeScript"
    assert "If accurate" in item.action
    assert not any(item.kind == "not_found" for item in result.preparation)


@pytest.mark.parametrize("text,term,expected", [("Python\nDocker", "python", "found"), ("System\n design", "System design", "found"),
    ("JavaScript", "Java", "not_found"), ("C++ C#", "C", "not_found"), ("Python.", "Python", "found"), ("Node.js", "Node", "not_found")])
def test_literal_keywords_have_page_quotes_and_never_change_the_skill_score(text, term, expected):
    cv = resume(); cv.extraction = extraction(text); job = record()
    job.analysis.keywords = [JobFact(value=term, evidence=requirement(term).evidence)]
    result = KeywordChecker().check(cv, job)[0]
    assert result.status == expected
    assert bool(result.evidence) == (expected == "found")
    if result.evidence: assert result.evidence[0].quote in cv.extraction.pages[0].text


def test_keywords_are_deduplicated_and_differ_from_skill_evidence():
    cv = resume(); cv.extraction = extraction("Resume Tester\nTypeScript")
    job = record(); job.analysis.keywords = [JobFact(value=value, evidence=requirement(value).evidence) for value in ["TypeScript", "typescript"]]
    report = ResumeChecker().check(cv, SkillCoverageMatcher().compare(cv, job), job)
    assert len(report.keywords) == 1 and report.keywords[0].status == "found"
    assert report.match.items[1].status == "not_found"


def test_review_resolves_exact_owner_versions_and_never_writes_or_uses_a_provider():
    async def run():
        drafts, jobs = MemoryDraftRepository(), MemoryJobs(); owner = str(uuid4())
        cv = await drafts.save(owner, resume()); jd = await jobs.save(owner, record())
        service = ResumeReviewService(drafts, jobs)
        context = ReviewInput(resume=cv.source, draftId=cv.id, job=None)
        assert (await service.review(owner, context)).match is None
        await drafts.save(owner, cv.model_copy(update={"id": str(uuid4())}))
        job = ReviewJob(jobId=jd.source.jobId, jobHash=jd.source.sha256, jobAnalysisId=jd.id, profile=None)
        selected = context.model_copy(update={"job": job})
        report = await service.review(owner, selected)
        assert report.source.draftVersion == 1 and report.match.score == 75
        assert len(drafts.records) == 2 and len(jobs.records) == 1
        for changed, code in [(selected.model_copy(update={"draftId": str(uuid4())}), "ANALYSIS_NOT_FOUND"),
            (selected.model_copy(update={"job": job.model_copy(update={"jobHash": "c" * 64})}), "JOB_ANALYSIS_STALE")]:
            with pytest.raises(IntelligenceError) as caught: await service.review(owner, changed)
            assert caught.value.code == code
        with pytest.raises(IntelligenceError): await service.review(str(uuid4()), selected)
        await jobs.delete(owner, jd.source.jobId)
        with pytest.raises(IntelligenceError) as caught: await service.review(owner, selected)
        assert caught.value.code == "JOB_ANALYSIS_NOT_FOUND"
        await drafts.delete(owner, cv.source.resumeId)
        with pytest.raises(IntelligenceError): await service.review(owner, context)
    asyncio.run(run())


def test_review_controller_requires_authentication_before_reading_and_rejects_untrusted_context():
    class NeverCalled:
        async def review(self, owner, context): raise AssertionError("Invalid input reached review")
    app = FastAPI(); controller = ResumeReviewController("a" * 64, NeverCalled())
    @app.exception_handler(IntelligenceError)
    async def error_handler(request, error): return JSONResponse({"code": error.code}, status_code=error.status)
    app.add_api_route("/review", controller.review, methods=["POST"])
    with TestClient(app) as client:
        assert client.post("/review", content="x" * 17000).status_code == 401
        headers = {"Authorization": "Bearer " + "a" * 64, "X-Owner-Id": str(uuid4()), "Content-Type": "application/json"}
        assert client.post("/review", headers=headers, content="x" * 17000).status_code == 413
        assert client.post("/review", headers=headers, json={"owner": str(uuid4())}).status_code == 400
        assert client.post("/review", headers={**headers, "X-Owner-Id": "bad"}, json={}).status_code == 400


@pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"), reason="Explicit isolated PostgreSQL configuration required")
def test_private_review_endpoint_uses_saved_postgres_sources_after_restart():
    from httpx import ASGITransport, AsyncClient
    from psycopg import AsyncConnection, sql
    from psycopg.conninfo import make_conninfo
    from app.storage.postgres import PostgresDraftRepository
    from app.storage.jobs_postgres import PostgresJobAnalysisRepository

    async def run():
        url = os.environ["TEST_DATABASE_URL"]; database = "review_test_" + uuid4().hex
        admin = await AsyncConnection.connect(url, autocommit=True)
        await admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database)))
        repository = PostgresDraftRepository(make_conninfo(url, dbname=database))
        try:
            await repository.start(); owner = str(uuid4())
            cv = await repository.save(owner, resume())
            jd = await PostgresJobAnalysisRepository(repository).save(owner, record())
            await repository.close()
            repository = PostgresDraftRepository(make_conninfo(url, dbname=database)); await repository.start()
            controller = ResumeReviewController("a" * 64, ResumeReviewService(repository, PostgresJobAnalysisRepository(repository)))
            app = FastAPI()
            @app.exception_handler(IntelligenceError)
            async def error_handler(request, error): return JSONResponse({"code": error.code}, status_code=error.status)
            app.add_api_route("/review", controller.review, methods=["POST"])
            headers = {"Authorization": "Bearer " + "a" * 64, "X-Owner-Id": owner}
            context = {"resume": cv.source.model_dump(), "draftId": cv.id, "job": None}
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test.local") as client:
                response = await client.post("/review", headers=headers, json=context)
                assert response.status_code == 200 and response.json()["source"]["draftId"] == cv.id
                context["job"] = {"jobId": jd.source.jobId, "jobHash": jd.source.sha256, "jobAnalysisId": jd.id, "profile": None}
                response = await client.post("/review", headers=headers, json=context)
                assert response.status_code == 200 and response.json()["match"]["score"] == 75
                response = await client.post("/review", headers={**headers, "X-Owner-Id": str(uuid4())}, json=context)
                assert response.status_code == 404
                await repository.delete(owner, cv.source.resumeId)
                response = await client.post("/review", headers=headers, json=context)
                assert response.status_code == 404
        finally:
            await repository.close()
            await admin.execute(sql.SQL("DROP DATABASE {}").format(sql.Identifier(database)))
            await admin.close()
    asyncio.run(run())
