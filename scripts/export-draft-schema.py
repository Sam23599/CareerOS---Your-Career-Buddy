"""Run with backend/intelligence/.venv/bin/python from the repository root."""
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / "backend/intelligence"))
from app.resumes.models import DraftRecord

path = root / "backend/platform/src/intelligence/resume-draft.schema.json"
content = json.dumps(DraftRecord.model_json_schema(), indent=2) + "\n"
if "--check" in sys.argv:
    if not path.exists() or path.read_text() != content:
        raise SystemExit("Resume draft schema is stale; regenerate it before building.")
    print("Resume draft JSON schema matches Python.")
else:
    path.write_text(content)
    print("Resume draft JSON schema exported.")
