from datetime import datetime, timezone
import asyncio
import json
import logging
from uuid import uuid4

from app.core.errors import IntelligenceError
from app.core.limits import MAX_OUTPUT
from app.jobs.evidence import JobEvidenceVerifier
from app.jobs.models import JobAnalysisRecord, JobRequirements, JobSource
from app.jobs.prompt import JobAnalysisPrompt
from app.llm.service import LLMService
from app.resumes.models import Usage
from app.storage.jobs_base import JobAnalysisRepository

logger = logging.getLogger(__name__)


class JobAnalysisService:
    def __init__(self, llm: LLMService, repository: JobAnalysisRepository):
        self.llm, self.repository = llm, repository
        self.evidence = JobEvidenceVerifier()

    async def generate(self, source: JobSource, model: str, reasoning: str | None):
        text = json.dumps({"sections": [item.model_dump() for item in source.sections]}, ensure_ascii=False)
        instructions = JobAnalysisPrompt.instructions
        input_tokens = output_tokens = 0
        try:
            async with asyncio.timeout(self.llm.settings.timeout):
                for attempt in range(2):
                    try:
                        result = await self.llm.generate(model, reasoning, instructions, text, JobRequirements)
                        input_tokens += result.input_tokens
                        output_tokens += result.output_tokens
                        analysis = self.evidence.verify(result.value, source)
                        return analysis, Usage(inputTokens=input_tokens, outputTokens=output_tokens)
                    except IntelligenceError as error:
                        if error.code != "LLM_RESPONSE_INVALID" or attempt == 1:
                            raise
                        field = getattr(error, "field", None) or "output"
                        reason = getattr(error, "reason", "invalid_response")
                        logger.warning("job_analysis_retry model=%s attempt=2 field=%s reason=%s", model, field, reason)
                        instructions += JobAnalysisPrompt.retry(field, reason)
        except TimeoutError:
            raise IntelligenceError(504, "LLM_TIMEOUT") from None

    async def analyze(self, owner: str, source: JobSource, model: str, reasoning: str | None):
        self.llm.models.validate(model, reasoning)
        if self.evidence.source_hash(source) != source.sha256:
            raise IntelligenceError(400, "INVALID_INPUT")
        if not source.sections[-1].text.strip():
            raise IntelligenceError(422, "JOB_TEXT_EMPTY")
        async with self.llm.gate.claim():
            analysis, usage = await self.generate(source, model, reasoning)
            record = JobAnalysisRecord(schemaVersion=1, id=str(uuid4()), version=1, source=source,
                                       analyzerVersion="job-analysis-v1", provider="openai", model=model, reasoning=reasoning,
                                       usage=usage,
                                       createdAt=datetime.now(timezone.utc).isoformat(), analysis=analysis)
            if len(record.model_dump_json().encode()) > MAX_OUTPUT:
                raise IntelligenceError(413, "LLM_BUDGET_LIMIT")
            return await self.repository.save(owner, record)
