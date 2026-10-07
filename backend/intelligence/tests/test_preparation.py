import asyncio
import json
from uuid import uuid4

import pytest

from app.core.errors import IntelligenceError
from app.core.settings import Settings
from app.llm.models import ModelRegistry, StructuredResult
from app.llm.providers.base import LLMProvider, ProviderRegistry
from app.llm.service import LLMService
from app.matching.models import MatchInput
from app.preparation.models import GeneratedRoadmap, PreparationGoals, RoadmapGoals, PreparationInput
from app.preparation.service import PreparationService
from app.cady.models import CadyInput, GeneratedAnswer
from app.cady.service import CadyService
from app.preparation.validation import PreparationValidator
from app.matching.baseline import SkillCoverageMatcher
from test_drafts import MemoryDraftRepository
from test_jobs import MemoryJobs, record
from test_matching import resume


def generated():
    return GeneratedRoadmap(overview='Build a typed endpoint, expand it, test it, and explain it.', weeks=[{
        'week': week, 'objective': f'Stage {week}: practice and review TypeScript', 'milestone': f'Explain the stage {week} deliverable without notes'} for week in range(1, 5)], actions=[{
        'matchIndex': 1, 'kind': 'practice', 'week': 1, 'hours': 2, 'title': 'Build a typed endpoint',
        'detail': 'Create a small API endpoint and explain its input types.', 'outcome': 'A typed endpoint you can run'}] + [{
        'matchIndex': 1, 'kind': 'checkpoint', 'week': week, 'hours': 1, 'title': f'Review stage {week}',
        'detail': 'Test the endpoint, record what you learned, and explain it without notes.', 'outcome': f'A reviewed stage {week} deliverable'} for week in range(1, 5)],
        cautions=['Only add CV evidence after completing and verifying the work.'])


class AdviceProvider(LLMProvider):
    def __init__(self, value=None, error=None):
        self.value, self.error, self.requests = value or generated(), error, []

    async def generate(self, request):
        self.requests.append(request)
        if self.error:
            raise IntelligenceError(504, self.error)
        return StructuredResult(self.value, 30, 60)


class Plans:
    def __init__(self): self.records = []
    async def save(self, owner, record):
        self.records.append(record.model_copy(update={'version': len(self.records) + 1}))
        return self.records[-1]


class Guard:
    def __init__(self, fail_at=None): self.calls, self.fail_at = 0, fail_at
    async def check(self, owner, context):
        self.calls += 1
        if self.calls == self.fail_at:
            raise IntelligenceError(409, 'MATCH_SOURCE_CHANGED')


async def setup(provider=None, guard=None, settings=None):
    owner, cv, jd = str(uuid4()), resume(), record()
    drafts, jobs = MemoryDraftRepository(), MemoryJobs()
    await drafts.save(owner, cv); await jobs.save(owner, jd)
    registry, provider = ProviderRegistry(), provider or AdviceProvider()
    registry.register('openai', provider)
    llm = LLMService(settings or Settings(), registry, ModelRegistry())
    service = PreparationService(llm, Plans(), drafts, jobs, guard or Guard())
    context = MatchInput(resume=cv.source, draftId=cv.id, jobId=jd.source.jobId, jobHash=jd.source.sha256, jobAnalysisId=jd.id, profile=None)
    input = PreparationInput(context=context, model='gpt-6-luna', reasoning='medium', requestKey=str(uuid4()),
        goals=RoadmapGoals(choices=[{'matchIndex': 1, 'classification': 'want_to_learn'}], hoursPerWeek=5, weeks=4, goal='Prepare for an interview'))
    return owner, service, input, provider


def test_generation_binds_sources_preserves_versions_and_sends_minimal_context():
    async def run():
        owner, service, input, provider = await setup()
        cv = await service.context.drafts.get(owner, input.context.resume, analysis_id=input.context.draftId)
        cv.draft.email.value = 'private@example.com'; cv.draft.phone.value = '+91 9876543210'
        result = await service.generate(owner, input)
        assert result.source.draftId == input.context.draftId and result.source.jobAnalysisId == input.context.jobAnalysisId
        assert result.review.revision == 0 and result.plan.actions[0].id == 'action-1'
        assert (await service.generate(owner, input)).version == 2
        assert len(provider.requests) == 2 and service.source_guard.calls == 4
        payload = json.loads(provider.requests[0].input)
        assert payload['requirements'][0]['requirement'] == 'TypeScript'
        assert 'private@example.com' not in provider.requests[0].input and '9876543210' not in provider.requests[0].input
        assert 'Resume Tester' not in provider.requests[0].input and 'text' not in payload and 'pages' not in payload
        assert provider.requests[0].max_output_tokens == 8192
        assert 'never' in provider.requests[0].instructions.lower() and service.llm.gate.active is None
    asyncio.run(run())


