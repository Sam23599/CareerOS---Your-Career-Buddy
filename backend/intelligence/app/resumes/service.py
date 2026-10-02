import asyncio
from datetime import datetime, timezone
import json
from uuid import uuid4

from app.core.errors import IntelligenceError
from app.core.limits import MAX_OUTPUT
from app.llm.service import LLMService
from app.parsing.models import Extraction
from app.resumes.evidence import EvidenceVerifier
from app.resumes.models import DraftRecord, ResumeDraft, Source, Usage
from app.resumes.prompt import ResumeDraftPrompt
from app.storage.base import DraftRepository


class ResumeDraftService:
    def __init__(self, llm: LLMService, repository: DraftRepository):
        self.llm, self.repository = llm, repository
        self.active = None
        self.evidence = EvidenceVerifier()

    async def close(self):
        if self.active is not None:
            self.active.cancel()
            await asyncio.gather(self.active, return_exceptions=True)

    async def analyze(self, owner: str, source: Source, extraction: Extraction, model: str, reasoning: str | None):
        self.llm.models.validate(model, reasoning)
        if self.active is not None:
            raise IntelligenceError(503, "INTELLIGENCE_BUSY")
        if extraction.status == "no_text":
            raise IntelligenceError(422, "NO_EXTRACTABLE_TEXT")
        task = asyncio.current_task()
        self.active = task
        try:
            text = json.dumps({"pages": [page.model_dump() for page in extraction.pages]}, ensure_ascii=False)
            result = await self.llm.generate(model, reasoning, ResumeDraftPrompt.instructions, text, ResumeDraft)
            self.evidence.verify(result.value, extraction)
            record = DraftRecord(id=str(uuid4()), version=1, source=source, model=model, reasoning=reasoning,
                                 createdAt=datetime.now(timezone.utc).isoformat(), extraction=extraction,
                                 usage=Usage(inputTokens=result.input_tokens, outputTokens=result.output_tokens),
                                 draft=result.value)
            if len(record.model_dump_json().encode()) > MAX_OUTPUT:
                raise IntelligenceError(413, "LLM_BUDGET_LIMIT")
            return await self.repository.save(owner, record)
        finally:
            if self.active is task:
                self.active = None
