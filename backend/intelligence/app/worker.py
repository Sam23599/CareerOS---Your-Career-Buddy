"""Disposable, memory-limited parser. Never writes files or logs PDF content."""
import io
import json
import logging
import sys

from .limits import ExtractionError, MAX_CHARACTERS, MAX_INPUT, MAX_OUTPUT, MAX_PAGES, WORKER_MEMORY


def enforce_memory_limit():
    if sys.platform != "linux":
        raise ExtractionError(503, "INTELLIGENCE_UNAVAILABLE")
    import resource
    resource.setrlimit(resource.RLIMIT_AS, (WORKER_MEMORY, WORKER_MEMORY))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    if resource.getrlimit(resource.RLIMIT_AS) != (WORKER_MEMORY, WORKER_MEMORY):
        raise ExtractionError(503, "INTELLIGENCE_UNAVAILABLE")


def _extract_pdf(data: bytes):
    from pypdf import PdfReader, __version__
    if not data or len(data) > MAX_INPUT:
        raise ExtractionError(413, "EXTRACTION_LIMIT")
    if not data.startswith(b"%PDF-"):
        raise ExtractionError(422, "INVALID_PDF")
    reader = PdfReader(io.BytesIO(data), strict=True)
    if reader.is_encrypted:
        raise ExtractionError(422, "PDF_ENCRYPTED")
    count = len(reader.pages)
    if count > MAX_PAGES:
        raise ExtractionError(413, "EXTRACTION_LIMIT")
    if count == 0:
        raise ExtractionError(422, "INVALID_PDF")
    pages = []
    characters = 2 * (count - 1)
    for number, page in enumerate(reader.pages, 1):
        text = (page.extract_text() or "").replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
        characters += len(text)
        if characters > MAX_CHARACTERS:
            raise ExtractionError(413, "EXTRACTION_LIMIT")
        pages.append({"number": number, "text": text})
    readable = any(page["text"].strip() for page in pages)
    warnings = []
    if not readable:
        warnings.append({"code": "NO_EXTRACTABLE_TEXT", "message": "No readable text was found. This PDF may be scanned or blank; scanned pages may need OCR."})
    elif any(not page["text"].strip() for page in pages):
        warnings.append({"code": "PAGES_WITHOUT_TEXT", "message": "Some pages contain no readable text. Review the original PDF for missing content."})
    return {"schemaVersion": 1, "parser": {"name": "pypdf", "version": __version__},
            "status": "extracted" if readable else "no_text", "pageCount": count,
            "pages": pages, "text": "\n\n".join(page["text"] for page in pages), "warnings": warnings}


class ParserWarnings(logging.Handler):
    # Match pinned pypdf templates, never formatted document values. These affect
    # object-table indexing/whitespace only; unknown or skipped-content warnings fail.
    RECOVERABLE = frozenset({
        ("pypdf._reader", "Xref table not zero-indexed. ID numbers for objects will be corrected."),
        ("pypdf._reader", "Superfluous whitespace found in object header %(idnum)r %(generation)r"),
    })

    def __init__(self):
        super().__init__(logging.WARNING)
        self.repaired = False
        self.failed = False

    def emit(self, record):
        # Keep only flags; never format, retain or print arguments/exception details.
        if record.levelno == logging.WARNING and isinstance(record.msg, str) and (record.name, record.msg) in self.RECOVERABLE:
            self.repaired = True
        else:
            self.failed = True

    def apply(self, result):
        if self.failed:
            raise ExtractionError(422, "INVALID_PDF")
        if self.repaired:
            result["warnings"].append({
                "code": "PDF_STRUCTURE_REPAIRED",
                "message": "Minor PDF structure issues were corrected during extraction. Review the text against your original PDF.",
            })


def extract_pdf(data: bytes):
    from pypdf.errors import LimitReachedError
    warnings = ParserWarnings()
    logger = logging.getLogger("pypdf")
    level, propagate = logger.level, logger.propagate
    logger.setLevel(logging.WARNING)
    logger.addHandler(warnings)
    logger.propagate = False
    try:
        result = _extract_pdf(data)
        warnings.apply(result)
        return result
    except LimitReachedError:
        raise ExtractionError(413, "EXTRACTION_LIMIT") from None
    finally:
        logger.removeHandler(warnings)
        logger.setLevel(level)
        logger.propagate = propagate


def main():
    logging.disable(logging.NOTSET)
    try:
        enforce_memory_limit()
        if sys.argv[1:] == ["--check"]:
            from pypdf import PdfReader  # noqa: F401 — verify import under the worker cap
            from fontTools.cffLib import CFFFontSet  # noqa: F401 — verify embedded-font support
            result = {"ready": True}
        else:
            result = extract_pdf(sys.stdin.buffer.read(MAX_INPUT + 1))
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
    main()
