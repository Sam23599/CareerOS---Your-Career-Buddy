from uuid import UUID

from fastapi import Request
from pydantic import ValidationError

from app.core.errors import IntelligenceError
from app.core.requests import RequestCancellation
from app.core.security import ServiceAuthenticator
from app.core.settings import Settings
from app.parsing.service import ExtractionService
from app.resumes.models import Source
from app.resumes.service import ResumeDraftService


class IntelligenceController:
    def __init__(self, settings: Settings, extraction: ExtractionService, drafts: ResumeDraftService):
        self.settings, self.extraction, self.drafts = settings, extraction, drafts
        self.auth = ServiceAuthenticator(settings.service_token)
        self.cancellation = RequestCancellation()

    def authenticate(self, request: Request):
        self.auth.authenticate(request.headers.get("authorization", ""))

    def identity(self, request: Request, resume_id: str):
        self.authenticate(request)
        owner = request.headers.get("x-owner-id", "")
        try:
            if str(UUID(owner)) != owner or str(UUID(resume_id)) != resume_id:
                raise ValueError()
            return owner
        except ValueError:
            raise IntelligenceError(400, "INVALID_INPUT") from None

    def context(self, request: Request, resume_id: str | None = None):
        resume_id = resume_id or request.headers.get("x-resume-id", "")
        owner = self.identity(request, resume_id)
        try:
            source = Source(resumeId=resume_id, resumeVersion=int(request.headers.get("x-resume-version", "")),
                            sha256=request.headers.get("x-source-sha256", ""))
            return owner, source
        except (ValueError, ValidationError):
            raise IntelligenceError(400, "INVALID_INPUT") from None

    async def ready(self, request: Request):
        self.authenticate(request)
        if not self.extraction.ready:
            raise IntelligenceError(503, "INTELLIGENCE_UNAVAILABLE")
        return {"status": "ready"}

    async def capabilities(self, request: Request):
        self.authenticate(request)
        return {"available": self.extraction.ready and self.drafts.repository.ready and self.drafts.llm.available,
                "provider": "openai", "models": self.drafts.llm.models.describe(),
                "defaultModel": self.settings.model,
                "defaultReasoning": None if self.settings.model == "gpt-4.1" else self.settings.reasoning,
                "limits": {"inputBytes": self.settings.max_input_bytes, "outputTokens": self.settings.max_output_tokens,
                           "timeoutSeconds": self.settings.timeout}}

    async def extract(self, request: Request):
        self.authenticate(request)
        return await self.extraction.extract(request)

    async def analyze(self, request: Request):
        owner, source = self.context(request)
        model = request.headers.get("x-llm-model", self.settings.model)
        reasoning = request.headers.get("x-llm-reasoning")
        self.drafts.llm.models.validate(model, reasoning)
        if not self.drafts.repository.ready:
            raise IntelligenceError(503, "ANALYSIS_UNAVAILABLE")
        extraction = await self.extraction.extract(request, source.sha256)
        return await self.cancellation.run(request, self.drafts.analyze(owner, source, extraction, model, reasoning))

    async def get_draft(self, resume_id: str, request: Request):
        owner, source = self.context(request, resume_id)
        analysis_id = request.headers.get("x-analysis-id")
        if analysis_id is not None:
            try:
                if str(UUID(analysis_id)) != analysis_id:
                    raise ValueError()
            except ValueError:
                raise IntelligenceError(400, "INVALID_INPUT") from None
        record = await self.drafts.repository.get(owner, source, analysis_id=analysis_id)
        if record is None:
            raise IntelligenceError(404, "ANALYSIS_NOT_FOUND")
        return record

    async def delete_drafts(self, resume_id: str, request: Request):
        owner = self.identity(request, resume_id)
        await self.drafts.repository.delete(owner, resume_id)
        return {"status": "deleted"}

    async def draft_history(self, resume_id: str, request: Request):
        owner, source = self.context(request, resume_id)
        params = list(request.query_params.multi_items())
        before = request.query_params.get("beforeVersion")
        if params and (len(params) != 1 or params[0][0] != "beforeVersion" or not before
                       or len(before) > 10 or not before.isascii() or not before.isdecimal() or not 1 <= int(before) <= 2147483647):
            raise IntelligenceError(400, "INVALID_INPUT")
        return await self.drafts.repository.history(owner, source, int(before) if before else None)
