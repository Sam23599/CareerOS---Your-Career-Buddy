from typing import Annotated, Literal

from pydantic import Field, model_validator

from app.core.models import StrictModel
from app.knowledge.models import TextId


class EvaluationCase(StrictModel):
    id: TextId
    category: TextId
    question: Annotated[str, Field(min_length=1, max_length=2000)]
    requiredEvidence: list[TextId]
    forbiddenEvidence: list[TextId]
    shouldAbstain: bool
    rubric: Annotated[str, Field(min_length=1, max_length=2000)]

    @model_validator(mode='after')
    def validate_expectations(self):
        if set(self.requiredEvidence) & set(self.forbiddenEvidence):
            raise ValueError('Required and forbidden evidence must be disjoint')
        return self


class EvaluationDataset(StrictModel):
    schemaVersion: Literal[1] = 1
    version: TextId
    reviewStatus: Literal['synthetic_draft', 'human_reviewed']
    evidence: dict[TextId, Annotated[str, Field(min_length=1, max_length=6000)]]
    cases: Annotated[list[EvaluationCase], Field(min_length=1)]

    @model_validator(mode='after')
    def validate_cases(self):
        ids = [case.id for case in self.cases]
        if len(ids) != len(set(ids)):
            raise ValueError('Duplicate case IDs')
        for case in self.cases:
            if not set(case.requiredEvidence + case.forbiddenEvidence) <= self.evidence.keys():
                raise ValueError('Case references missing fixture evidence')
        return self


class EvaluationObservation(StrictModel):
    caseId: TextId
    retrieved: list[TextId]
    cited: list[TextId]
    abstained: bool
    # Filled by a reviewer/independent verifier, never inferred from citation IDs.
    unsupportedClaims: list[Annotated[str, Field(min_length=1, max_length=2000)]]
