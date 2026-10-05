import { ApiError } from '../errors.js';
import { type ProfileStore } from '../profiles/store.js';
import { type IntelligenceClient } from './client.js';
import { type JobAnalysisService } from './job-service.js';
import { MatchVerifier } from './matching.js';
import { type ResumeAnalysisService } from './service.js';

export class MatchingService {
  constructor(private resumes: ResumeAnalysisService, private jobs: JobAnalysisService,
    private client: IntelligenceClient, private profiles?: ProfileStore) {}

  async compare(user: { id: string; name: string }, jobId: string, body: unknown, signal: AbortSignal) {
    const input = MatchVerifier.input(body);
    if (input.includeProfileSkills && !this.profiles) throw new ApiError(503, 'ANALYSIS_UNAVAILABLE', 'Profile skills are temporarily unavailable.');
    const [resume, job, profile] = await Promise.all([
      this.resumes.get(user.id, input.resumeId, signal, input.draftId),
      this.jobs.get(user.id, jobId, input.jobAnalysisId, signal),
      input.includeProfileSkills ? this.profiles!.get(user) : null,
    ]);
    if (job.sourceStatus.stale) throw new ApiError(409, 'JOB_ANALYSIS_STALE', 'This listing changed. Analyze its current description before matching.');
    const skills = profile ? { version: profile.version, skills: profile.skills } : null;
    const match = await this.client.compare(user.id, resume, job.analysis, skills, signal);
    await this.resumes.requireSource(user.id, resume.source);
    const current = await this.jobs.recheck(job.analysis.source);
    if (profile && (await this.profiles!.get(user)).version !== profile.version) {
      throw new ApiError(409, 'MATCH_SOURCE_CHANGED', 'Your profile changed during comparison. Compare again using its current skills.');
    }
    return { match, sourceStatus: { expired: current.expired } };
  }
}
