import asyncio
import json

from app.cady.models import CadyResult, ContextReference, GeneratedAnswer
from app.cady.prompt import CadyPrompt
from app.core.errors import IntelligenceError
from app.llm.validation import ResponseValidationError
from app.matching.models import MatchInput
from app.preparation.context import CareerContext
from app.preparation.validation import PreparationValidator
from app.resumes.models import Usage


class CadyService:
    def __init__(self, llm, drafts, jobs):
        self.llm, self.context = llm, CareerContext(drafts, jobs)

    async def ask(self, owner, input):
        self.llm.models.validate(input.model, input.reasoning)
        async with self.llm.gate.claim():
            cv = await self.context.drafts.get(owner, input.resume, analysis_id=input.draftId)
            if cv is None or cv.id != input.draftId or cv.source != input.resume:
                raise IntelligenceError(404, 'ANALYSIS_NOT_FOUND')
            references, sources, comparisons = [], [], []
            for index, fact in enumerate((cv.draft.skills + cv.draft.technologies)[:30]):
                if fact.value:
                    references.append(ContextReference(id=f'cv-{index}', label='Selected CV skill', text=self.context.clean(fact.value)))
            if input.profile:
                for index, skill in enumerate(input.profile.skills[:10]):
                    references.append(ContextReference(id=f'profile-{index}', label='Profile skill (self-reported)', text=self.context.clean(skill)))
            if len({job.jobId for job in input.jobs}) != len(input.jobs):
                raise IntelligenceError(400, 'INVALID_INPUT')
            for index, job in enumerate(input.jobs):
                context = MatchInput(resume=input.resume, draftId=input.draftId, profile=input.profile, **job.model_dump())
                _, jd, match = await self.context.load(owner, context)
                sources.append(match.source)
                chosen = sorted(range(len(match.items)), key=lambda i: (match.items[i].status == 'matched', {'required': 0, 'unspecified': 1, 'preferred': 2}[match.items[i].requirement.priority]))[:12]
                job_ref = f'job-{index}'
                references.append(ContextReference(id=job_ref, label=f'Job {index + 1}', text=self.context.clean(jd.analysis.title.value or 'Selected job')))
                projected = self.context.project(match, chosen)
                for item in projected:
                    ref = f'job-{index}-requirement-{item["matchIndex"]}'
                    references.append(ContextReference(id=ref, label=f'Job {index + 1} requirement', text=item['requirement']))
                    item['referenceId'] = ref
                comparisons.append({'jobReference': job_ref, 'skillCoverage': match.score, 'coverageIsNotHiringProbability': True, 'requirements': projected})
            text = json.dumps({'question': self.context.clean(input.question), 'history': [{**turn.model_dump(), 'text': self.context.clean(turn.text)} for turn in input.history],
                'references': [ref.model_dump() for ref in references], 'comparisons': comparisons}, ensure_ascii=False)
            try:
                async with asyncio.timeout(self.llm.settings.timeout):
                    result = await self.llm.generate(input.model, input.reasoning, CadyPrompt.instructions, text, GeneratedAnswer, output_tokens=4096)
            except TimeoutError:
                raise IntelligenceError(504, 'LLM_TIMEOUT') from None
            allowed = {reference.id for reference in references}
            if any(not set(paragraph.references).issubset(allowed) or len(set(paragraph.references)) != len(paragraph.references) for paragraph in result.value.paragraphs):
                raise ResponseValidationError('cady', 'unknown_reference')
            PreparationValidator.no_links(result.value.model_dump_json())
            return CadyResult(resume=cv.source, draftId=cv.id, draftVersion=cv.version, sources=sources,
                profileVersion=input.profile.version if input.profile else None, answer=result.value, references=references,
                model=input.model, reasoning=input.reasoning, usage=Usage(inputTokens=result.input_tokens, outputTokens=result.output_tokens))
