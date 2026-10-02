import io
import logging
from abc import ABC, abstractmethod

from app.core.errors import IntelligenceError as ExtractionError
from app.core.limits import MAX_CHARACTERS, MAX_INPUT, MAX_PAGES
from app.parsing.warnings import ParserWarnings


class DocumentParser(ABC):
    @abstractmethod
    def extract(self, data: bytes) -> dict: ...


class PdfTextExtractor(DocumentParser):
    def _parse(self, data: bytes):
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


    def extract(self, data: bytes):
        from pypdf.errors import LimitReachedError
        warnings = ParserWarnings()
        logger = logging.getLogger("pypdf")
        level, propagate = logger.level, logger.propagate
        logger.setLevel(logging.WARNING)
        logger.addHandler(warnings)
        logger.propagate = False
        try:
            result = self._parse(data)
            warnings.apply(result)
            return result
        except LimitReachedError:
            raise ExtractionError(413, "EXTRACTION_LIMIT") from None
        finally:
            logger.removeHandler(warnings)
            logger.setLevel(level)
            logger.propagate = propagate
