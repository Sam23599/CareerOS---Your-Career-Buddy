from typing import Annotated, Literal

from pydantic import Field

from app.core.models import StrictModel
from app.jobs.models import JobId, Requirement
from app.resumes.models import Evidence, Identifier, Source, Text, Version


class ProfileSkills(StrictModel):
    version: Annotated[int, Field(ge=0, le=2147483647)]
    skills: Annotated[list[Annotated[str, Field(min_length=1, max_length=100)]], Field(max_length=50)]


class MatchInput(StrictModel):
    resume: Source
    draftId: Identifier
    jobId: JobId
    jobHash: JobId
    jobAnalysisId: Identifier
    profile: ProfileSkills | None


class CandidateEvidence(StrictModel):
    source: Literal["resume", "profile"]
    field: Annotated[str, Field(min_length=1, max_length=100)]
    value: Text
    evidence: Annotated[list[Evidence], Field(max_length=4)]


class MatchItem(StrictModel):
    category: Literal["skills", "technologies", "experience", "education", "certifications", "languages",
                      "eligibility", "applicationRequirements", "additionalRequirements", "location", "workMode",
                      "employmentType", "compensation"]
    requirement: Requirement
    status: Literal["matched", "not_found", "needs_review"]
    weight: Literal[0, 1, 2, 3]
    candidate: CandidateEvidence | None


class MatchSource(StrictModel):
    resume: Source
    draftId: Identifier
    draftVersion: Version
    jobId: JobId
    jobHash: JobId
    jobAnalysisId: Identifier
    jobAnalysisVersion: Version
    profileVersion: Annotated[int, Field(ge=0, le=2147483647)] | None


class MatchResult(StrictModel):
    schemaVersion: Literal[1] = 1
    matcherVersion: Literal["skill-coverage-v1"] = "skill-coverage-v1"
    source: MatchSource
    score: Annotated[int, Field(ge=0, le=100)] | None
    matchedWeight: Annotated[int, Field(ge=0, le=300)]
    totalWeight: Annotated[int, Field(ge=0, le=300)]
    items: Annotated[list[MatchItem], Field(max_length=350)]
    notStated: Annotated[list[str], Field(max_length=13)]
