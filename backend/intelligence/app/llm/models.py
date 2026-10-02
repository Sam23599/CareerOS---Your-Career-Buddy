from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel

from app.core.errors import IntelligenceError


@dataclass(frozen=True)
class ModelCapability:
    id: str
    reasoning: tuple[str, ...]
    provider: str = "openai"


class ModelRegistry:
    models = (
        ModelCapability("gpt-4.1", ()),
        ModelCapability("gpt-6-luna", ("none", "low", "medium", "high", "xhigh", "max")),
        ModelCapability("gpt-6.1-sol", ("low", "medium", "high", "xhigh", "max")),
    )

    def __init__(self, models=None):
        self.models = tuple(models) if models is not None else self.models

    def validate(self, model: str, reasoning: str | None, provider: str = "openai"):
        capability = next((item for item in self.models if item.id == model and item.provider == provider), None)
        if capability is None or (reasoning not in capability.reasoning if capability.reasoning else reasoning is not None):
            raise IntelligenceError(400, "INVALID_INPUT")

    def describe(self, provider: str = "openai"):
        return [{"id": item.id, "reasoningOptions": list(item.reasoning)} for item in self.models if item.provider == provider]


@dataclass(frozen=True)
class StructuredRequest:
    model: str
    reasoning: str | None
    instructions: str
    input: str
    schema: type[BaseModel]
    max_output_tokens: int


@dataclass(frozen=True)
class StructuredResult:
    value: Any
    input_tokens: int
    output_tokens: int
