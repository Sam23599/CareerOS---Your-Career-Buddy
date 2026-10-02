import asyncio
from contextlib import asynccontextmanager
import hmac
import os
import re

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.requests import ClientDisconnect

from .limits import ERRORS, ExtractionError, MAX_INPUT
from .models import Extraction
from .runner import run_worker


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.active = None
    app.state.ready = False
    try:
        app.state.ready = await run_worker(b"", check=True) == {"ready": True}
    except (ExtractionError, OSError):
        pass
    yield
    if app.state.active is not None:
        app.state.active.cancel()
        await asyncio.gather(app.state.active, return_exceptions=True)


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


def authenticate(request: Request):
    token = os.environ.get("INTELLIGENCE_SERVICE_TOKEN", "")
    if not re.fullmatch(r"[a-fA-F0-9]{64,}", token):
        raise ExtractionError(503, "INTELLIGENCE_UNAVAILABLE")
    if not hmac.compare_digest(request.headers.get("authorization", "").encode(), f"Bearer {token}".encode()):
        raise ExtractionError(401, "UNAUTHENTICATED")


@app.exception_handler(ExtractionError)
async def handle_error(request: Request, error: ExtractionError):
    return JSONResponse({"error": {"code": error.code, "message": ERRORS[error.code]}}, status_code=error.status,
                        headers={"Cache-Control": "no-store", **({"Retry-After": "5"} if error.code == "INTELLIGENCE_BUSY" else {})})


@app.get("/internal/v1/health")
async def health():
    return {"status": "ok", "service": "intelligence"}


@app.get("/internal/v1/ready")
async def ready(request: Request):
    authenticate(request)
    if not app.state.ready:
        raise ExtractionError(503, "INTELLIGENCE_UNAVAILABLE")
    return {"status": "ready"}


async def monitor_disconnect(request: Request):
    # The body is fully consumed. Waiting directly avoids polling cancellation scopes
    # swallowing a task cancellation and leaving the parser slot occupied.
    while True:
        if (await request.receive())["type"] == "http.disconnect":
            return


@app.post("/internal/v1/resumes/extract", response_model=Extraction)
async def extract(request: Request):
    authenticate(request)
    if not app.state.ready:
        raise ExtractionError(503, "INTELLIGENCE_UNAVAILABLE")
    if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/pdf":
        raise ExtractionError(415, "PDF_REQUIRED")
    if app.state.active is not None:
        raise ExtractionError(503, "INTELLIGENCE_BUSY")
    task = asyncio.current_task()
    app.state.active = task
    worker = None
    disconnected = None
    try:
        data = bytearray()
        # Also bound a slow/missing request body so it cannot occupy the only slot forever.
        async with asyncio.timeout(10):
            async for chunk in request.stream():
                if len(data) + len(chunk) > MAX_INPUT:
                    raise ExtractionError(413, "EXTRACTION_LIMIT")
                data.extend(chunk)
        worker = asyncio.create_task(run_worker(bytes(data)))
        disconnected = asyncio.create_task(monitor_disconnect(request))
        completed, _ = await asyncio.wait([worker, disconnected], return_when=asyncio.FIRST_COMPLETED)
        if disconnected in completed:
            raise ClientDisconnect()
        return Extraction.model_validate(await worker)
    except TimeoutError:
        raise ExtractionError(504, "INTELLIGENCE_TIMEOUT") from None
    except (OSError, ValidationError):
        # Validation errors can include extracted strings; keep them out of server logs.
        raise ExtractionError(503, "INTELLIGENCE_UNAVAILABLE") from None
    finally:
        pending = [item for item in [worker, disconnected] if item is not None]
        for item in pending:
            if not item.done():
                item.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        if app.state.active is task:
            app.state.active = None
