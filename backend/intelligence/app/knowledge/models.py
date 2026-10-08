from typing import Annotated, Literal

from pydantic import Field, model_validator

from app.core.models import StrictModel
from app.resumes.models import Identifier

TextId = Annotated[str, Field(min_length=1, max_length=160)]


class SourceRef(StrictModel):
    scope: Literal['private', 'public']
    ownerId: Identifier | None
    sourceType: Literal['resume', 'profile', 'job', 'job_analysis', 'preparation', 'conversation', 'application', 'company', 'resource']
    sourceId: TextId
    sourceVersion: Annotated[str, Field(min_length=1, max_length=80)]
    contentHash: Annotated[str, Field(pattern=r'^[a-f0-9]{64}$')]
    visibilityRevision: Annotated[int, Field(ge=0)]

    @model_validator(mode='after')
    def validate_scope(self):
        if self.scope == 'private' and self.ownerId is None:
            raise ValueError('Private sources require an owner')
        if self.scope == 'public' and (self.ownerId is not None or self.sourceType not in {'job', 'company', 'resource'}):
            raise ValueError('Only public jobs, company facts and resources can omit ownership')
        return self


class KnowledgeSource(StrictModel):
    ref: SourceRef
    lifecycle: Literal['active', 'trash', 'archived', 'obsolete']
    trustKind: Literal['source_text', 'user_reported', 'assistant_advice', 'derived']
    text: Annotated[str, Field(min_length=1, max_length=60000)]


class EvidenceSpan(StrictModel):
    id: TextId
    source: SourceRef
    quote: Annotated[str, Field(min_length=1, max_length=6000)]
    start: Annotated[int, Field(ge=0, le=60000)]
    end: Annotated[int, Field(ge=1, le=60000)]
    page: Annotated[int, Field(ge=1)] | None = None
    section: TextId | None = None
    fieldPath: TextId | None = None

    @model_validator(mode='after')
    def validate_locator(self):
        if self.end <= self.start or not (self.page or self.section or self.fieldPath):
            raise ValueError('Evidence requires a nonempty span and a page, section or field path')
        return self


class EvidenceBundle(StrictModel):
    schemaVersion: Literal[1] = 1
    sources: Annotated[list[KnowledgeSource], Field(max_length=100)]
    passages: Annotated[list[EvidenceSpan], Field(max_length=100)]
