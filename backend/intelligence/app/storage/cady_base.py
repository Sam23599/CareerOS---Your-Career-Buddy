from abc import ABC, abstractmethod


class CadyConversationRepository(ABC):
    @abstractmethod
    async def get(self, owner): ...

    @abstractmethod
    async def save(self, owner, revision, context, turns): ...
