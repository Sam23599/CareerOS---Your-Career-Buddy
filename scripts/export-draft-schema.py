"""Run with backend/intelligence/.venv/bin/python from the repository root."""
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / "backend/intelligence"))
from app.resumes.models import DraftRecord
from app.jobs.models import JobAnalysisRecord
from app.matching.models import MatchResult
from app.reviews.models import ReviewReport
from app.preparation.models import PreparationRecord, PreparationInput, PreparationHistory, PlanReview
from app.cady.models import CadyResult, CadyInput

for name, model in [("resume-draft", DraftRecord), ("job-analysis", JobAnalysisRecord), ("matching", MatchResult), ("resume-review", ReviewReport),
                    ("preparation", PreparationRecord), ("preparation-input", PreparationInput), ("preparation-history", PreparationHistory),
                    ("preparation-review", PlanReview), ("cady", CadyResult), ("cady-input", CadyInput)]:
    path = root / f"backend/platform/src/intelligence/{name}.schema.json"
    content = json.dumps(model.model_json_schema(), indent=2) + "\n"
    if "--check" in sys.argv:
        if not path.exists() or path.read_text() != content:
            raise SystemExit(f"{name} schema is stale; regenerate it before building.")
        print(f"{name} JSON schema matches Python.")
    else:
        path.write_text(content)
        print(f"{name} JSON schema exported.")
