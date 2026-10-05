import re
import unicodedata

from app.jobs.models import JobAnalysisRecord, Requirement
from app.matching.models import CandidateEvidence, MatchItem, MatchResult, MatchSource, ProfileSkills
from app.resumes.models import DraftRecord


class SkillNormalizer:
    """Exact labels and a small explicit alias table, never fuzzy semantic similarity."""
    aliases = {
        "js": "javascript", "ts": "typescript", "react.js": "react", "reactjs": "react",
        "node.js": "nodejs", "node js": "nodejs", "postgres": "postgresql",
        "amazon web services": "aws", "google cloud platform": "gcp",
        "continuous integration/continuous delivery": "ci/cd",
    }
    negation = re.compile(r"\b(?:not|no|never|without|lack|lacking)\b", re.IGNORECASE)

    @classmethod
    def normalize(cls, value: str):
        label = " ".join(unicodedata.normalize("NFKC", value).casefold().split())
        return cls.aliases.get(label, label)

    @classmethod
    def review_required(cls, value: str):
        label = cls.normalize(value)
        return label != "ci/cd" and bool(re.search(r"\b(?:or|and|with|experience|proficiency|knowledge|including)\b|[/;\n]", label))


class SkillCoverageMatcher:
    weights = {"required": 3, "unspecified": 2, "preferred": 1}
    review_categories = ("experience", "education", "certifications", "languages", "eligibility",
                         "applicationRequirements", "additionalRequirements", "location", "workMode",
                         "employmentType", "compensation")

    def candidates(self, resume: DraftRecord, profile: ProfileSkills | None):
        found = {}

        def add(fact, field):
            if fact.value and fact.evidence:
                found.setdefault(SkillNormalizer.normalize(fact.value), CandidateEvidence(
                    source="resume", field=field, value=fact.value, evidence=fact.evidence))

        for field in ("skills", "technologies"):
            for fact in getattr(resume.draft, field):
                add(fact, field)
        for field in ("experience", "projects"):
            for index, entry in enumerate(getattr(resume.draft, field)):
                for fact in entry.skills:
                    add(fact, f"{field}.{index}.skills")
        if profile:
            for skill in profile.skills:
                found.setdefault(SkillNormalizer.normalize(skill), CandidateEvidence(
                    source="profile", field="skills", value=skill, evidence=[]))
        return found

    def compare(self, resume: DraftRecord, job: JobAnalysisRecord, profile: ProfileSkills | None = None):
        candidates = self.candidates(resume, profile)
        requirements = {}
        not_stated = []
        for category in ("skills", "technologies"):
            facts = getattr(job.analysis, category)
            if not facts:
                not_stated.append(category)
            for fact in facts:
                key = SkillNormalizer.normalize(fact.value or "")
                previous = requirements.get(key)
                if previous is None or self.weights[fact.priority] > self.weights[previous[1].priority]:
                    requirements[key] = (category, fact)
        items = []
        for key, (category, fact) in requirements.items():
            review = (not fact.value or SkillNormalizer.review_required(fact.value)
                      or any(SkillNormalizer.negation.search(quote.quote) for quote in fact.evidence)
                      or any(a.section == b.section and a.start < b.end and b.start < a.end
                             for warning in job.analysis.warnings for a in fact.evidence for b in warning.evidence))
            candidate = None if review else candidates.get(key)
            if candidate and any(SkillNormalizer.negation.search(quote.quote) for quote in candidate.evidence):
                review, candidate = True, None
            items.append(MatchItem(category=category, requirement=fact,
                                   status="needs_review" if review else "matched" if candidate else "not_found",
                                   weight=0 if review else self.weights[fact.priority], candidate=candidate))
        for category in self.review_categories:
            value = getattr(job.analysis, category)
            facts = value if isinstance(value, list) else [value] if value.value else []
            if not facts:
                not_stated.append(category)
            for fact in facts:
                requirement = fact if isinstance(fact, Requirement) else Requirement(
                    value=fact.value, evidence=fact.evidence, priority="unspecified", priorityEvidence=[])
                items.append(MatchItem(category=category, requirement=requirement, status="needs_review", weight=0, candidate=None))
        total = sum(item.weight for item in items)
        matched = sum(item.weight for item in items if item.status == "matched")
        return MatchResult(source=MatchSource(resume=resume.source, draftId=resume.id, draftVersion=resume.version,
                           jobId=job.source.jobId, jobHash=job.source.sha256, jobAnalysisId=job.id,
                           jobAnalysisVersion=job.version, profileVersion=profile.version if profile else None),
                           score=(matched * 100 + total // 2) // total if total else None,
                           matchedWeight=matched, totalWeight=total, items=items, notStated=not_stated)
