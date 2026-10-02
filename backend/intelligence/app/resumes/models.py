from typing import Annotated, Literal

from pydantic import Field

from app.core.models import StrictModel
from app.parsing.models import Extraction

Text = Annotated[str, Field(max_length=6000)]
Identifier = Annotated[str, Field(pattern=r"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$")]
Version = Annotated[int, Field(ge=1, le=2147483647)]
ModelName = Literal["gpt-4.1", "gpt-6-luna", "gpt-6.1-sol"]
Reasoning = Literal["none", "low", "medium", "high", "xhigh", "max"] | None


class Evidence(StrictModel):
    page: Annotated[int, Field(ge=1, le=50)]
    quote: Annotated[str, Field(min_length=1, max_length=6000)]


class Fact(StrictModel):
    value: Text | None
    evidence: Annotated[list[Evidence], Field(max_length=4)]


class Experience(StrictModel):
    company: Fact
    role: Fact
    location: Fact
    startDate: Fact
    endDate: Fact
    description: Fact
    achievements: Annotated[list[Fact], Field(max_length=30)]
    skills: Annotated[list[Fact], Field(max_length=50)]


class Education(StrictModel):
    institution: Fact
    qualification: Fact
    field: Fact
    startDate: Fact
    endDate: Fact
    details: Fact


class Certification(StrictModel):
    name: Fact
    issuer: Fact
    issuedDate: Fact
    expiryDate: Fact
    url: Fact


class Link(StrictModel):
    label: Fact
    url: Fact


class Project(StrictModel):
    name: Fact
    role: Fact
    description: Fact
    startDate: Fact
    endDate: Fact
    skills: Annotated[list[Fact], Field(max_length=50)]
    achievements: Annotated[list[Fact], Field(max_length=30)]
    links: Annotated[list[Link], Field(max_length=10)]


class AdditionalSection(StrictModel):
    title: Fact
    content: Annotated[list[Fact], Field(max_length=40)]


class ResumeDraft(StrictModel):
    fullName: Fact
    headline: Fact
    summary: Fact
    location: Fact
    phone: Fact
    email: Fact
    skills: Annotated[list[Fact], Field(max_length=50)]
    technologies: Annotated[list[Fact], Field(max_length=50)]
    roles: Annotated[list[Fact], Field(max_length=30)]
    experience: Annotated[list[Experience], Field(max_length=30)]
    education: Annotated[list[Education], Field(max_length=20)]
    certifications: Annotated[list[Certification], Field(max_length=30)]
    projects: Annotated[list[Project], Field(max_length=30)]
    links: Annotated[list[Link], Field(max_length=20)]
    languages: Annotated[list[Fact], Field(max_length=30)]
    keywords: Annotated[list[Fact], Field(max_length=50)]
    careerPreferences: Annotated[list[Fact], Field(max_length=30)]
    additionalSections: Annotated[list[AdditionalSection], Field(max_length=30)]


class Source(StrictModel):
    resumeId: Identifier
    resumeVersion: Annotated[int, Field(ge=1)]
    sha256: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]


class Usage(StrictModel):
    inputTokens: Annotated[int, Field(ge=0)]
    outputTokens: Annotated[int, Field(ge=0)]


class DraftRecord(StrictModel):
    schemaVersion: Literal[1] = 1
    id: Identifier
    version: Version
    source: Source
    status: Literal["ready"] = "ready"
    analyzerVersion: Literal["resume-draft-v1"] = "resume-draft-v1"
    provider: Literal["openai"] = "openai"
    model: ModelName
    reasoning: Reasoning
    usage: Usage
    createdAt: Annotated[str, Field(min_length=1, max_length=80)]
    extraction: Extraction
    draft: ResumeDraft


class DraftSummary(StrictModel):
    id: Identifier
    version: Version
    model: ModelName
    reasoning: Reasoning
    createdAt: Annotated[str, Field(min_length=1, max_length=80)]


class DraftHistory(StrictModel):
    versions: Annotated[list[DraftSummary], Field(max_length=20)]
    nextBeforeVersion: Version | None
