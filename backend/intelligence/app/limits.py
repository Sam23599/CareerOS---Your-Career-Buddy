MAX_INPUT = 5 * 1024 * 1024
MAX_PAGES = 50
MAX_CHARACTERS = 200_000
MAX_OUTPUT = 2 * 1024 * 1024
WORKER_SECONDS = 10
WORKER_MEMORY = 256 * 1024 * 1024


class ExtractionError(Exception):
    def __init__(self, status: int, code: str):
        self.status = status
        self.code = code
        super().__init__(code)


ERRORS = {
    "UNAUTHENTICATED": "Service authentication is required.",
    "PDF_REQUIRED": "Use application/pdf.",
    "EXTRACTION_LIMIT": "The PDF exceeds an extraction limit.",
    "INVALID_PDF": "This PDF could not be read. Try another version.",
    "PDF_ENCRYPTED": "Password-protected PDFs are not supported yet.",
    "INTELLIGENCE_UNAVAILABLE": "Resume text extraction is temporarily unavailable.",
    "INTELLIGENCE_BUSY": "The extractor is busy. Please try again shortly.",
    "INTELLIGENCE_TIMEOUT": "Extraction took too long. Try a simpler PDF.",
    "PARSER_RESOURCE_LIMIT": "This PDF exceeded the parser's memory limit.",
}
