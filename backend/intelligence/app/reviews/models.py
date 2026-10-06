from typing import Annotated, Literal

from pydantic import Field

from app.core.models import StrictModel
from app.jobs.models import JobFact, JobId
from app.matching.models import MatchResult, ProfileSkills
from app.resumes.models import Evidence, Identifier, Source, Version


class ReviewJob(StrictModel):
    jobId: JobId
    jobHash: JobId
    jobAnalysisId: Identifier
    profile: ProfileSkills | None


class ReviewInput(StrictModel):
    resume: Source
    draftId: Identifier
    job: ReviewJob | None


class ReviewSource(StrictModel):
    resume: Source
    draftId: Identifier
    draftVersion: Version


class SectionCheck(StrictModel):
    section: Literal["fullName", "contact", "summary", "skills", "experience", "education"]
    present: bool


class ResumeFinding(StrictModel):
    code: Literal["NAME_NOT_FOUND", "CONTACT_NOT_FOUND", "SUMMARY_NOT_FOUND", "SKILLS_NOT_FOUND",
                  "EXPERIENCE_NOT_FOUND", "EDUCATION_NOT_FOUND", "EXPERIENCE_DETAILS_INCOMPLETE",
                  "ACHIEVEMENTS_NOT_FOUND", "PAGES_WITHOUT_TEXT", "PDF_STRUCTURE_REPAIRED", "NO_EXTRACTABLE_TEXT"]
    severity: Literal["warning", "suggestion"]
    title: Annotated[str, Field(min_length=1, max_length=100)]
    message: Annotated[str, Field(min_length=1, max_length=600)]
    action: Annotated[str, Field(min_length=1, max_length=600)]
    fields: Annotated[list[Annotated[str, Field(min_length=1, max_length=100)]], Field(min_length=1, max_length=60)]
    evidence: Annotated[list[Evidence], Field(max_length=8)]


class PreparationItem(StrictModel):
    matchIndex: Annotated[int, Field(ge=0, le=349)]
    kind: Literal["not_found", "profile_only", "review"]
    action: Annotated[str, Field(min_length=1, max_length=600)]


class KeywordCheck(StrictModel):
    term: JobFact
    status: Literal["found", "not_found"]
    evidence: Annotated[list[Evidence], Field(max_length=1)]


class ReviewReport(StrictModel):
    schemaVersion: Literal[1] = 1
    reviewerVersion: Literal["resume-checks-v1"] = "resume-checks-v1"
    source: ReviewSource
    sections: Annotated[list[SectionCheck], Field(min_length=6, max_length=6)]
    findings: Annotated[list[ResumeFinding], Field(max_length=11)]
    match: MatchResult | None
    preparation: Annotated[list[PreparationItem], Field(max_length=350)]
    keywords: Annotated[list[KeywordCheck], Field(max_length=50)]
