from typing import Annotated, Literal

from pydantic import Field

from app.core.models import StrictModel
from app.jobs.models import JobId
from app.matching.models import MatchInput, MatchSource, ProfileSkills
from app.resumes.models import Identifier, ModelName, Reasoning, Source, Usage


class CadyJob(StrictModel):
    jobId: JobId
    jobHash: JobId
    jobAnalysisId: Identifier


class ConversationTurn(StrictModel):
    role: Literal['user', 'assistant']
    text: Annotated[str, Field(min_length=1, max_length=2000)]


class CadyInput(StrictModel):
    resume: Source
    draftId: Identifier
    jobs: Annotated[list[CadyJob], Field(max_length=3)]
    profile: ProfileSkills | None
    question: Annotated[str, Field(min_length=1, max_length=2000)]
    history: Annotated[list[ConversationTurn], Field(max_length=6)]
    model: ModelName
    reasoning: Reasoning


class AnswerParagraph(StrictModel):
    text: Annotated[str, Field(min_length=1, max_length=2000)]
    references: Annotated[list[Annotated[str, Field(min_length=1, max_length=40)]], Field(max_length=8)]


class GeneratedAnswer(StrictModel):
    paragraphs: Annotated[list[AnswerParagraph], Field(min_length=1, max_length=8)]
    followUps: Annotated[list[Annotated[str, Field(min_length=1, max_length=200)]], Field(max_length=3)]


class ContextReference(StrictModel):
    id: Annotated[str, Field(min_length=1, max_length=40)]
    label: Annotated[str, Field(min_length=1, max_length=180)]
    text: Annotated[str, Field(min_length=1, max_length=6000)]


class CadyResult(StrictModel):
    schemaVersion: Literal[1] = 1
    assistantVersion: Literal['cady-v1'] = 'cady-v1'
    resume: Source
    draftId: Identifier
    draftVersion: Annotated[int, Field(ge=1)]
    sources: Annotated[list[MatchSource], Field(max_length=3)]
    profileVersion: Annotated[int, Field(ge=0)] | None
    answer: GeneratedAnswer
    references: Annotated[list[ContextReference], Field(max_length=80)]
    model: ModelName
    reasoning: Reasoning
    usage: Usage
