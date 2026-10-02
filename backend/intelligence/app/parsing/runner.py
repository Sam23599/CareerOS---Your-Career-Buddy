import asyncio
import json
import sys

from app.core.errors import ERRORS, IntelligenceError as ExtractionError
from app.core.limits import MAX_OUTPUT, WORKER_SECONDS


class PdfWorkerRunner:
    """Owns subprocess I/O, deadlines and unconditional kill/reap cleanup."""

    async def run(self, data: bytes, *, check: bool = False, command: list[str] | None = None, timeout: float = WORKER_SECONDS):
        args = command or [sys.executable, "-m", "app.parsing.worker"]
        process = await asyncio.create_subprocess_exec(
            *args, *(["--check"] if check else []), stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )

        async def feed():
            try:
                process.stdin.write(data)
                await process.stdin.drain()
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                process.stdin.close()

        async def read():
            output = bytearray()
            while chunk := await process.stdout.read(65536):
                output.extend(chunk)
                if len(output) > MAX_OUTPUT:
                    raise ExtractionError(413, "EXTRACTION_LIMIT")
            return bytes(output)

        tasks = [asyncio.create_task(feed()), asyncio.create_task(read()), asyncio.create_task(process.wait())]
        try:
            try:
                _, output, returncode = await asyncio.wait_for(asyncio.gather(*tasks), timeout)
            except TimeoutError:
                raise ExtractionError(504, "INTELLIGENCE_TIMEOUT") from None
            if returncode != 0:
                raise ExtractionError(503, "PARSER_RESOURCE_LIMIT")
            result = json.loads(output)
            if isinstance(result, dict) and "error" in result:
                error = result["error"]
                if error.get("code") not in ERRORS:
                    raise ExtractionError(503, "INTELLIGENCE_UNAVAILABLE")
                raise ExtractionError(error["status"], error["code"])
            return result
        except (ValueError, KeyError, TypeError):
            raise ExtractionError(503, "INTELLIGENCE_UNAVAILABLE") from None
        finally:
            if process.returncode is None:
                process.kill()
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await process.wait()
