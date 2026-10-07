import asyncio
from datetime import datetime, timezone
import json
from uuid import uuid4

from app.core.errors import IntelligenceError
from app.preparation.context import CareerContext
from app.preparation.models import GeneratedRoadmap, RoadmapAction, RoadmapContent, PlanReview, PreparationRecord
from app.preparation.prompt import PreparationPrompt
from app.preparation.validation import PreparationValidator
from app.resumes.models import Usage


class PreparationService:
    def __init__(self, llm, repository, drafts, jobs, source_guard):
        self.llm, self.repository, self.source_guard = llm, repository, source_guard
        self.context = CareerContext(drafts, jobs)
        self.validator = PreparationValidator()

    async def validate_input(self, owner, input):
        self.llm.models.validate(input.model, input.reasoning)
        if not self.llm.available:
            raise IntelligenceError(503, "ANALYSIS_UNAVAILABLE")
        _, _, match = await self.context.load(owner, input.context)
        self.validator.choices(input.goals, match)
        return match

    async def generate(self, owner, input):
        async with self.llm.gate.claim():
            match = await self.validate_input(owner, input)
            await self.source_guard.check(owner, input.context)
            indexes = self.validator.choices(input.goals, match)
            cv = await self.context.drafts.get(owner, input.context.resume, analysis_id=input.context.draftId)
            if cv is None:
                raise IntelligenceError(404, 'ANALYSIS_NOT_FOUND')
            payload = {"requirements": self.context.project(match, indexes),
                       "relevantWork": self.context.relevant_work(cv, [match.items[index].requirement.value for index in indexes]),
                       "confirmedGoals": {**input.goals.model_dump(), "goal": self.context.clean(input.goals.goal)}}
            try:
                async with asyncio.timeout(self.llm.settings.timeout):
                    result = await self.llm.generate(input.model, input.reasoning, PreparationPrompt.instructions,
                                                     json.dumps(payload, ensure_ascii=False), GeneratedRoadmap, output_tokens=8192)
            except TimeoutError:
                raise IntelligenceError(504, "LLM_TIMEOUT") from None
            generated = self.validator.output(result.value, input.goals, match)
            await self.context.load(owner, input.context)
            await self.source_guard.check(owner, input.context)
            record = PreparationRecord(id=str(uuid4()), version=1, plannerVersion='preparation-v2', source=match.source, goals=input.goals,
                model=input.model, reasoning=input.reasoning, usage=Usage(inputTokens=result.input_tokens, outputTokens=result.output_tokens),
                createdAt=datetime.now(timezone.utc).isoformat(),
                plan=RoadmapContent(overview=generated.overview, weeks=generated.weeks, cautions=generated.cautions,
                    actions=[RoadmapAction(**action.model_dump(), id=f"action-{i + 1}") for i, action in enumerate(generated.actions)]),
                review=PlanReview(revision=0, actions=[]))
            return await self.repository.save(owner, record)
