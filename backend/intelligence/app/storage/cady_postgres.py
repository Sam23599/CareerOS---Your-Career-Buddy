from psycopg import Error
from psycopg.types.json import Jsonb
from psycopg_pool import PoolTimeout
from pydantic import ValidationError

from app.cady.models import CadyConversation
from app.core.errors import IntelligenceError
from app.storage.cady_base import CadyConversationRepository


class PostgresCadyRepository(CadyConversationRepository):
    def __init__(self, database):
        self.database = database

    @staticmethod
    def record(row):
        return CadyConversation(revision=row[0], context=row[1], turns=row[2], updatedAt=row[3].isoformat()) if row else CadyConversation(revision=0, context=None, turns=[], updatedAt=None)

    async def get(self, owner):
        self.database.require_ready()
        try:
            async with self.database.pool.connection() as connection:
                row = await (await connection.execute('SELECT revision,context,turns,updated_at FROM cady_conversations WHERE owner_id=%s', [owner])).fetchone()
                return self.record(row)
        except (Error, PoolTimeout, ValidationError):
            raise IntelligenceError(503, 'ANALYSIS_UNAVAILABLE') from None

    async def save(self, owner, revision, context, turns):
        self.database.require_ready()
        try:
            async with self.database.pool.connection() as connection:
                async with connection.transaction():
                    if context:
                        await self.database._lock(connection, owner, context.resume.resumeId)
                        deleted = await (await connection.execute('SELECT 1 FROM deleted_resume_sources WHERE owner_id=%s AND resume_id=%s', [owner, context.resume.resumeId])).fetchone()
                        if deleted:
                            raise IntelligenceError(409, 'MATCH_SOURCE_CHANGED')
                        for job in sorted(context.jobs, key=lambda item: item.jobId):
                            await self.database._lock(connection, owner, 'job:' + job.jobId)
                            deleted = await (await connection.execute('SELECT 1 FROM deleted_job_sources WHERE owner_id=%s AND job_id=%s', [owner, job.jobId])).fetchone()
                            if deleted:
                                raise IntelligenceError(409, 'MATCH_SOURCE_CHANGED')
                    await self.database._lock(connection, owner, 'cady:conversation')
                    row = await (await connection.execute('SELECT revision FROM cady_conversations WHERE owner_id=%s FOR UPDATE', [owner])).fetchone()
                    if (row[0] if row else 0) != revision:
                        raise IntelligenceError(409, 'CADY_CONVERSATION_CHANGED')
                    row = await (await connection.execute(
                        'INSERT INTO cady_conversations(owner_id,revision,context,turns) VALUES(%s,%s,%s,%s) '
                        'ON CONFLICT(owner_id) DO UPDATE SET revision=EXCLUDED.revision,context=EXCLUDED.context,turns=EXCLUDED.turns,updated_at=NOW() '
                        'RETURNING revision,context,turns,updated_at',
                        [owner, revision + 1, Jsonb(context.model_dump()) if context else None, Jsonb([turn.model_dump() for turn in turns])])).fetchone()
                    return self.record(row)
        except (Error, PoolTimeout, ValidationError):
            raise IntelligenceError(503, 'ANALYSIS_UNAVAILABLE') from None
