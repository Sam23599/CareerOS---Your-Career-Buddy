from psycopg import Error
from psycopg.types.json import Jsonb
from psycopg_pool import PoolTimeout
from pydantic import ValidationError

from app.core.errors import IntelligenceError
from app.preparation.models import PreparationHistory, PreparationRecord, PreparationSummary
from app.storage.preparation_base import PreparationRepository


class PostgresPreparationRepository(PreparationRepository):
    def __init__(self, database):
        self.database = database

    @staticmethod
    def record(row):
        return PreparationRecord.model_validate({**row[0], "review": row[1]})

    async def save(self, owner, record):
        self.database.require_ready()
        try:
            async with self.database.pool.connection() as connection:
                async with connection.transaction():
                    await self.database._lock(connection, owner, record.source.resume.resumeId)
                    await self.database._lock(connection, owner, "job:" + record.source.jobId)
                    deleted = await (await connection.execute(
                        "SELECT 1 FROM deleted_resume_sources WHERE owner_id=%s AND resume_id=%s UNION ALL "
                        "SELECT 1 FROM deleted_job_sources WHERE owner_id=%s AND job_id=%s",
                        [owner, record.source.resume.resumeId, owner, record.source.jobId])).fetchone()
                    if deleted:
                        raise IntelligenceError(409, "MATCH_SOURCE_CHANGED")
                    existing = await (await connection.execute("SELECT record,review FROM preparation_plans WHERE owner_id=%s AND id=%s", [owner, record.id])).fetchone()
                    if existing:
                        return self.record(existing)
                    version = await (await connection.execute("SELECT COALESCE(MAX(plan_version),0)+1 FROM preparation_plans WHERE owner_id=%s AND job_id=%s", [owner, record.source.jobId])).fetchone()
                    record = record.model_copy(update={"version": version[0]})
                    await connection.execute("INSERT INTO preparation_plans(id,owner_id,job_id,resume_id,plan_version,record,review) VALUES(%s,%s,%s,%s,%s,%s,%s)",
                        [record.id, owner, record.source.jobId, record.source.resume.resumeId, record.version,
                         Jsonb(record.model_dump(exclude={"review"})), Jsonb(record.review.model_dump())])
                    return record
        except (Error, PoolTimeout, ValidationError):
            raise IntelligenceError(503, "ANALYSIS_UNAVAILABLE") from None

    async def get(self, owner, job_id, plan_id):
        self.database.require_ready()
        try:
            async with self.database.pool.connection() as connection:
                row = await (await connection.execute("SELECT record,review FROM preparation_plans WHERE owner_id=%s AND job_id=%s AND id=%s", [owner, job_id, plan_id])).fetchone()
                if not row:
                    raise IntelligenceError(404, "PREPARATION_NOT_FOUND")
                return self.record(row)
        except (Error, PoolTimeout, ValidationError):
            raise IntelligenceError(503, "ANALYSIS_UNAVAILABLE") from None

    async def history(self, owner, job_id, before=None):
        self.database.require_ready()
        try:
            async with self.database.pool.connection() as connection:
                rows = await (await connection.execute("SELECT record,review FROM preparation_plans WHERE owner_id=%s AND job_id=%s" +
                    (" AND plan_version<%s" if before else "") + " ORDER BY plan_version DESC LIMIT 21",
                    [owner, job_id, before] if before else [owner, job_id])).fetchall()
                records = [self.record(row) for row in rows[:20]]
                summaries = [PreparationSummary(**{key: getattr(record, key) for key in PreparationSummary.model_fields if key != "reviewRevision"}, reviewRevision=record.review.revision) for record in records]
                return PreparationHistory(versions=summaries, nextBeforeVersion=records[-1].version if len(rows) > 20 else None)
        except (Error, PoolTimeout, ValidationError):
            raise IntelligenceError(503, "ANALYSIS_UNAVAILABLE") from None

    async def review(self, owner, job_id, plan_id, review):
        self.database.require_ready()
        try:
            async with self.database.pool.connection() as connection:
                async with connection.transaction():
                    row = await (await connection.execute("SELECT record,review FROM preparation_plans WHERE owner_id=%s AND job_id=%s AND id=%s FOR UPDATE", [owner, job_id, plan_id])).fetchone()
                    if not row:
                        raise IntelligenceError(404, "PREPARATION_NOT_FOUND")
                    record = self.record(row)
                    if record.review.revision != review.revision:
                        raise IntelligenceError(409, "PREPARATION_CHANGED")
                    ids = [action.id for action in review.actions]
                    if len(set(ids)) != len(ids) or not set(ids).issubset({action.id for action in record.plan.actions}):
                        raise IntelligenceError(400, "INVALID_INPUT")
                    updated = review.model_copy(update={"revision": review.revision + 1})
                    await connection.execute("UPDATE preparation_plans SET review=%s,review_revision=%s WHERE id=%s", [Jsonb(updated.model_dump()), updated.revision, plan_id])
                    return record.model_copy(update={"review": updated})
        except (Error, PoolTimeout, ValidationError):
            raise IntelligenceError(503, "ANALYSIS_UNAVAILABLE") from None
