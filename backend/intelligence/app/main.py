from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api.controller import IntelligenceController
from app.api.jobs import JobAnalysisController
from app.core.errors import ERRORS, IntelligenceError
from app.core.settings import Settings
from app.llm.models import ModelRegistry
from app.llm.providers.base import ProviderRegistry
from app.llm.providers.openai import OpenAIProvider
from app.llm.service import LLMService
from app.parsing.runner import PdfWorkerRunner
from app.parsing.service import ExtractionService
from app.resumes.service import ResumeDraftService
from app.storage.postgres import PostgresDraftRepository
from app.storage.jobs_postgres import PostgresJobAnalysisRepository
from app.jobs.service import JobAnalysisService
from app.api.matching import MatchingController
from app.matching.service import MatchingService


class IntelligenceApplication:
    def __init__(self):
        self.extraction = ExtractionService(PdfWorkerRunner())
        self.providers = ProviderRegistry()

    @asynccontextmanager
    async def lifespan(self, app: FastAPI):
        settings = Settings.from_environment()
        if settings.openai_key:
            self.providers.register("openai", OpenAIProvider(settings.openai_key, settings.timeout))
        self.repository = PostgresDraftRepository(settings.database_url)
        self.llm = LLMService(settings, self.providers, ModelRegistry())
        self.drafts = ResumeDraftService(self.llm, self.repository)
        self.jobs = JobAnalysisService(self.llm, PostgresJobAnalysisRepository(self.repository))
        app.state.controller = IntelligenceController(settings, self.extraction, self.drafts)
        app.state.jobs = JobAnalysisController(settings, self.jobs)
        app.state.matching = MatchingController(settings.service_token, MatchingService(self.repository, self.jobs.repository))
        app.state.extraction = self.extraction
        await self.extraction.start()
        await self.repository.start()
        try:
            yield
        finally:
            await self.llm.gate.close()
            await self.extraction.close()
            await self.repository.close()
            await self.providers.close()

    def build(self):
        app = FastAPI(lifespan=self.lifespan, docs_url=None, redoc_url=None, openapi_url=None)

        @app.exception_handler(IntelligenceError)
        async def handle_error(request: Request, error: IntelligenceError):
            return JSONResponse({"error": {"code": error.code, "message": ERRORS[error.code]}}, status_code=error.status,
                                headers={"Cache-Control": "no-store", **({"Retry-After": "5"} if error.code == "INTELLIGENCE_BUSY" else {})})

        async def health(): return {"status": "ok", "service": "intelligence"}
        async def ready(request: Request): return await request.app.state.controller.ready(request)
        async def capabilities(request: Request): return await request.app.state.controller.capabilities(request)
        async def extract(request: Request): return await request.app.state.controller.extract(request)
        async def analyze(request: Request): return await request.app.state.controller.analyze(request)
        async def get_draft(resume_id: str, request: Request): return await request.app.state.controller.get_draft(resume_id, request)
        async def draft_history(resume_id: str, request: Request): return await request.app.state.controller.draft_history(resume_id, request)
        async def delete_drafts(resume_id: str, request: Request): return await request.app.state.controller.delete_drafts(resume_id, request)
        async def job_capabilities(request: Request): return await request.app.state.jobs.capabilities(request)
        async def analyze_job(job_id: str, request: Request): return await request.app.state.jobs.analyze(job_id, request)
        async def get_job(job_id: str, request: Request): return await request.app.state.jobs.get(job_id, request)
        async def job_history(job_id: str, request: Request): return await request.app.state.jobs.history(job_id, request)
        async def delete_job(job_id: str, request: Request): return await request.app.state.jobs.delete(job_id, request)
        async def match(request: Request): return await request.app.state.matching.compare(request)
        for path, method, handler in (
            ("health", "GET", health), ("ready", "GET", ready), ("capabilities", "GET", capabilities),
            ("resumes/extract", "POST", extract), ("resumes/analyze", "POST", analyze),
            ("resumes/{resume_id}/draft", "GET", get_draft), ("resumes/{resume_id}/draft", "DELETE", delete_drafts),
            ("resumes/{resume_id}/drafts", "GET", draft_history),
            ("jobs/capabilities", "GET", job_capabilities), ("jobs/{job_id}/analyze", "POST", analyze_job),
            ("jobs/{job_id}/analysis", "GET", get_job), ("jobs/{job_id}/analyses", "GET", job_history),
            ("jobs/{job_id}/analysis", "DELETE", delete_job),
            ("matching/compare", "POST", match),
        ):
            app.add_api_route("/internal/v1/" + path, handler, methods=[method])
        return app


application = IntelligenceApplication()
app = application.build()
