import asyncio
import os
from uuid import uuid4

import pytest
from psycopg import AsyncConnection, sql
from psycopg.conninfo import make_conninfo

from app.core.errors import IntelligenceError
from app.storage.postgres import PostgresDraftRepository
from app.tasks.repository import AnalysisTaskRepository
from test_jobs import source


@pytest.mark.skipif(not os.getenv('TEST_DATABASE_URL'), reason='Isolated PostgreSQL configuration required')
def test_tasks_persist_deduplicate_isolate_cancel_and_recover_without_paid_retry():
    async def run():
        url, database = os.environ['TEST_DATABASE_URL'], 'task_test_' + uuid4().hex
        admin = await AsyncConnection.connect(url, autocommit=True)
        await admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(database)))
        store = PostgresDraftRepository(make_conninfo(url, dbname=database))
        try:
            await store.start()
            assert store.ready
            tasks = AnalysisTaskRepository(store)
            owner, other, key = str(uuid4()), str(uuid4()), str(uuid4())
            options = {'model': 'gpt-6-luna', 'reasoning': 'medium'}
            first = await tasks.start(owner, source(), options, key)
            assert await tasks.start(owner, source(), options, key) == first
            assert await tasks.start(owner, source(), options, str(uuid4())) == first
            second = await tasks.start(other, source(), options, key)
            assert second != first
            assert [item['id'] for item in (await tasks.history(owner))['tasks']] == [first]
            with pytest.raises(IntelligenceError):
                await tasks.cancel(other, first)
            row = await tasks.claim()
            assert row[0] == first
            assert await tasks.claim() is None
            async with store.pool.connection() as connection:
                await connection.execute("UPDATE analysis_tasks SET lease_until=NOW()-INTERVAL '1 second' WHERE id=%s", [first])
            claimed = await tasks.claim()
            assert claimed[0] == second
            failed = (await tasks.history(owner))['tasks'][0]
            assert failed['state'] == 'failed' and failed['errorCode'] == 'LLM_TIMEOUT'
            assert 'payload' not in failed and 'owner' not in failed
            await tasks.finish(second, 'succeeded', str(uuid4()))
            assert await tasks.start(owner, source(), options, key) == first
            third = await tasks.start(owner, source(), options, str(uuid4()))
            await tasks.cancel(owner, third)
            assert await tasks.claim() is None
            await store.close()
            store = PostgresDraftRepository(make_conninfo(url, dbname=database))
            await store.start()
            assert (await AnalysisTaskRepository(store).history(other))['tasks'][0]['state'] == 'succeeded'
        finally:
            await store.close()
            await admin.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(database)))
            await admin.close()
    asyncio.run(run())
