import { ApiError } from '../errors.js';
import { type ProfileStore } from '../profiles/store.js';
import { type IntelligenceClient } from './client.js';
import { type JobAnalysisService } from './job-service.js';
import { ReviewVerifier } from './reviews.js';
import { type ResumeAnalysisService } from './service.js';

export class ResumeReviewService {
  constructor(private resumes: ResumeAnalysisService, private client: IntelligenceClient,
    private jobs?: JobAnalysisService, private profiles?: ProfileStore) {}

  async review(user: { id: string; name: string }, resumeId: string, body: unknown, signal: AbortSignal) {
    const input = ReviewVerifier.input(body);
    if (input.job && !this.jobs) throw new ApiError(503, 'ANALYSIS_UNAVAILABLE', 'Job review is temporarily unavailable.');
    if (input.job?.includeProfileSkills && !this.profiles) throw new ApiError(503, 'ANALYSIS_UNAVAILABLE', 'Profile skills are temporarily unavailable.');
    const [resume, job, profile] = await Promise.all([
      this.resumes.get(user.id, resumeId, signal, input.draftId),
      input.job ? this.jobs!.get(user.id, input.job.jobId, input.job.jobAnalysisId, signal) : null,
      input.job?.includeProfileSkills ? this.profiles!.get(user) : null,
    ]);
    if (job?.sourceStatus.stale) throw new ApiError(409, 'JOB_ANALYSIS_STALE', 'This listing changed. Analyze its current description before reviewing gaps.');
    const skills = profile ? { version: profile.version, skills: profile.skills } : null;
    const report = await this.client.review(user.id, resume, job?.analysis ?? null, skills, signal);
    await this.resumes.requireSource(user.id, resume.source);
    const current = job ? await this.jobs!.recheck(job.analysis.source) : null;
    if (profile && (await this.profiles!.get(user)).version !== profile.version) {
      throw new ApiError(409, 'MATCH_SOURCE_CHANGED', 'Your profile changed during review. Review again using its current skills.');
    }
    return { report, sourceStatus: { expired: current?.expired ?? false } };
  }
}
