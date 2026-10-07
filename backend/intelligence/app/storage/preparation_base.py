from abc import ABC, abstractmethod


class PreparationRepository(ABC):
    @abstractmethod
    async def save(self, owner, record): ...

    @abstractmethod
    async def get(self, owner, job_id, plan_id): ...

    @abstractmethod
    async def history(self, owner, job_id, before=None): ...

    @abstractmethod
    async def review(self, owner, job_id, plan_id, review): ...
