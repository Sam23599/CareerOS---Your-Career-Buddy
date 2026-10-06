import re

from app.core.errors import IntelligenceError
from app.jobs.models import JobAnalysisRecord
from app.matching.baseline import SkillCoverageMatcher
from app.matching.models import MatchResult
from app.resumes.models import DraftRecord, Evidence
from app.reviews.models import KeywordCheck, PreparationItem, ResumeFinding, ReviewReport, ReviewSource, SectionCheck


class ResumeChecker:
    """Checks saved facts only; absence is not proof that the original PDF lacks a section."""

    def check(self, resume: DraftRecord, match: MatchResult | None = None, job: JobAnalysisRecord | None = None):
        draft = resume.draft
        present = {
            "fullName": bool(draft.fullName.value),
            "contact": bool(draft.email.value or draft.phone.value),
            "summary": bool(draft.summary.value),
            "skills": bool(SkillCoverageMatcher().candidates(resume, None)),
            "experience": any(entry.company.value or entry.role.value for entry in draft.experience),
            "education": any(entry.institution.value or entry.qualification.value for entry in draft.education),
        }
        findings = []
        missing = (
            ("fullName", "NAME_NOT_FOUND", "warning", "Name not recognized", ["fullName"], "Check that your name is readable at the top of the PDF."),
            ("contact", "CONTACT_NOT_FOUND", "warning", "Contact details not recognized", ["email", "phone"], "Check that a current email address or phone number is readable in the PDF."),
            ("summary", "SUMMARY_NOT_FOUND", "suggestion", "Summary not recognized", ["summary"], "Consider a short, truthful summary of your experience and target role if it would help this application."),
            ("skills", "SKILLS_NOT_FOUND", "suggestion", "Skills not recognized", ["skills", "technologies", "experience", "projects"], "If relevant, name skills you have actually used and connect them to work or projects."),
            ("experience", "EXPERIENCE_NOT_FOUND", "suggestion", "Work experience not recognized", ["experience"], "Review the original PDF. If you are early in your career, relevant projects or education may be more useful than a work section."),
            ("education", "EDUCATION_NOT_FOUND", "suggestion", "Education not recognized", ["education"], "Check whether relevant qualifications should be included for this role; this section may be unnecessary for some applications."),
        )
        for section, code, severity, title, fields, action in missing:
            if not present[section]:
                findings.append(ResumeFinding(code=code, severity=severity, title=title,
                    message="Not found in the selected saved analysis. Check the original PDF before making changes.",
                    action=action, fields=fields, evidence=[]))

        incomplete, evidence = [], []
        for index, entry in enumerate(draft.experience):
            if not (entry.company.value or entry.role.value):
                continue
            for field in ("company", "role"):
                if not getattr(entry, field).value:
                    incomplete.append(f"experience.{index}.{field}")
            for fact in (entry.company, entry.role):
                evidence.extend(fact.evidence)
        if incomplete:
            findings.append(ResumeFinding(code="EXPERIENCE_DETAILS_INCOMPLETE", severity="suggestion",
                title="Some work entries need context", message="A company or role was not recognized for one or more work entries.",
                action="Check these entries against the PDF. Add the missing context only if it is accurate.",
                fields=incomplete, evidence=evidence[:8]))
        entries = [(index, entry) for index, entry in enumerate(draft.experience) if entry.company.value or entry.role.value]
        if entries and not any(fact.value for _, entry in entries for fact in entry.achievements):
            findings.append(ResumeFinding(code="ACHIEVEMENTS_NOT_FOUND", severity="suggestion",
                title="Work achievements not recognized", message="No achievements were recognized in the saved work entries; descriptions may still contain them.",
                action="Review your descriptions. Where true, explain your contribution and outcome; add numbers only when you can support them.",
                fields=[f"experience.{index}.achievements" for index, _ in entries], evidence=evidence[:8]))
        for warning in resume.extraction.warnings:
            findings.insert(0, ResumeFinding(code=warning.code, severity="warning", title="Review PDF reading",
                message=warning.message, action="Compare the extracted text with the original PDF before relying on these checks.",
                fields=["extraction.warnings"], evidence=[]))
        return ReviewReport(source=ReviewSource(resume=resume.source, draftId=resume.id, draftVersion=resume.version),
            sections=[SectionCheck(section=section, present=value) for section, value in present.items()],
            findings=findings, match=match, preparation=PreparationPlanner().plan(match) if match else [],
            keywords=KeywordChecker().check(resume, job) if job else [])


class KeywordChecker:
    """Literal, case-insensitive phrases in extracted page text, never proficiency claims."""

    def check(self, resume: DraftRecord, job: JobAnalysisRecord):
        results, seen = [], set()
        for term in job.analysis.keywords:
            key = " ".join((term.value or "").lower().split())
            if not key or key in seen:
                continue
            seen.add(key)
            pattern = re.compile(r"(?<![\w+#])(?<!\w\.)" + r"\s+".join(re.escape(part) for part in term.value.split()) + r"(?![\w+#]|\.\w)", re.IGNORECASE)
            evidence = []
            for page in resume.extraction.pages:
                found = next((found for found in pattern.finditer(page.text) if " ".join(found.group().lower().split()) == key), None)
                if found:
                    quote = found.group()
                    if len(quote) > 6000:
                        raise IntelligenceError(413, "REVIEW_LIMIT")
                    evidence = [Evidence(page=page.number, quote=quote)]
                    break
            results.append(KeywordCheck(term=term, status="found" if evidence else "not_found", evidence=evidence))
        return results


class PreparationPlanner:
    """Evidence-bound actions, not generated qualifications or semantic fit judgments."""

    def plan(self, match: MatchResult):
        actions = []
        for index, item in enumerate(match.items):
            if item.status == "not_found":
                kind = "not_found"
                action = ("First check whether you already have this skill. If so, add a truthful work or project example to your CV. "
                          "Otherwise, review its fundamentals and practise it in a small project before claiming it.")
            elif item.status == "matched" and item.candidate.source == "profile":
                kind = "profile_only"
                action = "This is listed in your profile, but no skill evidence was found in this CV analysis. If accurate, add a concrete example to the CV."
            elif item.status == "needs_review":
                kind = "review"
                action = "Read the quoted requirement and compare it with your circumstances. This rule-based report cannot decide whether you meet it."
            else:
                continue
            actions.append(PreparationItem(matchIndex=index, kind=kind, action=action))
        priority = {"required": 0, "unspecified": 1, "preferred": 2}
        return sorted(actions, key=lambda action: (action.kind == "review", priority[match.items[action.matchIndex].requirement.priority], action.matchIndex))
