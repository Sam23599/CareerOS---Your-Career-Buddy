from psycopg import Error
from psycopg.types.json import Jsonb
from psycopg_pool import PoolTimeout
from pydantic import ValidationError

from app.core.errors import IntelligenceError
from app.jobs.models import JobAnalysisHistory, JobAnalysisRecord, JobAnalysisSummary
from app.storage.jobs_base import JobAnalysisRepository
from app.storage.postgres import PostgresDraftRepository


class PostgresJobAnalysisRepository(JobAnalysisRepository):
    def __init__(self, database: PostgresDraftRepository):
        self.database = database

    @property
    def ready(self):
        return self.database.ready

    async def get(self, owner, job_id, source_hash, analysis_id=None):
        self.database.require_ready()
        try:
            async with self.database.pool.connection() as connection:
                where = " AND id = %s" if analysis_id else ""
                params = [owner, job_id] + ([analysis_id] if analysis_id else []) + [source_hash]
                row = await (await connection.execute(
                    "SELECT record FROM job_analyses WHERE owner_id = %s AND job_id = %s "
                    "AND record->>'analyzerVersion' = 'job-analysis-v1'" + where +
                    " ORDER BY (source_hash = %s) DESC, analysis_version DESC LIMIT 1", params)).fetchone()
                return JobAnalysisRecord.model_validate(row[0]) if row else None
        except (Error, PoolTimeout, ValidationError):
            raise IntelligenceError(503, "ANALYSIS_UNAVAILABLE") from None

    async def history(self, owner, job_id, before_version=None):
        self.database.require_ready()
        try:
            async with self.database.pool.connection() as connection:
                cursor = " AND analysis_version < %s" if before_version is not None else ""
                params = [owner, job_id] + ([before_version] if before_version is not None else [])
                rows = await (await connection.execute(
                    "SELECT id::TEXT,analysis_version,record->>'model',record->>'reasoning',record->>'createdAt',source_hash "
                    "FROM job_analyses WHERE owner_id = %s AND job_id = %s AND record->>'analyzerVersion' = 'job-analysis-v1'" +
                    cursor + " ORDER BY analysis_version DESC LIMIT 21", params)).fetchall()
                versions = [JobAnalysisSummary(id=row[0], version=row[1], model=row[2], reasoning=row[3], createdAt=row[4], sourceHash=row[5]) for row in rows[:20]]
                return JobAnalysisHistory(versions=versions, nextBeforeVersion=versions[-1].version if len(rows) > 20 else None)
        except (Error, PoolTimeout, ValidationError):
            raise IntelligenceError(503, "ANALYSIS_UNAVAILABLE") from None

    async def save(self, owner, record):
        self.database.require_ready()
        try:
            async with self.database.pool.connection() as connection:
                async with connection.transaction():
                    await self.database._lock(connection, owner, "job:" + record.source.jobId)
                    deleted = await (await connection.execute(
                        "SELECT 1 FROM deleted_job_sources WHERE owner_id = %s AND job_id = %s", [owner, record.source.jobId])).fetchone()
                    if deleted:
                        raise IntelligenceError(404, "JOB_NOT_FOUND")
                    existing = await (await connection.execute(
                        "SELECT record FROM job_analyses WHERE owner_id = %s AND job_id = %s AND id = %s", [owner, record.source.jobId, record.id])).fetchone()
                    if existing:
                        return JobAnalysisRecord.model_validate(existing[0])
                    row = await (await connection.execute(
                        "SELECT COALESCE(MAX(analysis_version),0) + 1 FROM job_analyses WHERE owner_id = %s AND job_id = %s", [owner, record.source.jobId])).fetchone()
                    record = record.model_copy(update={"version": row[0]})
                    await connection.execute("INSERT INTO job_analyses (id,owner_id,job_id,source_hash,analysis_version,record) VALUES (%s,%s,%s,%s,%s,%s)",
                                             [record.id, owner, record.source.jobId, record.source.sha256, record.version, Jsonb(record.model_dump())])
                    return record
        except (Error, PoolTimeout, ValidationError):
            raise IntelligenceError(503, "ANALYSIS_UNAVAILABLE") from None

    async def delete(self, owner, job_id):
        self.database.require_ready()
        try:
            async with self.database.pool.connection() as connection:
                async with connection.transaction():
                    await self.database._lock(connection, owner, "job:" + job_id)
                    await connection.execute("INSERT INTO deleted_job_sources (owner_id,job_id) VALUES (%s,%s) ON CONFLICT DO NOTHING", [owner, job_id])
                    await connection.execute("DELETE FROM job_analyses WHERE owner_id = %s AND job_id = %s", [owner, job_id])
                    await connection.execute("DELETE FROM cady_conversations WHERE owner_id=%s AND EXISTS (SELECT 1 FROM jsonb_array_elements(context->'jobs') AS item WHERE item->>'jobId'=%s)", [owner, job_id])
                    await connection.execute("DELETE FROM preparation_plans WHERE owner_id=%s AND job_id=%s", [owner, job_id])
                    await connection.execute("UPDATE analysis_tasks SET state='cancelled',updated_at=NOW() WHERE owner_id=%s AND job_id=%s AND state='queued'", [owner, job_id])
        except (Error, PoolTimeout):
            raise IntelligenceError(503, "ANALYSIS_UNAVAILABLE") from None
