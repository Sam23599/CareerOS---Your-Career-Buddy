import hashlib

from app.knowledge.models import EvidenceBundle


class EvidenceContractValidator:
    """Validate trusted snapshots; owning APIs must still verify current access."""

    def validate(self, bundle: EvidenceBundle, owner: str) -> None:
        sources = {}
        for source in bundle.sources:
            if source.lifecycle != 'active':
                raise ValueError('Inactive source')
            if source.ref.scope == 'private' and source.ref.ownerId != owner:
                raise ValueError('Foreign source')
            if hashlib.sha256(source.text.encode('utf-8')).hexdigest() != source.ref.contentHash:
                raise ValueError('Source content hash mismatch')
            key = source.ref.model_dump_json()
            if key in sources:
                raise ValueError('Duplicate source')
            sources[key] = source
        seen = set()
        for passage in bundle.passages:
            source = sources.get(passage.source.model_dump_json())
            if source is None or passage.end > len(source.text) or source.text[passage.start:passage.end] != passage.quote:
                raise ValueError('Evidence does not match the exact source revision/span')
            if passage.id in seen:
                raise ValueError('Duplicate evidence ID')
            seen.add(passage.id)
