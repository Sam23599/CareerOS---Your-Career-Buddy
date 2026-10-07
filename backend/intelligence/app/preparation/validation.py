import re

from app.core.errors import IntelligenceError
from app.llm.validation import ResponseValidationError


class PreparationValidator:
    def choices(self, goals, match):
        indexes = [choice.matchIndex for choice in goals.choices]
        if len(set(indexes)) != len(indexes) or len(indexes) > goals.hoursPerWeek * goals.weeks or any(index >= len(match.items) or not match.items[index].requirement.value for index in indexes):
            raise IntelligenceError(400, "INVALID_INPUT")
        return indexes

    def output(self, plan, goals, match):
        self.choices(goals, match)
        choices = {choice.matchIndex: choice.classification for choice in goals.choices}
        hours, covered = {}, set()
        for action in plan.actions:
            classification = choices.get(action.matchIndex)
            if classification is None or action.week > goals.weeks:
                raise ResponseValidationError("preparation", "invalid_requirement_or_week")
            if (classification in ("already_know", "need_evidence") and action.kind in ("learn", "project")) or (classification == "unsure" and action.kind not in ("verify", "checkpoint")):
                raise ResponseValidationError("preparation", "classification_mismatch")
            if classification == "want_to_learn" and action.kind == "cv_evidence":
                raise ResponseValidationError("preparation", "unsupported_cv_evidence")
            hours[action.week] = hours.get(action.week, 0) + action.hours
            covered.add(action.matchIndex)
        if any(value > goals.hoursPerWeek for value in hours.values()) or covered != set(choices):
            raise ResponseValidationError("preparation", "time_or_coverage_invalid")
        self.no_links(plan.model_dump_json())
        return plan

    @staticmethod
    def no_links(text):
        if re.search(r"https?://|www\.|\b[^\s@]+@[^\s@]+\.[^\s@]+\b|\b[\w.-]+\.(?:com|org|net|io|dev|edu|co|ai)\b", text, re.I):
            raise ResponseValidationError("career_advice", "unexpected_contact_or_link")
