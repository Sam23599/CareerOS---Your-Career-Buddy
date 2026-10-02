from abc import ABC, abstractmethod

from app.llm.models import StructuredRequest, StructuredResult


class LLMProvider(ABC):
    @abstractmethod
    async def generate(self, request: StructuredRequest) -> StructuredResult: ...

    async def close(self):
        pass


class ProviderRegistry:
    def __init__(self):
        self._providers: dict[str, LLMProvider] = {}

    def register(self, name: str, provider: LLMProvider):
        self._providers[name] = provider

    def get(self, name: str) -> LLMProvider | None:
        return self._providers.get(name)

    async def close(self):
        for provider in self._providers.values():
            await provider.close()
        self._providers.clear()
