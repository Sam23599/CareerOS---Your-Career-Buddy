from pathlib import Path

from psycopg import Error
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool, PoolTimeout
from pydantic import ValidationError

from app.core.errors import IntelligenceError
from app.resumes.models import DraftHistory, DraftRecord, DraftSummary, Source
from app.storage.base import DraftRepository


class PostgresDraftRepository(DraftRepository):
    def __init__(self, url: str):
        self.pool = AsyncConnectionPool(url, min_size=0, max_size=3, open=False, timeout=3,
                                        kwargs={"connect_timeout": 3, "options": "-c statement_timeout=5000"}) if url else None
        self.ready = False

    async def start(self):
        if self.pool is None:
            return
        await self.pool.open()
        try:
            async with self.pool.connection() as connection:
                async with connection.transaction():
                    await connection.execute("SELECT pg_advisory_xact_lock(726301)")
                    await connection.execute(Path(__file__).with_name("schema.sql").read_text())
                    await connection.execute("CREATE TABLE IF NOT EXISTS intelligence_migrations (name TEXT PRIMARY KEY)")
                    for migration in sorted(Path(__file__).with_name("migrations").glob("*.sql")):
                        applied = await (await connection.execute(
                            "SELECT 1 FROM intelligence_migrations WHERE name = %s", [migration.name])).fetchone()
                        if not applied:
                            await connection.execute(migration.read_text())
                            await connection.execute("INSERT INTO intelligence_migrations (name) VALUES (%s)", [migration.name])
            self.ready = True
        except (Error, PoolTimeout):
            self.ready = False

    async def close(self):
        if self.pool is not None:
            await self.pool.close()

    def require_ready(self):
        if not self.ready or self.pool is None:
            raise IntelligenceError(503, "ANALYSIS_UNAVAILABLE")

    async def get(self, owner: str, source: Source, model=None, reasoning=None, analysis_id=None):
        self.require_ready()
        try:
            async with self.pool.connection() as connection:
                where = " AND model = %s AND reasoning IS NOT DISTINCT FROM %s" if model else ""
                params = [owner, source.resumeId, source.sha256, source.resumeVersion]
                if model:
                    params.extend([model, reasoning])
                if analysis_id:
                    where += " AND id = %s"
                    params.append(analysis_id)
                row = await (await connection.execute(
                    "SELECT record FROM resume_drafts WHERE owner_id = %s AND resume_id = %s "
                    "AND source_hash = %s AND source_version = %s AND analyzer_version = 'resume-draft-v1'" + where +
                    " ORDER BY draft_version DESC LIMIT 1", params)).fetchone()
                return DraftRecord.model_validate(row[0]) if row else None
        except (Error, PoolTimeout, ValidationError):
            raise IntelligenceError(503, "ANALYSIS_UNAVAILABLE") from None

    async def save(self, owner: str, record: DraftRecord):
        self.require_ready()
        try:
            async with self.pool.connection() as connection:
                async with connection.transaction():
                    await self._lock(connection, owner, record.source.resumeId)
                    deleted = await (await connection.execute(
                        "SELECT 1 FROM deleted_resume_sources WHERE owner_id = %s AND resume_id = %s",
                        [owner, record.source.resumeId])).fetchone()
                    if deleted:
                        raise IntelligenceError(404, "RESUME_NOT_FOUND")
                    existing = await (await connection.execute(
                        "SELECT record FROM resume_drafts WHERE owner_id = %s AND resume_id = %s AND id = %s",
                        [owner, record.source.resumeId, record.id])).fetchone()
                    if existing:
                        return DraftRecord.model_validate(existing[0])
                    row = await (await connection.execute(
                        "SELECT COALESCE(MAX(draft_version), 0) + 1 FROM resume_drafts WHERE owner_id = %s AND resume_id = %s",
                        [owner, record.source.resumeId])).fetchone()
                    record = record.model_copy(update={"version": row[0]})
                    await connection.execute(
                        "INSERT INTO resume_drafts (id, owner_id, resume_id, source_hash, source_version, "
                        "analyzer_version, model, reasoning, record, draft_version) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                        [record.id, owner, record.source.resumeId, record.source.sha256,
                        record.source.resumeVersion, record.analyzerVersion, record.model, record.reasoning,
                        Jsonb(record.model_dump()), record.version])
                    return record
        except (Error, PoolTimeout, ValidationError):
            raise IntelligenceError(503, "ANALYSIS_UNAVAILABLE") from None

    async def history(self, owner: str, source: Source, before_version: int | None = None):
        self.require_ready()
        try:
            async with self.pool.connection() as connection:
                cursor = " AND draft_version < %s" if before_version is not None else ""
                params = [owner, source.resumeId, source.sha256, source.resumeVersion]
                if before_version is not None:
                    params.append(before_version)
                rows = await (await connection.execute(
                    "SELECT id::TEXT, draft_version, model, reasoning, record->>'createdAt' FROM resume_drafts "
                    "WHERE owner_id = %s AND resume_id = %s AND source_hash = %s AND source_version = %s "
                    "AND analyzer_version = 'resume-draft-v1'" + cursor + " ORDER BY draft_version DESC LIMIT 21", params)).fetchall()
                versions = [DraftSummary(id=row[0], version=row[1], model=row[2], reasoning=row[3], createdAt=row[4]) for row in rows[:20]]
                return DraftHistory(versions=versions, nextBeforeVersion=versions[-1].version if len(rows) > 20 else None)
        except (Error, PoolTimeout, ValidationError):
            raise IntelligenceError(503, "ANALYSIS_UNAVAILABLE") from None

    async def delete(self, owner: str, resume_id: str):
        self.require_ready()
        try:
            async with self.pool.connection() as connection:
                async with connection.transaction():
                    await self._lock(connection, owner, resume_id)
                    await connection.execute("INSERT INTO deleted_resume_sources (owner_id,resume_id) VALUES (%s,%s) "
                                             "ON CONFLICT DO NOTHING", [owner, resume_id])
                    await connection.execute("DELETE FROM resume_drafts WHERE owner_id = %s AND resume_id = %s",
                                             [owner, resume_id])
                    await connection.execute("DELETE FROM cady_conversations WHERE owner_id=%s AND context->'resume'->>'resumeId'=%s", [owner, resume_id])
                    await connection.execute("DELETE FROM preparation_plans WHERE owner_id=%s AND resume_id=%s", [owner, resume_id])
                    await connection.execute("UPDATE analysis_tasks SET state='cancelled',updated_at=NOW() WHERE owner_id=%s AND kind='preparation' AND payload->'context'->'resume'->>'resumeId'=%s AND state='queued'", [owner, resume_id])
        except (Error, PoolTimeout):
            raise IntelligenceError(503, "ANALYSIS_UNAVAILABLE") from None

    @staticmethod
    async def _lock(connection, owner, resume_id):
        await connection.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", [owner + ":" + resume_id])
