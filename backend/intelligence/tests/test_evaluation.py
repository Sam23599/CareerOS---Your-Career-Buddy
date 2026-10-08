from pathlib import Path

import pytest

from app.evaluation.models import EvaluationDataset, EvaluationObservation
from app.evaluation.service import EvidenceEvaluator


def dataset():
    return EvaluationDataset.model_validate_json((Path(__file__).parent / 'fixtures/cady-evaluation.json').read_text())


def observations(value):
    return [EvaluationObservation(caseId=case.id, retrieved=case.requiredEvidence, cited=case.requiredEvidence,
                                  abstained=case.shouldAbstain, unsupportedClaims=[]) for case in value.cases]


def test_synthetic_controls_score_without_claiming_live_answer_quality():
    value = dataset()
    report = EvidenceEvaluator().evaluate(value, observations(value))
    assert report['total'] == report['passed'] == 16
    assert report['reviewStatus'] == 'synthetic_draft'
    assert report['permissionFailures'] == 0


def test_foreign_evidence_unsupported_claims_missing_citations_and_wrong_abstention_fail():
    value = dataset()
    results = observations(value)
    results[0].cited = []
    results[1].unsupportedClaims = ['The project proves senior engineering experience.']
    results[9].retrieved = ['foreign-cv']
    results[13].abstained = False
    report = EvidenceEvaluator().evaluate(value, results)
    assert report['passed'] == 12
    assert report['permissionFailures'] == 1
    assert report['cases'][0]['missingCitations'] == ['cv-skill']


@pytest.mark.parametrize('change', ['omit', 'duplicate', 'extra', 'unknown'])
def test_evaluation_cannot_hide_failures_or_invent_evidence(change):
    value = dataset()
    results = observations(value)
    if change == 'omit':
        results.pop()
    elif change == 'duplicate':
        results.append(results[0])
    elif change == 'extra':
        results[0].caseId = 'unknown-case'
    else:
        results[0].cited = ['invented-reference']
    with pytest.raises(ValueError):
        EvidenceEvaluator().evaluate(value, results)
