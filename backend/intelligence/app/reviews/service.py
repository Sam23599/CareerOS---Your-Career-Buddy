from app.core.errors import IntelligenceError
from app.core.limits import MAX_OUTPUT
from app.matching.baseline import SkillCoverageMatcher
from app.reviews.models import ReviewInput
from app.reviews.rules import ResumeChecker
from app.storage.base import DraftRepository
from app.storage.jobs_base import JobAnalysisRepository


class ResumeReviewService:
    def __init__(self, drafts: DraftRepository, jobs: JobAnalysisRepository):
        self.drafts, self.jobs = drafts, jobs
        self.checker, self.matcher = ResumeChecker(), SkillCoverageMatcher()

    async def review(self, owner: str, context: ReviewInput):
        resume = await self.drafts.get(owner, context.resume, analysis_id=context.draftId)
        if resume is None:
            raise IntelligenceError(404, "ANALYSIS_NOT_FOUND")
        if resume.id != context.draftId or resume.source != context.resume:
            raise IntelligenceError(409, "MATCH_SOURCE_CHANGED")
        match, job = None, None
        if context.job:
            source = context.job
            job = await self.jobs.get(owner, source.jobId, source.jobHash, source.jobAnalysisId)
            if job is None:
                raise IntelligenceError(404, "JOB_ANALYSIS_NOT_FOUND")
            if job.id != source.jobAnalysisId or job.source.jobId != source.jobId or job.source.sha256 != source.jobHash:
                raise IntelligenceError(409, "JOB_ANALYSIS_STALE")
            match = self.matcher.compare(resume, job, source.profile)
        report = self.checker.check(resume, match, job)
        if len(report.model_dump_json().encode()) > MAX_OUTPUT:
            raise IntelligenceError(413, "REVIEW_LIMIT")
        return report
