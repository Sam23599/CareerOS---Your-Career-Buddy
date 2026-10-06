from uuid import uuid4

from psycopg.types.json import Jsonb

from app.core.errors import IntelligenceError


class AnalysisTaskRepository:
    def __init__(self, database):
        self.database = database

    @staticmethod
    def public(row):
        return {"id": str(row[0]), "jobId": row[1], "sourceHash": row[2], "state": row[3],
                "createdAt": row[4].isoformat(), "updatedAt": row[5].isoformat(),
                "analysisId": str(row[6]) if row[6] else None, "errorCode": row[7]}

    async def start(self, owner, source, options, request_key):
        self.database.require_ready()
        async with self.database.pool.connection() as connection:
            async with connection.transaction():
                await connection.execute("SELECT pg_advisory_xact_lock(726304)")
                existing = await (await connection.execute(
                    "SELECT id::TEXT,job_id FROM analysis_tasks WHERE owner_id=%s AND "
                    "(request_key=%s OR (job_id=%s AND state IN ('queued','running'))) ORDER BY created_at LIMIT 1",
                    [owner, request_key, source.jobId])).fetchone()
                if existing:
                    if existing[1] != source.jobId:
                        raise IntelligenceError(400, "INVALID_INPUT")
                    return existing[0]
                count = await (await connection.execute(
                    "SELECT COUNT(*),COUNT(*) FILTER (WHERE owner_id=%s) FROM analysis_tasks WHERE state IN ('queued','running')",
                    [owner])).fetchone()
                if count[0] >= 20 or count[1] >= 2:
                    raise IntelligenceError(503, "INTELLIGENCE_BUSY")
                task_id = str(uuid4())
                await connection.execute("INSERT INTO analysis_tasks(id,owner_id,job_id,request_key,source_hash,payload,state) "
                                         "VALUES(%s,%s,%s,%s,%s,%s,'queued')",
                                         [task_id, owner, source.jobId, request_key, source.sha256,
                                          Jsonb({"source": source.model_dump(), **options})])
                return task_id

    async def history(self, owner, job_id=None):
        self.database.require_ready()
        async with self.database.pool.connection() as connection:
            rows = await (await connection.execute(
                "SELECT id,job_id,source_hash,state,created_at,updated_at,analysis_id,error_code FROM analysis_tasks "
                "WHERE owner_id=%s" + (" AND job_id=%s" if job_id else "") + " ORDER BY created_at DESC LIMIT 100",
                [owner, job_id] if job_id else [owner])).fetchall()
        return {"tasks": [self.public(row) for row in rows]}

    async def claim(self):
        self.database.require_ready()
        async with self.database.pool.connection() as connection:
            async with connection.transaction():
                await connection.execute("UPDATE analysis_tasks SET state='failed',error_code='LLM_TIMEOUT',updated_at=NOW() "
                                         "WHERE state='running' AND lease_until < NOW()")
                # Serialize workers even when multiple intelligence processes are used.
                await connection.execute("SELECT pg_advisory_xact_lock(726304)")
                running = await (await connection.execute("SELECT 1 FROM analysis_tasks WHERE state='running' LIMIT 1")).fetchone()
                if running:
                    return None
                row = await (await connection.execute("SELECT id::TEXT,owner_id,payload FROM analysis_tasks WHERE state='queued' "
                                                     "ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED")).fetchone()
                if row:
                    await connection.execute("UPDATE analysis_tasks SET state='running',lease_until=NOW()+INTERVAL '3 minutes',updated_at=NOW() WHERE id=%s", [row[0]])
                return row

    async def finish(self, task_id, state, analysis_id=None, error_code=None):
        async with self.database.pool.connection() as connection:
            await connection.execute("UPDATE analysis_tasks SET state=%s,analysis_id=%s,error_code=%s,lease_until=NULL,updated_at=NOW() "
                                     "WHERE id=%s AND state='running'", [state, analysis_id, error_code, task_id])

    async def cancel(self, owner, task_id):
        self.database.require_ready()
        async with self.database.pool.connection() as connection:
            result = await connection.execute("UPDATE analysis_tasks SET state='cancelled',updated_at=NOW() WHERE id=%s AND owner_id=%s AND state='queued'", [task_id, owner])
            if not result.rowcount:
                raise IntelligenceError(400, "INVALID_INPUT")
