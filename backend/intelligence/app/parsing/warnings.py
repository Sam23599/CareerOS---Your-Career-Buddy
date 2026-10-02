import logging

from app.core.errors import IntelligenceError as ExtractionError


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
