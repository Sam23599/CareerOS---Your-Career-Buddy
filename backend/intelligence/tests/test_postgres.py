import asyncio
from datetime import datetime, timezone
import os
from pathlib import Path
from uuid import uuid4

import pytest
from psycopg import AsyncConnection, sql
from psycopg.conninfo import make_conninfo
from psycopg.types.json import Jsonb

from app.core.errors import IntelligenceError
from app.resumes.models import DraftRecord, Source, Usage
from app.storage.postgres import PostgresDraftRepository
from test_drafts import draft, extraction


@pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"), reason="Explicit isolated PostgreSQL test configuration required")
def test_postgres_versions_pagination_concurrency_restart_and_delete_tombstone():
    async def run():
        url = os.environ["TEST_DATABASE_URL"]
        database = "draft_test_" + uuid4().hex
        admin = await AsyncConnection.connect(url, autocommit=True)
        await admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database)))
        repository = PostgresDraftRepository(make_conninfo(url, dbname=database))
        try:
            await repository.start()
            assert repository.ready
            owner = str(uuid4()); source = Source(resumeId=str(uuid4()), resumeVersion=1, sha256="a" * 64)
            record = DraftRecord(id=str(uuid4()), version=1, source=source, model="gpt-6-luna", reasoning="medium",
                                 usage=Usage(inputTokens=10, outputTokens=20), createdAt=datetime.now(timezone.utc).isoformat(),
                                 extraction=extraction(), draft=draft())
            await repository.save(owner, record)
            assert await repository.get(owner, source) == record
            second = record.model_copy(update={"id": str(uuid4()), "model": "gpt-4.1", "reasoning": None})
            second = await repository.save(owner, second)
            assert second.version == 2
            assert await repository.get(owner, source) == second
            assert await repository.get(owner, source, analysis_id=record.id) == record
            assert await repository.get(str(uuid4()), source, analysis_id=record.id) is None
            assert await repository.get(owner, source, analysis_id=str(uuid4())) is None
            assert await repository.get(str(uuid4()), source) is None
            assert await repository.get(owner, source, "gpt-4.1", None) == second
            assert await repository.get(owner, source.model_copy(update={"sha256": "b" * 64})) is None
            # Same ID retry is idempotent; a fresh successful analysis gets a new version even with identical settings.
            assert await repository.save(owner, record) == record
            third = await repository.save(owner, record.model_copy(update={"id": str(uuid4())}))
            assert third.version == 3
            concurrent = await asyncio.gather(*(repository.save(owner, record.model_copy(update={"id": str(uuid4())})) for _ in range(20)))
            assert sorted(item.version for item in concurrent) == list(range(4, 24))
            history = await repository.history(owner, source)
            assert [item.version for item in history.versions] == list(range(23, 3, -1))
            assert history.nextBeforeVersion == 4
            older = await repository.history(owner, source, history.nextBeforeVersion)
            assert [item.version for item in older.versions] == [3, 2, 1] and older.nextBeforeVersion is None
            assert not (await repository.history(str(uuid4()), source)).versions
            assert not (await repository.history(owner, source.model_copy(update={"sha256": "b" * 64}))).versions
            await repository.close()
            repository = PostgresDraftRepository(make_conninfo(url, dbname=database))
            await repository.start()
            assert await repository.get(owner, source, analysis_id=record.id) == record
            assert [item.version for item in (await repository.history(owner, source)).versions] == list(range(23, 3, -1))
            await repository.delete(owner, source.resumeId)
            await repository.delete(owner, source.resumeId)
            assert await repository.get(owner, source) is None
            assert not (await repository.history(owner, source)).versions
            with pytest.raises(IntelligenceError) as caught:
                await repository.save(owner, record)
            assert caught.value.code == "RESUME_NOT_FOUND"
        finally:
            await repository.close()
            await admin.execute(sql.SQL("DROP DATABASE {}").format(sql.Identifier(database)))
            await admin.close()
    asyncio.run(run())


@pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"), reason="Explicit isolated PostgreSQL test configuration required")
def test_version_migration_preserves_existing_drafts_and_runs_once():
    async def run():
        url = os.environ["TEST_DATABASE_URL"]
        database = "draft_migration_" + uuid4().hex
        admin = await AsyncConnection.connect(url, autocommit=True)
        await admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database)))
        repository = PostgresDraftRepository(make_conninfo(url, dbname=database))
        owner = str(uuid4()); source = Source(resumeId=str(uuid4()), resumeVersion=1, sha256="a" * 64)
        record = DraftRecord(id=str(uuid4()), version=1, source=source, model="gpt-6-luna", reasoning="medium",
                             usage=Usage(inputTokens=10, outputTokens=20), createdAt=datetime.now(timezone.utc).isoformat(),
                             extraction=extraction(), draft=draft())
        second = record.model_copy(update={"id": str(uuid4()), "model": "gpt-4.1", "reasoning": None})
        try:
            async with await AsyncConnection.connect(make_conninfo(url, dbname=database)) as connection:
                await connection.execute(Path(__file__).parents[1].joinpath("app/storage/schema.sql").read_text())
                for index, item in enumerate([record, second]):
                    await connection.execute(
                        "INSERT INTO resume_drafts (id,owner_id,resume_id,source_hash,source_version,analyzer_version,model,reasoning,record,created_at) "
                        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,TIMESTAMPTZ '2026-10-03 00:00:00Z' + %s * INTERVAL '1 second')",
                        [item.id, owner, source.resumeId, source.sha256, source.resumeVersion, item.analyzerVersion,
                         item.model, item.reasoning, Jsonb(item.model_dump(exclude={"version"})), index])
            await repository.start()
            assert repository.ready
            assert await repository.get(owner, source, analysis_id=record.id) == record
            assert await repository.get(owner, source, analysis_id=second.id) == second.model_copy(update={"version": 2})
            await repository.close()
            repository = PostgresDraftRepository(make_conninfo(url, dbname=database))
            await repository.start()
            newer = await repository.save(owner, record.model_copy(update={"id": str(uuid4())}))
            assert newer.version == 3
            assert await repository.get(owner, source, analysis_id=record.id) == record
        finally:
            await repository.close()
            await admin.execute(sql.SQL("DROP DATABASE {}").format(sql.Identifier(database)))
            await admin.close()
    asyncio.run(run())
