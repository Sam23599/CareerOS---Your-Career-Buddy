import re

from app.core.errors import IntelligenceError
from app.parsing.models import Extraction
from app.resumes.models import ResumeDraft


class EvidenceVerifier:
    @staticmethod
    def normalize(text):
        return re.sub(r"\s+", " ", text).strip()

    def verify(self, draft: ResumeDraft, extraction: Extraction):
        pages = {page.number: self.normalize(page.text) for page in extraction.pages}

        def visit(value):
            if isinstance(value, list):
                for item in value:
                    visit(item)
            elif isinstance(value, dict):
                if set(value) == {"value", "evidence"}:
                    facts = value["evidence"]
                    if value["value"] is None:
                        if facts:
                            raise IntelligenceError(502, "LLM_RESPONSE_INVALID")
                        return
                    text = self.normalize(value["value"])
                    quotes = [self.normalize(item["quote"]) for item in facts]
                    if not text or not quotes or any(quote not in pages.get(item["page"], "")
                                                    for quote, item in zip(quotes, facts)):
                        raise IntelligenceError(502, "LLM_RESPONSE_INVALID")
                    # Values are copied, not invented or paraphrased. Word boundaries avoid
                    # validating short skills such as "Go" merely because "Google" appears.
                    if not any(re.search(r"(?<!\w)" + re.escape(text) + r"(?!\w)", quote, re.IGNORECASE)
                               for quote in quotes):
                        raise IntelligenceError(502, "LLM_RESPONSE_INVALID")
                else:
                    for item in value.values():
                        visit(item)

        visit(draft.model_dump())
