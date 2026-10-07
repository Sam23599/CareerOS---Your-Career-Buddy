class IntelligenceError(Exception):
    def __init__(self, status: int, code: str):
        self.status = status
        self.code = code
        super().__init__(code)


ERRORS = {
    "UNAUTHENTICATED": "Service authentication is required.",
    "INVALID_INPUT": "The intelligence request is invalid.",
    "PDF_REQUIRED": "Use application/pdf.",
    "EXTRACTION_LIMIT": "The PDF exceeds an extraction limit.",
    "INVALID_PDF": "This PDF could not be read. Try another version.",
    "PDF_ENCRYPTED": "Password-protected PDFs are not supported yet.",
    "INTELLIGENCE_UNAVAILABLE": "Resume text extraction is temporarily unavailable.",
    "INTELLIGENCE_BUSY": "The intelligence service is busy. Please try again shortly.",
    "INTELLIGENCE_TIMEOUT": "Extraction took too long. Try a simpler PDF.",
    "PARSER_RESOURCE_LIMIT": "This PDF exceeded the parser's memory limit.",
    "ANALYSIS_UNAVAILABLE": "Analysis is temporarily unavailable.",
    "ANALYSIS_NOT_FOUND": "No saved draft is available for this resume.",
    "RESUME_NOT_FOUND": "Resume not found.",
    "NO_EXTRACTABLE_TEXT": "No readable text was found. Review the PDF or upload a text-based version.",
    "LLM_TIMEOUT": "Analysis took too long. Please retry.",
    "LLM_RATE_LIMITED": "The AI provider is busy. Please try again later.",
    "LLM_BUDGET_LIMIT": "This analysis exceeds the configured AI request budget.",
    "LLM_RESPONSE_INVALID": "The AI result could not be validated. Please retry.",
    "LLM_REFUSED": "The AI provider could not analyze this source.",
    "JSON_REQUIRED": "Use application/json.",
    "JOB_TEXT_EMPTY": "This listing has no description to analyze.",
    "JOB_NOT_FOUND": "Job not found.",
    "JOB_ANALYSIS_NOT_FOUND": "No saved job analysis is available.",
    "JOB_ANALYSIS_STALE": "This listing changed. Analyze its current description before matching.",
    "MATCH_SOURCE_CHANGED": "A comparison input changed. Reload the inputs and compare again.",
    "MATCHING_LIMIT": "This comparison exceeds the supported size limit.",
    "REVIEW_LIMIT": "This review exceeds the supported size limit.",
    "CADY_CONVERSATION_CHANGED": "Conversation changed in another tab. Reload it before continuing.",
    "CADY_CONTEXT_CHANGED": "Start a new conversation to use different context.",
    "PREPARATION_NOT_FOUND": "No saved preparation plan is available.",
    "PREPARATION_CHANGED": "This plan was edited elsewhere. Reload it before saving.",
}
