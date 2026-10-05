from typing import Annotated, Literal

from pydantic import Field, model_validator

from app.core.models import StrictModel
from app.resumes.models import Identifier, ModelName, Reasoning, Usage, Version

JobId = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
SectionId = Literal["title", "company", "location", "description"]
Text = Annotated[str, Field(max_length=6000)]


class Section(StrictModel):
    id: SectionId
    text: Annotated[str, Field(max_length=100000)]


class JobSource(StrictModel):
    jobId: JobId
    normalizerVersion: Literal["job-source-v1"]
    sha256: JobId
    sections: Annotated[list[Section], Field(min_length=4, max_length=4)]

    @model_validator(mode="after")
    def ordered_sections(self):
        if [item.id for item in self.sections] != ["title", "company", "location", "description"]:
            raise ValueError("Invalid sections")
        if any("\r" in item.text or "\0" in item.text or item.text != item.text.strip() for item in self.sections):
            raise ValueError("Invalid normalized text")
        return self


class QuotedEvidence(StrictModel):
    section: SectionId
    quote: Annotated[str, Field(min_length=1, max_length=6000)]


class GeneratedFact(StrictModel):
    value: Text | None
    evidence: Annotated[list[QuotedEvidence], Field(max_length=4)]


class GeneratedWarning(StrictModel):
    code: Literal["AMBIGUOUS_REQUIREMENT", "POSSIBLE_CONTRADICTION"]
    evidence: Annotated[list[QuotedEvidence], Field(min_length=1, max_length=4)]


class JobRequirements(StrictModel):
    title: GeneratedFact
    company: GeneratedFact
    location: GeneratedFact
    workMode: GeneratedFact
    employmentType: GeneratedFact
    compensation: GeneratedFact
    skills: Annotated[list[GeneratedFact], Field(max_length=50)]
    technologies: Annotated[list[GeneratedFact], Field(max_length=50)]
    experience: Annotated[list[GeneratedFact], Field(max_length=30)]
    education: Annotated[list[GeneratedFact], Field(max_length=20)]
    certifications: Annotated[list[GeneratedFact], Field(max_length=30)]
    languages: Annotated[list[GeneratedFact], Field(max_length=30)]
    eligibility: Annotated[list[GeneratedFact], Field(max_length=30)]
    applicationRequirements: Annotated[list[GeneratedFact], Field(max_length=30)]
    responsibilities: Annotated[list[GeneratedFact], Field(max_length=40)]
    deliverables: Annotated[list[GeneratedFact], Field(max_length=30)]
    benefits: Annotated[list[GeneratedFact], Field(max_length=30)]
    keywords: Annotated[list[GeneratedFact], Field(max_length=50)]
    additionalRequirements: Annotated[list[GeneratedFact], Field(max_length=30)]
    warnings: Annotated[list[GeneratedWarning], Field(max_length=10)]


class JobEvidence(QuotedEvidence):
    start: Annotated[int, Field(ge=0, le=100000)]
    end: Annotated[int, Field(ge=1, le=100000)]


class JobFact(StrictModel):
    value: Text | None
    evidence: Annotated[list[JobEvidence], Field(max_length=4)]


class Requirement(JobFact):
    priority: Literal["required", "preferred", "unspecified"]
    priorityEvidence: Annotated[list[JobEvidence], Field(max_length=4)]


class AnalysisWarning(StrictModel):
    code: Literal["AMBIGUOUS_REQUIREMENT", "POSSIBLE_CONTRADICTION"]
    message: Annotated[str, Field(max_length=200)]
    evidence: Annotated[list[JobEvidence], Field(min_length=1, max_length=4)]


class JobAnalysis(StrictModel):
    title: JobFact
    company: JobFact
    location: JobFact
    workMode: JobFact
    employmentType: JobFact
    compensation: JobFact
    skills: Annotated[list[Requirement], Field(max_length=50)]
    technologies: Annotated[list[Requirement], Field(max_length=50)]
    experience: Annotated[list[Requirement], Field(max_length=30)]
    education: Annotated[list[Requirement], Field(max_length=20)]
    certifications: Annotated[list[Requirement], Field(max_length=30)]
    languages: Annotated[list[Requirement], Field(max_length=30)]
    eligibility: Annotated[list[Requirement], Field(max_length=30)]
    applicationRequirements: Annotated[list[Requirement], Field(max_length=30)]
    responsibilities: Annotated[list[JobFact], Field(max_length=40)]
    deliverables: Annotated[list[JobFact], Field(max_length=30)]
    benefits: Annotated[list[JobFact], Field(max_length=30)]
    keywords: Annotated[list[JobFact], Field(max_length=50)]
    additionalRequirements: Annotated[list[Requirement], Field(max_length=30)]
    warnings: Annotated[list[AnalysisWarning], Field(max_length=10)]


class JobAnalysisRecord(StrictModel):
    schemaVersion: Literal[1]
    id: Identifier
    version: Version
    source: JobSource
    analyzerVersion: Literal["job-analysis-v1"]
    provider: Literal["openai"]
    model: ModelName
    reasoning: Reasoning
    usage: Usage
    createdAt: Annotated[str, Field(min_length=1, max_length=80)]
    analysis: JobAnalysis


class JobAnalysisSummary(StrictModel):
    id: Identifier
    version: Version
    model: ModelName
    reasoning: Reasoning
    createdAt: Annotated[str, Field(min_length=1, max_length=80)]
    sourceHash: JobId


class JobAnalysisHistory(StrictModel):
    versions: Annotated[list[JobAnalysisSummary], Field(max_length=20)]
    nextBeforeVersion: Version | None
