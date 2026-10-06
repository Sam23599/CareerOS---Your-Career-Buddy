import asyncio
from uuid import uuid4
from types import SimpleNamespace

from fastapi import Request
import pytest

from app.api.jobs import JobAnalysisController
from app.core.errors import IntelligenceError
from app.llm.models import ModelRegistry
from app.tasks.service import AnalysisTaskWorker
from test_jobs import source


def test_worker_finishes_and_does_not_retry_provider_errors():
    class Repository:
        def __init__(self): self.finished = []
        async def finish(self, *args, **kwargs): self.finished.append((args, kwargs))

    class Jobs:
        async def analyze(self, *args):
            if self.error: raise IntelligenceError(503, self.error)
            return SimpleNamespace(id=str(uuid4()))

    async def run():
        repository, jobs = Repository(), Jobs()
        worker = AnalysisTaskWorker(repository, jobs)
        payload = {'source': source().model_dump(), 'model': 'gpt-6-luna', 'reasoning': 'medium'}
        for code, state in [(None, 'succeeded'), ('LLM_RATE_LIMITED', 'failed'), ('INTELLIGENCE_BUSY', 'queued')]:
            jobs.error = code
            await worker.process(str(uuid4()), str(uuid4()), payload)
            assert repository.finished[-1][0][1] == state
        assert len(repository.finished) == 3
    asyncio.run(run())


def test_task_controller_validates_content_type_and_owned_job_namespace_before_storage():
    token = 'a' * 64
    settings = SimpleNamespace(service_token=token, model='gpt-6-luna')
    controller = JobAnalysisController(settings, SimpleNamespace(llm=SimpleNamespace(models=ModelRegistry())))
    owner = str(uuid4())
    request = Request({'type': 'http', 'headers': [(b'authorization', f'Bearer {token}'.encode()),
                      (b'x-owner-id', owner.encode()), (b'content-type', b'text/plain')]})

    async def run():
        with pytest.raises(IntelligenceError) as error:
            await controller.start_task(source().jobId, request)
        assert error.value.status == 415 and error.value.code == 'JSON_REQUIRED'
        with pytest.raises(IntelligenceError) as error:
            await controller.tasks(request, 'not-a-job-id')
        assert error.value.status == 400 and error.value.code == 'INVALID_INPUT'
    asyncio.run(run())
