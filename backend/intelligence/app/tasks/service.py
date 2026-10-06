import asyncio
import logging

from app.core.errors import ERRORS, IntelligenceError
from app.jobs.models import JobSource

logger = logging.getLogger(__name__)


class AnalysisTaskWorker:
    def __init__(self, repository, jobs):
        self.repository, self.jobs = repository, jobs
        self.task = None

    def start(self):
        self.task = asyncio.create_task(self.run())

    async def close(self):
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass

    async def run(self):
        while True:
            try:
                row = await self.repository.claim()
                if row:
                    await self.process(*row)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("analysis_task_worker_unavailable")
            await asyncio.sleep(2)

    async def process(self, task_id, owner, payload):
        try:
            record = await self.jobs.analyze(owner, JobSource.model_validate(payload['source']), payload['model'], payload['reasoning'])
            await self.repository.finish(task_id, 'succeeded', record.id)
        except asyncio.CancelledError:
            await self.repository.finish(task_id, 'failed', error_code='LLM_TIMEOUT')
            raise
        except IntelligenceError as error:
            # Gate contention happened before a provider request; provider failures never retry automatically.
            await self.repository.finish(task_id, 'queued' if error.code == 'INTELLIGENCE_BUSY' else 'failed',
                                         error_code=None if error.code == 'INTELLIGENCE_BUSY' else error.code if error.code in ERRORS else 'ANALYSIS_UNAVAILABLE')
        except Exception:
            await self.repository.finish(task_id, 'failed', error_code='ANALYSIS_UNAVAILABLE')
