"""Offline synthetic-case checks; never invokes a model or reads provider credentials."""
import argparse
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / 'backend/intelligence'))
from app.evaluation.models import EvaluationDataset, EvaluationObservation
from app.evaluation.service import EvidenceEvaluator

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--dataset', type=Path, default=root / 'backend/intelligence/tests/fixtures/cady-evaluation.json')
parser.add_argument('--results', type=Path, help='JSON array of reviewed observations; omit to validate the case definitions only')
args = parser.parse_args()
dataset = EvaluationDataset.model_validate_json(args.dataset.read_text())
if args.results:
    results = [EvaluationObservation.model_validate(item) for item in json.loads(args.results.read_text())]
    report = EvidenceEvaluator().evaluate(dataset, results)
    print(json.dumps(report, indent=2))
    sys.exit(0 if report['passed'] == report['total'] else 1)
else:
    print(f'{dataset.version}: {len(dataset.cases)} valid case definitions; review status: {dataset.reviewStatus}. No answers evaluated.')
