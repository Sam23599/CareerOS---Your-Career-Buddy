import hashlib
from copy import deepcopy

import pytest
from pydantic import ValidationError

from app.knowledge.models import EvidenceBundle
from app.knowledge.validation import EvidenceContractValidator

OWNER = '11111111-1111-4111-8111-111111111111'
OTHER = '22222222-2222-4222-8222-222222222222'


def fixture():
    text = 'Built a Django API.'
    ref = {'scope': 'private', 'ownerId': OWNER, 'sourceType': 'resume', 'sourceId': 'cv',
           'sourceVersion': '2', 'contentHash': hashlib.sha256(text.encode()).hexdigest(), 'visibilityRevision': 3}
    return {'sources': [{'ref': ref, 'lifecycle': 'active', 'trustKind': 'source_text', 'text': text}],
            'passages': [{'id': 'project', 'source': deepcopy(ref), 'quote': text, 'start': 0, 'end': len(text), 'page': 1}]}


def test_exact_source_span_and_owner_are_preserved():
    EvidenceContractValidator().validate(EvidenceBundle.model_validate(fixture()), OWNER)


@pytest.mark.parametrize('change', ['foreign', 'trash', 'archived', 'obsolete', 'hash', 'quote', 'version', 'visibility', 'span', 'duplicate'])
def test_invalid_or_inaccessible_evidence_is_rejected(change):
    value = fixture()
    if change == 'foreign':
        value['sources'][0]['ref']['ownerId'] = OTHER
    elif change in {'trash', 'archived', 'obsolete'}:
        value['sources'][0]['lifecycle'] = change
    elif change == 'hash':
        value['sources'][0]['text'] = 'Different contents.'
    elif change == 'quote':
        value['passages'][0]['quote'] = 'Built a React API.'
    elif change == 'version':
        value['passages'][0]['source']['sourceVersion'] = '1'
    elif change == 'visibility':
        value['passages'][0]['source']['visibilityRevision'] = 2
    elif change == 'span':
        value['passages'][0]['end'] = 100
    else:
        value['passages'].append(deepcopy(value['passages'][0]))
    with pytest.raises(ValueError):
        EvidenceContractValidator().validate(EvidenceBundle.model_validate(value), OWNER)


def test_private_sources_cannot_be_relabelled_public_and_locators_are_required():
    value = fixture()
    value['sources'][0]['ref'].update(scope='public', ownerId=None)
    with pytest.raises(ValidationError):
        EvidenceBundle.model_validate(value)
    value = fixture()
    value['passages'][0].pop('page')
    with pytest.raises(ValidationError):
        EvidenceBundle.model_validate(value)
