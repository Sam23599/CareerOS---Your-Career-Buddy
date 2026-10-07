from typing import Annotated, Literal

from pydantic import Field, model_validator

from app.core.models import StrictModel
from app.matching.models import MatchInput, MatchSource
from app.resumes.models import Identifier, ModelName, Reasoning, Usage, Version

ShortText = Annotated[str, Field(min_length=1, max_length=1200)]
Classification = Literal["already_know", "need_evidence", "want_to_learn", "unsure"]


class GapChoice(StrictModel):
    matchIndex: Annotated[int, Field(ge=0, le=349)]
    classification: Classification


class PreparationGoals(StrictModel):
    choices: Annotated[list[GapChoice], Field(min_length=1, max_length=20)]
    hoursPerWeek: Annotated[int, Field(ge=1, le=40)]
    weeks: Annotated[int, Field(ge=1, le=12)]
    goal: Annotated[str, Field(max_length=1000)]


class RoadmapGoals(PreparationGoals):
    weeks: Annotated[int, Field(ge=1, le=8)]


class PreparationInput(StrictModel):
    context: MatchInput
    goals: RoadmapGoals
    model: ModelName
    reasoning: Reasoning
    requestKey: Identifier


class GeneratedAction(StrictModel):
    matchIndex: Annotated[int, Field(ge=0, le=349)]
    kind: Literal["learn", "practice", "project", "checkpoint", "interview", "cv_evidence", "verify"]
    week: Annotated[int, Field(ge=1, le=12)]
    hours: Annotated[int, Field(ge=1, le=40)]
    title: Annotated[str, Field(min_length=1, max_length=150)]
    detail: ShortText


class GeneratedPlan(StrictModel):
    overview: ShortText
    actions: Annotated[list[GeneratedAction], Field(min_length=1, max_length=60)]
    cautions: Annotated[list[ShortText], Field(max_length=8)]


class WeeklyGoal(StrictModel):
    week: Annotated[int, Field(ge=1, le=8)]
    objective: Annotated[str, Field(min_length=1, max_length=600)]
    milestone: Annotated[str, Field(min_length=1, max_length=800)]


class StudySession(GeneratedAction):
    week: Annotated[int, Field(ge=1, le=8)]
    outcome: Annotated[str, Field(min_length=1, max_length=800)]


class GeneratedRoadmap(StrictModel):
    overview: ShortText
    weeks: Annotated[list[WeeklyGoal], Field(min_length=1, max_length=8)]
    actions: Annotated[list[StudySession], Field(min_length=1, max_length=60)]
    cautions: Annotated[list[ShortText], Field(max_length=8)]


class PlanAction(GeneratedAction):
    id: Annotated[str, Field(pattern=r"^action-[1-9][0-9]{0,2}$")]


class ReviewedAction(StrictModel):
    id: Annotated[str, Field(pattern=r"^action-[1-9][0-9]{0,2}$")]
    title: Annotated[str, Field(min_length=1, max_length=150)]
    detail: ShortText
    status: Literal["planned", "skipped", "done"]


class PlanReview(StrictModel):
    revision: Annotated[int, Field(ge=0, le=2147483647)]
    actions: Annotated[list[ReviewedAction], Field(max_length=60)]


class PlanContent(StrictModel):
    overview: ShortText
    actions: Annotated[list[PlanAction], Field(min_length=1, max_length=60)]
    cautions: Annotated[list[ShortText], Field(max_length=8)]


class RoadmapAction(StudySession):
    id: Annotated[str, Field(pattern=r"^action-[1-9][0-9]{0,2}$")]


class RoadmapContent(StrictModel):
    overview: ShortText
    weeks: Annotated[list[WeeklyGoal], Field(min_length=1, max_length=8)]
    actions: Annotated[list[RoadmapAction], Field(min_length=1, max_length=60)]
    cautions: Annotated[list[ShortText], Field(max_length=8)]


class PreparationRecord(StrictModel):
    schemaVersion: Literal[1] = 1
    plannerVersion: Literal["preparation-v1", "preparation-v2"] = "preparation-v1"
    id: Identifier
    version: Version
    source: MatchSource
    goals: PreparationGoals
    provider: Literal["openai"] = "openai"
    model: ModelName
    reasoning: Reasoning
    usage: Usage
    createdAt: Annotated[str, Field(min_length=1, max_length=80)]
    plan: PlanContent | RoadmapContent
    review: PlanReview

    @model_validator(mode='after')
    def versioned_content(self):
        if (self.plannerVersion == 'preparation-v2') != isinstance(self.plan, RoadmapContent):
            raise ValueError('Planner version must match content format')
        return self


class PreparationSummary(StrictModel):
    id: Identifier
    version: Version
    source: MatchSource
    model: ModelName
    reasoning: Reasoning
    createdAt: Annotated[str, Field(min_length=1, max_length=80)]
    reviewRevision: Annotated[int, Field(ge=0)]


class PreparationHistory(StrictModel):
    versions: Annotated[list[PreparationSummary], Field(max_length=20)]
    nextBeforeVersion: Version | None
