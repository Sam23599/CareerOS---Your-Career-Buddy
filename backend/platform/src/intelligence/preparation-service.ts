import { ApiError } from '../errors.js';
import { type ProfileStore } from '../profiles/store.js';
import { type IntelligenceClient } from './client.js';
import { type JobAnalysisService } from './job-service.js';
import { type ResumeAnalysisService } from './service.js';
import { validateModel } from './drafts.js';
import { PreparationVerifier } from './preparation.js';

export class PreparationService {
  constructor(private resumes: ResumeAnalysisService, private jobs: JobAnalysisService, private client: IntelligenceClient, private profiles?: ProfileStore) {}
  async start(user: { id: string; name: string }, jobId: string, body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'draftId,goals,includeProfileSkills,jobAnalysisId,model,profileVersion,reasoning,requestKey,resumeId') {
      throw new ApiError(400, 'INVALID_INPUT', 'Choose sources, goals, time and AI settings.');
    }
    const value = body as Record<string, unknown>, selection = PreparationVerifier.selection(value);
    if (selection.includeProfileSkills ? !Number.isInteger(value.profileVersion) || (value.profileVersion as number) < 0 : value.profileVersion !== null) throw new ApiError(400, 'INVALID_INPUT', 'Provide the compared profile revision or null when omitted.');
    const options = validateModel({ model: value.model, reasoning: value.reasoning });
    PreparationVerifier.input({ context: { resume: { resumeId: selection.resumeId, resumeVersion: 1, sha256: '0'.repeat(64) },
      draftId: selection.draftId, jobId, jobHash: '0'.repeat(64), jobAnalysisId: selection.jobAnalysisId, profile: null }, goals: value.goals, requestKey: value.requestKey, ...options });
    const [cv, job, profile] = await Promise.all([this.resumes.get(user.id, selection.resumeId, undefined, selection.draftId),
      this.jobs.get(user.id, jobId, selection.jobAnalysisId), selection.includeProfileSkills ? this.profile(user) : null]);
    if (job.sourceStatus.stale || job.sourceStatus.expired) throw new ApiError(409, 'JOB_ANALYSIS_STALE', 'Choose an analysis of the current, active listing.');
    if (profile && profile.version !== value.profileVersion) throw new ApiError(409, 'MATCH_SOURCE_CHANGED', 'Your profile changed. Review the comparison again before generating.');
    const input = PreparationVerifier.input({ context: { resume: cv.source, draftId: cv.id, jobId, jobHash: job.analysis.source.sha256,
      jobAnalysisId: job.analysis.id, profile: profile ? { version: profile.version, skills: profile.skills } : null }, goals: value.goals, requestKey: value.requestKey, ...options });
    await this.resumes.requireSource(user.id, cv.source); await this.jobs.recheck(job.analysis.source);
    return this.client.startPreparation(user.id, jobId, input);
  }
  private async profile(user: { id: string; name: string }) {
    if (!this.profiles) throw new ApiError(503, 'ANALYSIS_UNAVAILABLE', 'Profile skills are temporarily unavailable.');
    return this.profiles.get(user);
  }
  async get(user: { id: string; name: string }, jobId: string, planId: string) {
    const record = await this.client.preparation(user.id, jobId, planId);
    const [cv, job, profile] = await Promise.all([this.resumes.get(user.id, record.source.resume.resumeId, undefined, record.source.draftId),
      this.jobs.get(user.id, jobId, record.source.jobAnalysisId), record.source.profileVersion !== null ? this.profile(user) : null]);
    // Reads never regenerate advice or silently substitute new profile facts.
    const match = await this.client.compare(user.id, cv, job.analysis, null, new AbortController().signal);
    const bound = { ...match, source: { ...match.source, profileVersion: record.source.profileVersion } };
    PreparationVerifier.bound(record, bound);
    await this.resumes.requireSource(user.id, cv.source); const current = await this.jobs.source(jobId);
    return { record, match, sourceStatus: { stale: current.source.sha256 !== record.source.jobHash, expired: current.expired,
      profileChanged: profile !== null && profile.version !== record.source.profileVersion } };
  }
  async history(user: { id: string; name: string }, jobId: string, before?: number) {
    const current = await this.jobs.source(jobId), history = await this.client.preparationHistory(user.id, jobId, before);
    const versions = [];
    for (const item of history.versions) {
      try { await this.resumes.requireSource(user.id, item.source.resume); }
      catch (error) { if (error instanceof ApiError && error.code === 'RESUME_NOT_FOUND') continue; throw error; }
      versions.push({ ...item, stale: item.source.jobHash !== current.source.sha256 });
    }
    return { ...history, versions };
  }
  async review(user: { id: string; name: string }, jobId: string, planId: string, body: unknown) {
    const review = PreparationVerifier.review(body), existing = await this.get(user, jobId, planId);
    if (existing.sourceStatus.stale || existing.sourceStatus.profileChanged) throw new ApiError(409, 'MATCH_SOURCE_CHANGED', 'Sources changed. Generate a plan using the current inputs before editing.');
    const record = await this.client.reviewPreparation(user.id, jobId, planId, review);
    await this.resumes.requireSource(user.id, record.source.resume);
    await this.jobs.recheck((await this.jobs.get(user.id, jobId, record.source.jobAnalysisId)).analysis.source);
    return { ...existing, record };
  }
}
