import asyncio
from contextlib import asynccontextmanager

from app.core.errors import IntelligenceError


class GenerationGate:
    """One generation/review/save across all consumers; no waiting queue."""

    def __init__(self):
        self.active = None

    @asynccontextmanager
    async def claim(self):
        if self.active is not None:
            raise IntelligenceError(503, "INTELLIGENCE_BUSY")
        task = asyncio.current_task()
        self.active = task
        try:
            yield
        finally:
            if self.active is task:
                self.active = None

    async def close(self):
        if self.active is not None:
            self.active.cancel()
            await asyncio.gather(self.active, return_exceptions=True)
