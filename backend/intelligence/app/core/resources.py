import sys

from app.core.errors import IntelligenceError as ExtractionError
from app.core.limits import WORKER_MEMORY


class WorkerMemoryBudget:
    def enforce(self):
        if sys.platform != "linux":
            raise ExtractionError(503, "INTELLIGENCE_UNAVAILABLE")
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (WORKER_MEMORY, WORKER_MEMORY))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        if resource.getrlimit(resource.RLIMIT_AS) != (WORKER_MEMORY, WORKER_MEMORY):
            raise ExtractionError(503, "INTELLIGENCE_UNAVAILABLE")
