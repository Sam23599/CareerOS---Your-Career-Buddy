import asyncio
import re

from app.core.errors import IntelligenceError
from app.matching.baseline import SkillCoverageMatcher


class CareerContext:
    """Resolve owned intelligence records; project facts without contact fields or PDFs."""

    def __init__(self, drafts, jobs):
        self.drafts, self.jobs = drafts, jobs
        self.matcher = SkillCoverageMatcher()

    @staticmethod
    def clean(value):
        value = re.sub(r"\b[^\s@]+@[^\s@]+\.[^\s@]+\b|https?://\S+|www\.\S+", "[contact removed]", value)
        return re.sub(r"(?<!\w)\+?\d[\d ().-]{7,}\d(?!\w)", "[contact removed]", value)

    async def load(self, owner, context):
        cv, jd = await asyncio.gather(
            self.drafts.get(owner, context.resume, analysis_id=context.draftId),
            self.jobs.get(owner, context.jobId, context.jobHash, context.jobAnalysisId))
        if cv is None:
            raise IntelligenceError(404, "ANALYSIS_NOT_FOUND")
        if jd is None:
            raise IntelligenceError(404, "JOB_ANALYSIS_NOT_FOUND")
        if cv.source != context.resume or cv.id != context.draftId:
            raise IntelligenceError(409, "MATCH_SOURCE_CHANGED")
        if jd.source.sha256 != context.jobHash or jd.id != context.jobAnalysisId:
            raise IntelligenceError(409, "JOB_ANALYSIS_STALE")
        return cv, jd, self.matcher.compare(cv, jd, context.profile)

    def project(self, match, indexes):
        result = []
        for index in indexes:
            item = match.items[index]
            result.append({"matchIndex": index, "category": item.category,
                           "requirement": self.clean(item.requirement.value or "Not stated"),
                           "priority": item.requirement.priority, "observedStatus": item.status,
                           "jobEvidence": [self.clean(e.quote) for e in item.requirement.evidence],
                           "cvEvidence": [self.clean(e.quote) for e in item.candidate.evidence] if item.candidate else [],
                           "candidateSkill": self.clean(item.candidate.value) if item.candidate else None,
                           "candidateSource": item.candidate.source if item.candidate else None})
        return result

    def relevant_work(self, cv, terms):
        """Only work/project facts mentioning selected requirements; no contact/date fields."""
        terms = {term.casefold() for term in terms if term and len(term) >= 2}
        facts = []
        for category in ('experience', 'projects'):
            for entry in getattr(cv.draft, category):
                for fact in [entry.description, *entry.achievements]:
                    if fact.value and any(term in fact.value.casefold() for term in terms):
                        facts.append({'source': category, 'fact': self.clean(fact.value),
                                      'evidence': [self.clean(quote.quote) for quote in fact.evidence]})
                        if len(facts) >= 6:
                            return facts
        return facts
