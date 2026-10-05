import hashlib
import json
import re

from pydantic import ValidationError

from app.jobs.models import JobAnalysis, JobSource, JobRequirements
from app.llm.validation import ResponseValidationError

REQUIREMENT_FIELDS = {"skills", "technologies", "experience", "education", "certifications", "languages",
                      "eligibility", "applicationRequirements", "additionalRequirements"}
WARNING_MESSAGES = {
    "AMBIGUOUS_REQUIREMENT": "This requirement is ambiguous. Review the quoted listing text.",
    "POSSIBLE_CONTRADICTION": "These statements may conflict. Confirm the requirement on the original listing.",
}


class RequirementPriority:
    required = re.compile(r"\b(required|mandatory|must|essential|minimum)\b", re.I)
    preferred = re.compile(r"\b(preferred|desirable|optional|nice[ -]to[ -]have|bonus)\b", re.I)
    negated = re.compile(r"\b(?:not|no|never)\s+(?:strictly\s+)?(?:required|mandatory)\b", re.I)
    headings = {"required skills": "required", "required qualifications": "required", "minimum qualifications": "required",
                "essential requirements": "required", "mandatory requirements": "required", "must have": "required",
                "preferred skills": "preferred", "preferred qualifications": "preferred", "nice to have": "preferred",
                "desirable skills": "preferred", "optional skills": "preferred"}

    @classmethod
    def resolve(cls, sections, evidence):
        if evidence["section"] != "description":
            return "unspecified", []
        text = sections["description"]
        start = text.rfind("\n", 0, evidence["start"]) + 1
        end = text.find("\n", evidence["end"])
        end = len(text) if end < 0 else end
        line = text[start:end]
        required, preferred = bool(cls.required.search(line)), bool(cls.preferred.search(line))
        if cls.negated.search(line) or (required and preferred) or len(line) > 6000:
            return "unspecified", []
        if required or preferred:
            return "required" if required else "preferred", [{"section": "description", "quote": line, "start": start, "end": end}]
        heading = None
        offset = 0
        for previous in text[:start].splitlines(keepends=True):
            cleaned = previous.strip().strip("#*:- ").lower()
            if cleaned in cls.headings:
                quote = previous.rstrip("\n")
                heading = (cls.headings[cleaned], [{"section": "description", "quote": quote, "start": offset, "end": offset + len(quote)}])
            elif (previous.strip().endswith(":" ) and len(previous) < 120) or cleaned in {"responsibilities", "benefits", "about us", "about the role", "qualifications", "requirements"}:
                heading = None
            offset += len(previous)
        return heading or ("unspecified", [])


class JobEvidenceVerifier:
    @staticmethod
    def source_hash(source: JobSource):
        payload = {"normalizerVersion": source.normalizerVersion, "sections": [item.model_dump() for item in source.sections]}
        return hashlib.sha256(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()

    @staticmethod
    def quote(text, item, field):
        quote = item["quote"]
        if not quote.strip():
            raise ResponseValidationError("evidence", "empty_quote", field)
        start = text.find(quote)
        if start >= 0:
            return {**item, "start": start, "end": start + len(quote)}
        # Match whitespace differences only. Escaping every source word keeps
        # punctuation, spelling and word order strict; offsets use the original text.
        pattern = r"\s+".join(re.escape(part) for part in re.split(r"\s+", quote.strip()))
        matches = re.finditer(pattern, text)
        match = next(matches, None)
        if match is None:
            raise ResponseValidationError("evidence", "quote_not_in_source", field)
        if next(matches, None) is not None:
            raise ResponseValidationError("evidence", "ambiguous_quote", field)
        original = match.group()
        if len(original) > 6000:
            raise ResponseValidationError("evidence", "quote_limit", field)
        return {**item, "quote": original, "start": match.start(), "end": match.end()}

    def verify(self, generated: JobRequirements, source: JobSource):
        sections = {item.id: item.text for item in source.sections}

        def evidence(items, field):
            return [self.quote(sections[item["section"]], item, f"{field}.evidence.{index}")
                    for index, item in enumerate(items)]

        def fact(item, field):
            quotes = evidence(item["evidence"], field)
            value = item["value"]
            normalize = lambda text: re.sub(r"\s+", " ", text).strip()
            if value is None:
                if quotes:
                    raise ResponseValidationError("evidence", "null_with_evidence", field)
            elif not normalize(value) or not any(re.search(r"(?<!\w)" + re.escape(normalize(value)) + r"(?!\w)", normalize(quote["quote"]), re.I) for quote in quotes):
                raise ResponseValidationError("evidence", "value_not_in_quote", field)
            return {"value": value, "evidence": quotes}

        result = {}
        for key, items in generated.model_dump().items():
            if key == "warnings":
                result[key] = [{**item, "message": WARNING_MESSAGES[item["code"]], "evidence": evidence(item["evidence"], f"{key}.{index}")}
                               for index, item in enumerate(items)]
            elif isinstance(items, list):
                result[key] = []
                for index, item in enumerate(items):
                    field = f"{key}.{index}"
                    checked = fact(item, field)
                    if checked["value"] is None:
                        raise ResponseValidationError("evidence", "null_list_item", field)
                    if key in REQUIREMENT_FIELDS:
                        decisions = [RequirementPriority.resolve(sections, quote) if sections[quote["section"]].count(quote["quote"]) == 1
                                     else ("unspecified", []) for quote in checked["evidence"]]
                        explicit = [item for item in decisions if item[0] != "unspecified"]
                        priority, proof = explicit[0] if explicit and len({item[0] for item in explicit}) == 1 else ("unspecified", [])
                        checked.update(priority=priority, priorityEvidence=proof)
                    result[key].append(checked)
            else:
                result[key] = fact(items, key)
        try:
            return JobAnalysis.model_validate(result)
        except ValidationError as error:
            raise ResponseValidationError.from_schema(error, JobAnalysis) from None
