import re
from uuid import UUID

from fastapi import Request
from pydantic import ValidationError

from app.core.errors import IntelligenceError
from app.core.requests import RequestCancellation
from app.core.security import ServiceAuthenticator
from app.core.settings import Settings
from app.jobs.models import JobSource
from app.jobs.service import JobAnalysisService


class JobAnalysisController:
    def __init__(self, settings: Settings, jobs: JobAnalysisService):
        self.settings, self.jobs = settings, jobs
        self.auth = ServiceAuthenticator(settings.service_token)
        self.cancellation = RequestCancellation()

    def identity(self, request: Request, job_id: str):
        self.auth.authenticate(request.headers.get("authorization", ""))
        owner = request.headers.get("x-owner-id", "")
        try:
            if str(UUID(owner)) != owner or not re.fullmatch(r"[a-f0-9]{64}", job_id):
                raise ValueError()
        except ValueError:
            raise IntelligenceError(400, "INVALID_INPUT") from None
        return owner

    async def capabilities(self, request: Request):
        self.auth.authenticate(request.headers.get("authorization", ""))
        return {"available": self.jobs.repository.ready and self.jobs.llm.available, "provider": "openai",
                "models": self.jobs.llm.models.describe(), "defaultModel": self.settings.model,
                "defaultReasoning": None if self.settings.model == "gpt-4.1" else self.settings.reasoning,
                "limits": {"inputBytes": self.settings.max_input_bytes, "outputTokens": self.settings.max_output_tokens, "timeoutSeconds": self.settings.timeout}}

    async def analyze(self, job_id: str, request: Request):
        owner = self.identity(request, job_id)
        model = request.headers.get("x-llm-model", self.settings.model)
        reasoning = request.headers.get("x-llm-reasoning")
        self.jobs.llm.models.validate(model, reasoning)
        if not self.jobs.repository.ready:
            raise IntelligenceError(503, "ANALYSIS_UNAVAILABLE")
        if request.headers.get("content-type", "").split(";", 1)[0] != "application/json":
            raise IntelligenceError(415, "JSON_REQUIRED")
        data = bytearray()
        async for chunk in request.stream():
            if len(data) + len(chunk) > self.settings.max_input_bytes:
                raise IntelligenceError(413, "LLM_BUDGET_LIMIT")
            data.extend(chunk)
        try:
            source = JobSource.model_validate_json(bytes(data))
            if source.jobId != job_id or source.sha256 != request.headers.get("x-source-sha256"):
                raise ValueError()
        except (ValueError, ValidationError):
            raise IntelligenceError(400, "INVALID_INPUT") from None
        return await self.cancellation.run(request, self.jobs.analyze(owner, source, model, reasoning))

    async def start_task(self, job_id: str, request: Request):
        owner = self.identity(request, job_id)
        if request.headers.get('content-type', '').split(';', 1)[0] != 'application/json':
            raise IntelligenceError(415, 'JSON_REQUIRED')
        model = request.headers.get('x-llm-model', self.settings.model)
        reasoning = request.headers.get('x-llm-reasoning')
        self.jobs.llm.models.validate(model, reasoning)
        try:
            key = request.headers.get('x-request-key', '')
            if str(UUID(key)) != key:
                raise ValueError()
            data = bytearray()
            async for chunk in request.stream():
                if len(data) + len(chunk) > self.settings.max_input_bytes:
                    raise IntelligenceError(413, 'LLM_BUDGET_LIMIT')
                data.extend(chunk)
            source = JobSource.model_validate_json(bytes(data))
            if source.jobId != job_id or source.sha256 != request.headers.get('x-source-sha256'):
                raise ValueError()
        except (ValueError, ValidationError):
            raise IntelligenceError(400, 'INVALID_INPUT') from None
        if self.jobs.evidence.source_hash(source) != source.sha256:
            raise IntelligenceError(400, 'INVALID_INPUT')
        task_id = await request.app.state.tasks.start(owner, source, {'model': model, 'reasoning': reasoning}, key)
        return {'taskId': task_id}

    async def tasks(self, request: Request, job_id: str | None = None):
        owner = self.identity(request, job_id if job_id is not None else '0' * 64)
        return await request.app.state.tasks.history(owner, job_id)

    async def cancel_task(self, task_id: str, request: Request):
        owner = self.identity(request, '0' * 64)
        try:
            if str(UUID(task_id)) != task_id:
                raise ValueError()
        except ValueError:
            raise IntelligenceError(400, 'INVALID_INPUT') from None
        await request.app.state.tasks.cancel(owner, task_id)
        return {'status': 'cancelled'}

    async def get(self, job_id: str, request: Request):
        owner = self.identity(request, job_id)
        source_hash = request.headers.get("x-source-sha256", "")
        analysis_id = request.headers.get("x-analysis-id")
        try:
            if not re.fullmatch(r"[a-f0-9]{64}", source_hash) or (analysis_id is not None and str(UUID(analysis_id)) != analysis_id):
                raise ValueError()
        except ValueError:
            raise IntelligenceError(400, "INVALID_INPUT") from None
        record = await self.jobs.repository.get(owner, job_id, source_hash, analysis_id)
        if record is None:
            raise IntelligenceError(404, "JOB_ANALYSIS_NOT_FOUND")
        return record

    async def history(self, job_id: str, request: Request):
        owner = self.identity(request, job_id)
        params = list(request.query_params.multi_items())
        before = request.query_params.get("beforeVersion")
        if params and (len(params) != 1 or params[0][0] != "beforeVersion" or not before
                       or not re.fullmatch(r"[1-9][0-9]{0,9}", before) or int(before) > 2147483647):
            raise IntelligenceError(400, "INVALID_INPUT")
        return await self.jobs.repository.history(owner, job_id, int(before) if before else None)

    async def delete(self, job_id: str, request: Request):
        owner = self.identity(request, job_id)
        await self.jobs.repository.delete(owner, job_id)
        return {"status": "deleted"}
