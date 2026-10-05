import json

from app.core.errors import IntelligenceError
from app.core.settings import Settings
from app.llm.models import ModelRegistry, StructuredRequest
from app.llm.providers.base import ProviderRegistry
from app.llm.gate import GenerationGate


class LLMService:
    """Shared structured generation; resume analysis is its first consumer."""

    def __init__(self, settings: Settings, providers: ProviderRegistry, models: ModelRegistry):
        self.settings, self.providers, self.models = settings, providers, models
        self.gate = GenerationGate()

    @property
    def available(self):
        return self.providers.get(self.settings.provider) is not None

    async def generate(self, model, reasoning, instructions, text, schema):
        self.models.validate(model, reasoning, self.settings.provider)
        provider = self.providers.get(self.settings.provider)
        if provider is None:
            raise IntelligenceError(503, "ANALYSIS_UNAVAILABLE")
        # Bound all externally sent content, including prompt and schema. No silent truncation.
        size = len((text + instructions + json.dumps(schema.model_json_schema())).encode("utf-8"))
        if size > self.settings.max_input_bytes:
            raise IntelligenceError(413, "LLM_BUDGET_LIMIT")
        return await provider.generate(StructuredRequest(model, reasoning, instructions, text, schema,
                                                         self.settings.max_output_tokens))
