from app.evaluation.models import EvaluationCase, EvaluationDataset, EvaluationObservation


class EvidenceEvaluator:
    """Offline evidence/permission checks; this is not semantic truth verification."""

    def score(self, case: EvaluationCase, result: EvaluationObservation) -> dict:
        if case.id != result.caseId:
            raise ValueError('Observation belongs to another case')
        required, retrieved, cited = set(case.requiredEvidence), set(result.retrieved), set(result.cited)
        missing = sorted(required - retrieved)
        missing_citations = sorted(required - cited)
        forbidden = sorted(set(case.forbiddenEvidence) & (retrieved | cited))
        invalid_citations = sorted(cited - retrieved)
        abstention_correct = result.abstained == case.shouldAbstain
        return {
            'caseId': case.id,
            'retrievalRecall': len(required & retrieved) / len(required) if required else None,
            'missingEvidence': missing,
            'missingCitations': missing_citations,
            'forbiddenEvidence': forbidden,
            'invalidCitations': invalid_citations,
            'abstentionCorrect': abstention_correct,
            'unsupportedClaims': result.unsupportedClaims,
            'passed': not (missing or missing_citations or forbidden or invalid_citations or result.unsupportedClaims) and abstention_correct,
        }

    def evaluate(self, dataset: EvaluationDataset, results: list[EvaluationObservation]) -> dict:
        observations = {result.caseId: result for result in results}
        cases = {case.id for case in dataset.cases}
        if len(observations) != len(results) or set(observations) != cases:
            raise ValueError('Provide exactly one observation for every case; no omissions or extra cases')
        unknown = {id for result in results for id in [*result.retrieved, *result.cited]} - dataset.evidence.keys()
        if unknown:
            raise ValueError('Observation references unknown fixture evidence')
        rows = [self.score(case, observations[case.id]) for case in dataset.cases]
        recalls = [row['retrievalRecall'] for row in rows if row['retrievalRecall'] is not None]
        return {
            'datasetVersion': dataset.version, 'reviewStatus': dataset.reviewStatus,
            'cases': rows, 'passed': sum(row['passed'] for row in rows), 'total': len(rows),
            'meanRetrievalRecall': sum(recalls) / len(recalls) if recalls else None,
            'permissionFailures': sum(bool(row['forbiddenEvidence']) for row in rows),
        }
