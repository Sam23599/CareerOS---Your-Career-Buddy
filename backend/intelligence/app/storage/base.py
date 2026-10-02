from abc import ABC, abstractmethod

from app.resumes.models import DraftHistory, DraftRecord, Source


class DraftRepository(ABC):
    ready = False

    async def start(self):
        pass

    async def close(self):
        pass

    @abstractmethod
    async def get(self, owner: str, source: Source, model=None, reasoning=None, analysis_id=None) -> DraftRecord | None: ...

    @abstractmethod
    async def save(self, owner: str, record: DraftRecord) -> DraftRecord: ...

    @abstractmethod
    async def history(self, owner: str, source: Source, before_version: int | None = None) -> DraftHistory: ...

    @abstractmethod
    async def delete(self, owner: str, resume_id: str): ...
