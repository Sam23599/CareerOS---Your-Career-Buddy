"""Disposable parser entry point. No network, files, database or LLM client."""
import json
import logging
import sys

from app.core.errors import IntelligenceError as ExtractionError
from app.core.limits import MAX_INPUT, MAX_OUTPUT
from app.core.resources import WorkerMemoryBudget
from app.parsing.pdf import PdfTextExtractor


class PdfWorker:
    def run(self):
        logging.disable(logging.NOTSET)
        try:
            WorkerMemoryBudget().enforce()
            if sys.argv[1:] == ["--check"]:
                from pypdf import PdfReader  # noqa: F401 — verify import under the worker cap
                from fontTools.cffLib import CFFFontSet  # noqa: F401 — verify embedded-font support
                result = {"ready": True}
            else:
                result = PdfTextExtractor().extract(sys.stdin.buffer.read(MAX_INPUT + 1))
            output = json.dumps(result, ensure_ascii=True, separators=(",", ":")).encode()
            if len(output) > MAX_OUTPUT:
                raise ExtractionError(413, "EXTRACTION_LIMIT")
        except ExtractionError as error:
            output = json.dumps({"error": {"status": error.status, "code": error.code}}).encode()
        except MemoryError:
            output = b'{"error":{"status":503,"code":"PARSER_RESOURCE_LIMIT"}}'
        except Exception:
            output = b'{"error":{"status":422,"code":"INVALID_PDF"}}'
        sys.stdout.buffer.write(output)


if __name__ == "__main__":
    PdfWorker().run()
