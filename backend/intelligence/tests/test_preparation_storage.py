import asyncio
import os
from uuid import uuid4

import pytest
from psycopg import AsyncConnection, sql
from psycopg.conninfo import make_conninfo

from app.core.errors import IntelligenceError
from app.preparation.models import PlanReview
from app.storage.postgres import PostgresDraftRepository
from app.storage.jobs_postgres import PostgresJobAnalysisRepository
from app.storage.preparation_postgres import PostgresPreparationRepository
from app.tasks.repository import AnalysisTaskRepository
from app.tasks.service import AnalysisTaskWorker
from test_preparation import setup


@pytest.mark.skipif(not os.getenv('TEST_DATABASE_URL'), reason='Isolated PostgreSQL required')
def test_owned_plan_versions_review_cas_restart_tasks_and_hard_cleanup():
    async def run():
        url, database = os.environ['TEST_DATABASE_URL'], 'preparation_test_' + uuid4().hex
        admin = await AsyncConnection.connect(url, autocommit=True)
        await admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(database)))
        store = PostgresDraftRepository(make_conninfo(url, dbname=database))
        try:
            await store.start(); assert store.ready
            owner, service, input, provider = await setup()
            cv = await service.context.drafts.get(owner, input.context.resume, analysis_id=input.context.draftId)
            jd = await service.context.jobs.get(owner, input.context.jobId, input.context.jobHash, input.context.jobAnalysisId)
            await store.save(owner, cv); jobs = PostgresJobAnalysisRepository(store); await jobs.save(owner, jd)
            plans = PostgresPreparationRepository(store)
            service.repository = plans; service.context.drafts = store; service.context.jobs = jobs
            tasks = AnalysisTaskRepository(store)
            task_id = await tasks.start_preparation(owner, input)
            assert await tasks.start_preparation(owner, input) == task_id
            history = await tasks.history(owner)
            assert history['tasks'][0]['kind'] == 'preparation' and 'payload' not in history['tasks'][0]
            changed = input.model_copy(update={'goals': input.goals.model_copy(update={'goal': 'Different intent'})})
            with pytest.raises(IntelligenceError): await tasks.start_preparation(owner, changed)
            await AnalysisTaskWorker(tasks, None, service).process(*(await tasks.claim()))
            task = (await tasks.history(owner))['tasks'][0]
            assert task['state'] == 'succeeded' and len(provider.requests) == 1
            first = await plans.get(owner, input.context.jobId, task['analysisId'])
            assert first.version == 1
            assert (await plans.save(owner, first)).version == 1
            other = str(uuid4())
            with pytest.raises(IntelligenceError): await plans.get(other, input.context.jobId, first.id)
            with pytest.raises(IntelligenceError): await plans.review(other, input.context.jobId, first.id, PlanReview(revision=0, actions=[]))
            review = PlanReview(revision=0, actions=[{'id': first.plan.actions[0].id, 'title': 'My reviewed task', 'detail': 'My own notes', 'status': 'done'}])
            updated = await plans.review(owner, input.context.jobId, first.id, review)
            assert updated.review.revision == 1 and updated.plan == first.plan
            with pytest.raises(IntelligenceError) as caught: await plans.review(owner, input.context.jobId, first.id, review)
            assert caught.value.code == 'PREPARATION_CHANGED'
            with pytest.raises(IntelligenceError): await plans.review(owner, input.context.jobId, first.id, PlanReview(revision=1, actions=[{'id': 'action-999', 'title': 'Unknown', 'detail': 'bad', 'status': 'planned'}]))
            for _ in range(21): await plans.save(owner, first.model_copy(update={'id': str(uuid4())}))
            history = await plans.history(owner, input.context.jobId)
            assert [item.version for item in history.versions] == list(range(22, 2, -1)) and history.nextBeforeVersion == 3
            assert [item.version for item in (await plans.history(owner, input.context.jobId, 3)).versions] == [2, 1]
            assert not (await plans.history(other, input.context.jobId)).versions
            await store.close(); store = PostgresDraftRepository(make_conninfo(url, dbname=database)); await store.start()
            plans = PostgresPreparationRepository(store)
            assert (await plans.get(owner, input.context.jobId, first.id)).review.revision == 1
            queued = await AnalysisTaskRepository(store).start_preparation(owner, input.model_copy(update={'requestKey': str(uuid4())}))
            await store.delete(owner, input.context.resume.resumeId)
            assert (await AnalysisTaskRepository(store).history(owner))['tasks'][0]['state'] == 'cancelled'
            assert queued != task_id and not (await plans.history(owner, input.context.jobId)).versions
            with pytest.raises(IntelligenceError): await plans.save(owner, first)
            # A distinct source proves job hard cleanup also removes derived plans.
            next_owner = str(uuid4()); await plans.save(next_owner, first.model_copy(update={'id': str(uuid4())}))
            await PostgresJobAnalysisRepository(store).delete(next_owner, input.context.jobId)
            assert not (await plans.history(next_owner, input.context.jobId)).versions
            with pytest.raises(IntelligenceError): await plans.save(next_owner, first)
        finally:
            await store.close()
            await admin.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(database)))
            await admin.close()
    asyncio.run(run())
