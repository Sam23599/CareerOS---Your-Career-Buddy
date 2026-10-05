import asyncio

from app.core.errors import IntelligenceError
from app.core.limits import MAX_OUTPUT
from app.matching.baseline import SkillCoverageMatcher
from app.matching.models import MatchInput
from app.storage.base import DraftRepository
from app.storage.jobs_base import JobAnalysisRepository


class MatchingService:
    def __init__(self, drafts: DraftRepository, jobs: JobAnalysisRepository):
        self.drafts, self.jobs = drafts, jobs
        self.matcher = SkillCoverageMatcher()

    async def compare(self, owner: str, context: MatchInput):
        resume, job = await asyncio.gather(
            self.drafts.get(owner, context.resume, analysis_id=context.draftId),
            self.jobs.get(owner, context.jobId, context.jobHash, context.jobAnalysisId))
        if resume is None:
            raise IntelligenceError(404, "ANALYSIS_NOT_FOUND")
        if job is None:
            raise IntelligenceError(404, "JOB_ANALYSIS_NOT_FOUND")
        if resume.id != context.draftId or resume.source != context.resume:
            raise IntelligenceError(409, "MATCH_SOURCE_CHANGED")
        if job.id != context.jobAnalysisId or job.source.sha256 != context.jobHash:
            raise IntelligenceError(409, "JOB_ANALYSIS_STALE")
        result = self.matcher.compare(resume, job, context.profile)
        if len(result.model_dump_json().encode()) > MAX_OUTPUT:
            raise IntelligenceError(413, "MATCHING_LIMIT")
        return result