@pytest.mark.parametrize('change', ['foreign', 'stale', 'invalid_index', 'duplicate', 'time_budget', 'model'])
def test_input_failures_make_no_provider_call(change):
    async def run():
        owner, service, input, provider = await setup()
        if change == 'foreign': owner = str(uuid4())
        if change == 'stale': input.context.jobHash = 'c' * 64
        if change == 'invalid_index': input.goals.choices[0].matchIndex = 349
        if change == 'duplicate': input.goals.choices.append(input.goals.choices[0])
        if change == 'time_budget':
            input.goals.hoursPerWeek = input.goals.weeks = 1
            input.goals.choices.append(input.goals.choices[0].model_copy(update={'matchIndex': 0}))
        if change == 'model': input.reasoning = 'none'; input.model = 'gpt-6.1-sol'
        with pytest.raises(IntelligenceError): await service.generate(owner, input)
        assert not provider.requests and not service.repository.records and service.llm.gate.active is None
    asyncio.run(run())


@pytest.mark.parametrize('fail_at', [1, 2])
def test_worker_rechecks_node_sources_before_spending_and_saving(fail_at):
    async def run():
        owner, service, input, provider = await setup(guard=Guard(fail_at))
        with pytest.raises(IntelligenceError) as caught: await service.generate(owner, input)
        assert caught.value.code == 'MATCH_SOURCE_CHANGED' and not service.repository.records
        assert len(provider.requests) == fail_at - 1
    asyncio.run(run())


@pytest.mark.parametrize('change', ['requirement', 'week', 'hours', 'classification', 'link', 'bare_link'])
def test_advice_validation_rejects_invented_references_and_time_or_classification_errors(change):
    goals = PreparationGoals(choices=[{'matchIndex': 1, 'classification': 'want_to_learn'}], hoursPerWeek=5, weeks=4, goal='')
    plan = generated(); match = SkillCoverageMatcher().compare(resume(), record())
    if change == 'requirement': plan.actions[0].matchIndex = 0
    if change == 'week': plan.actions[0].week = 5
    if change == 'hours': plan.actions[0].hours = 6
    if change == 'classification': goals.choices[0].classification = 'unsure'
    if change == 'link': plan.actions[0].detail = 'Use https://invented.example.com/course'
    if change == 'bare_link': plan.overview = 'Try made-up-course.com today'
    with pytest.raises(IntelligenceError): PreparationValidator().output(plan, goals, match)


@pytest.mark.parametrize('code', ['LLM_TIMEOUT', 'LLM_REFUSED', 'LLM_RATE_LIMITED'])
def test_failed_generations_do_not_save_or_retry(code):
    async def run():
        owner, service, input, provider = await setup(AdviceProvider(error=code))
        with pytest.raises(IntelligenceError): await service.generate(owner, input)
        assert len(provider.requests) == 1 and not service.repository.records
    asyncio.run(run())


def test_cady_uses_owned_context_cites_known_sources_and_does_not_persist_or_mutate():
    async def run():
        provider = AdviceProvider(GeneratedAnswer(paragraphs=[{'text': 'Python is present in your selected CV. Advice: practice the preferred TypeScript requirement.', 'references': ['cv-0', 'job-0-requirement-1']}], followUps=['What would you like to practice first?']))
        owner, preparation, context, _ = await setup(provider)
        service = CadyService(preparation.llm, preparation.context.drafts, preparation.context.jobs)
        input = CadyInput(resume=context.context.resume, draftId=context.context.draftId, jobs=[{
            'jobId': context.context.jobId, 'jobHash': context.context.jobHash, 'jobAnalysisId': context.context.jobAnalysisId}],
            profile=None, question='How can I prepare? contact me at private@example.com', history=[], model=context.model, reasoning=context.reasoning)
        result = await service.ask(owner, input)
        assert result.sources[0].jobAnalysisId == context.context.jobAnalysisId
        assert result.references[0].text == 'Python' and provider.requests[0].max_output_tokens == 4096
        assert 'private@example.com' not in provider.requests[0].input and 'Resume Tester' not in provider.requests[0].input
        assert len(preparation.context.drafts.records) == len(preparation.context.jobs.records) == 1 and not preparation.repository.records
        provider.value.paragraphs[0].references = ['foreign-source']
        with pytest.raises(IntelligenceError) as caught: await service.ask(owner, input)
        assert caught.value.code == 'LLM_RESPONSE_INVALID'
        count = len(provider.requests)
        with pytest.raises(IntelligenceError): await service.ask(str(uuid4()), input)
        assert len(provider.requests) == count
    asyncio.run(run())


