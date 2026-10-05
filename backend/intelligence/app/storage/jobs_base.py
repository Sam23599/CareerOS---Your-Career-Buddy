from abc import ABC, abstractmethod

from app.jobs.models import JobAnalysisHistory, JobAnalysisRecord


class JobAnalysisRepository(ABC):
    @abstractmethod
    async def get(self, owner: str, job_id: str, source_hash: str, analysis_id: str | None = None) -> JobAnalysisRecord | None: ...

    @abstractmethod
    async def history(self, owner: str, job_id: str, before_version: int | None = None) -> JobAnalysisHistory: ...

    @abstractmethod
    async def save(self, owner: str, record: JobAnalysisRecord) -> JobAnalysisRecord: ...

    @abstractmethod
    async def delete(self, owner: str, job_id: str): ...
