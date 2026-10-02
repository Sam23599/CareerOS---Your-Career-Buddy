import asyncio
import hashlib

from pydantic import ValidationError
from starlette.requests import Request

from app.core.errors import IntelligenceError
from app.core.limits import MAX_INPUT, WORKER_SECONDS
from app.core.requests import RequestCancellation
from app.parsing.models import Extraction
from app.parsing.runner import PdfWorkerRunner


class ExtractionService:
    def __init__(self, runner: PdfWorkerRunner):
        self.runner = runner
        self.active = None
        self.ready = False
        self._cancellation = RequestCancellation()

    async def start(self):
        try:
            self.ready = await self.runner.run(b"", check=True) == {"ready": True}
        except (IntelligenceError, OSError):
            self.ready = False

    async def close(self):
        if self.active is not None:
            self.active.cancel()
            await asyncio.gather(self.active, return_exceptions=True)

    async def extract(self, request: Request, expected_sha256: str | None = None) -> Extraction:
        if not self.ready:
            raise IntelligenceError(503, "INTELLIGENCE_UNAVAILABLE")
        if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/pdf":
            raise IntelligenceError(415, "PDF_REQUIRED")
        if self.active is not None:
            raise IntelligenceError(503, "INTELLIGENCE_BUSY")
        task = asyncio.current_task()
        self.active = task
        try:
            data = bytearray()
            async with asyncio.timeout(WORKER_SECONDS):
                async for chunk in request.stream():
                    if len(data) + len(chunk) > MAX_INPUT:
                        raise IntelligenceError(413, "EXTRACTION_LIMIT")
                    data.extend(chunk)
            if expected_sha256 is not None and hashlib.sha256(data).hexdigest() != expected_sha256:
                raise IntelligenceError(400, "INVALID_INPUT")
            result = await self._cancellation.run(request, self.runner.run(bytes(data)))
            return Extraction.model_validate(result)
        except TimeoutError:
            raise IntelligenceError(504, "INTELLIGENCE_TIMEOUT") from None
        except (OSError, ValidationError):
            raise IntelligenceError(503, "INTELLIGENCE_UNAVAILABLE") from None
        finally:
            if self.active is task:
                self.active = None