@pytest.mark.parametrize('feature', ['preparation', 'cady'])
def test_cancellation_releases_shared_slot_without_saving_or_retrying(feature):
    class BlockingProvider(AdviceProvider):
        def __init__(self):
            super().__init__()
            self.started, self.cancelled = asyncio.Event(), False

        async def generate(self, request):
            self.requests.append(request)
            self.started.set()
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                self.cancelled = True
                raise

    async def run():
        provider = BlockingProvider()
        owner, preparation, input, _ = await setup(provider)
        cady = CadyService(preparation.llm, preparation.context.drafts, preparation.context.jobs)
        question = CadyInput(resume=input.context.resume, draftId=input.context.draftId, jobs=[],
            profile=None, question='How can I prepare?', history=[], model=input.model, reasoning=input.reasoning)
        call = preparation.generate(owner, input) if feature == 'preparation' else cady.ask(owner, question)
        task = asyncio.create_task(call)
        await asyncio.wait_for(provider.started.wait(), 1)
        with pytest.raises(IntelligenceError) as caught:
            await cady.ask(owner, question)
        assert caught.value.code == 'INTELLIGENCE_BUSY' and len(provider.requests) == 1
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert provider.cancelled and preparation.llm.gate.active is None
        assert not preparation.repository.records and len(provider.requests) == 1
        assert len(preparation.context.drafts.records) == len(preparation.context.jobs.records) == 1
    asyncio.run(run())


@pytest.mark.parametrize('change', ['missing_week', 'out_of_order', 'no_checkpoint', 'blank_outcome', 'blank_milestone'])
def test_roadmap_requires_complete_ordered_weeks_and_checkpoints(change):
    plan = generated()
    goals = RoadmapGoals(choices=[{'matchIndex': 1, 'classification': 'want_to_learn'}], hoursPerWeek=5, weeks=4, goal='')
    if change == 'missing_week': plan.weeks.pop()
    if change == 'out_of_order': plan.actions.reverse()
    if change == 'no_checkpoint': plan.actions[-1].kind = 'practice'
    if change == 'blank_outcome': plan.actions[0].outcome = ' '
    if change == 'blank_milestone': plan.weeks[0].milestone = ' '
    with pytest.raises(IntelligenceError): PreparationValidator().output(plan, goals, SkillCoverageMatcher().compare(resume(), record()))


def test_cady_persists_server_history_and_rejects_conflicts_before_ai():
    from app.cady.models import CadyConversation
    class Conversations:
        def __init__(self): self.values = {}
        async def get(self, owner): return self.values.get(owner, CadyConversation(revision=0, context=None, turns=[], updatedAt=None))
        async def save(self, owner, revision, context, turns):
            if (await self.get(owner)).revision != revision: raise IntelligenceError(409, 'CADY_CONVERSATION_CHANGED')
            self.values[owner] = CadyConversation(revision=revision + 1, context=context, turns=turns, updatedAt='2026-10-07T00:00:00Z')
            return self.values[owner]
    async def run():
        provider = AdviceProvider(GeneratedAnswer(paragraphs=[{'text': 'Practice TypeScript.', 'references': ['job-0-requirement-1']}], followUps=[]))
        owner, preparation, selected, _ = await setup(provider)
        repository = Conversations()
        service = CadyService(preparation.llm, preparation.context.drafts, preparation.context.jobs, repository)
        input = CadyInput(resume=selected.context.resume, draftId=selected.context.draftId, jobs=[{'jobId': selected.context.jobId, 'jobHash': selected.context.jobHash, 'jobAnalysisId': selected.context.jobAnalysisId}], profile=None, question='How should I prepare?', history=[], model=selected.model, reasoning=selected.reasoning, revision=0)
        first = await service.ask(owner, input)
        assert first.conversationRevision == 1
        saved = await repository.get(owner)
        assert saved.context.jobs[0].jobId == input.jobs[0].jobId and saved.turns[0].result == first
        with pytest.raises(IntelligenceError) as error: await service.ask(owner, input)
        assert error.value.code == 'CADY_CONVERSATION_CHANGED' and len(provider.requests) == 1
        changed = input.model_copy(update={'revision': 1, 'jobs': []})
        with pytest.raises(IntelligenceError) as error: await service.ask(owner, changed)
        assert error.value.code == 'CADY_CONTEXT_CHANGED' and len(provider.requests) == 1
        for revision in range(1, 12): await service.ask(owner, input.model_copy(update={'revision': revision}))
        assert len((await repository.get(owner)).turns) == 10
        assert len(json.loads(provider.requests[-1].input)['history']) == 6
        assert not (await repository.get(str(uuid4()))).turns
        assert (await repository.save(owner, 12, None, [])).revision == 13
        # A service recreated after refresh reads persisted history from the same repository.
        provider.value.paragraphs[0].references = ['cv-0']
        reopened = CadyService(preparation.llm, preparation.context.drafts, preparation.context.jobs, repository)
        await reopened.ask(owner, input.model_copy(update={'revision': 13, 'jobs': []}))
        assert json.loads(provider.requests[-1].input)['history'] == []
    asyncio.run(run())
