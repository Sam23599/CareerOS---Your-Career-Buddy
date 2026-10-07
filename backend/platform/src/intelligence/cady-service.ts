import { ApiError } from '../errors.js';
import { type ProfileStore } from '../profiles/store.js';
import { type IntelligenceClient } from './client.js';
import { type JobAnalysisService } from './job-service.js';
import { type ResumeAnalysisService } from './service.js';
import { validateModel } from './drafts.js';
import { CadyVerifier, type ConversationResponse } from './cady.js';
import { TaskVerifier } from './tasks.js';

export class CadyService {
  constructor(private resumes: ResumeAnalysisService, private jobs: JobAnalysisService, private client: IntelligenceClient, private profiles?: ProfileStore) {}
  async conversation(user: { id: string; name: string }): Promise<ConversationResponse> {
    const conversation = await this.client.cadyConversation(user.id);
    if (!conversation.context) return { conversation, unavailable: false, outdated: false };
    const context = conversation.context;
    try {
      const [cv, jobs, profile] = await Promise.all([this.resumes.get(user.id, context.resume.resumeId, undefined, context.draftId),
        Promise.all(context.jobs.map(job => this.jobs.get(user.id, job.jobId, job.jobAnalysisId))), context.profile && this.profiles ? this.profiles.get(user) : null]);
      for (const turn of conversation.turns) CadyVerifier.result(turn.result, cv, jobs.map(item => item.analysis), context.profile, context);
      const outdated = jobs.some(item => item.sourceStatus.stale || item.sourceStatus.expired) || (context.profile !== null && profile?.version !== context.profile.version);
      return { conversation, unavailable: false, outdated };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return { conversation: { ...conversation, context: null, turns: [] }, unavailable: true, outdated: false };
      throw error;
    }
  }
  async reset(user: { id: string }, body: unknown) {
    return this.client.resetCady(user.id, CadyVerifier.reset(body).revision);
  }
  async ask(user: { id: string; name: string }, body: unknown, signal: AbortSignal) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || ![ 'draftId,history,includeProfileSkills,jobs,model,question,reasoning,resumeId', 'draftId,history,includeProfileSkills,jobs,model,question,reasoning,resumeId,revision' ].includes(Object.keys(body).sort().join(','))) throw new ApiError(400, 'INVALID_INPUT', 'Choose Cady context and enter your question.');
    const value = body as Record<string, unknown>;
    if (!TaskVerifier.uuid(value.resumeId) || !TaskVerifier.uuid(value.draftId) || typeof value.includeProfileSkills !== 'boolean' || !Array.isArray(value.jobs) || value.jobs.length > 3
      || value.jobs.some(job => !job || typeof job !== 'object' || Object.keys(job).sort().join(',') !== 'jobAnalysisId,jobId' || typeof job.jobId !== 'string' || !/^[a-f0-9]{64}$/.test(job.jobId) || !TaskVerifier.uuid(job.jobAnalysisId))) throw new ApiError(400, 'INVALID_INPUT', 'Choose valid saved CV and job analyses.');
    const options = validateModel({ model: value.model, reasoning: value.reasoning });
    CadyVerifier.input({ resume: { resumeId: value.resumeId, resumeVersion: 1, sha256: '0'.repeat(64) }, draftId: value.draftId,
      jobs: value.jobs.map(job => ({ ...job, jobHash: '0'.repeat(64) })), profile: null, question: value.question, history: value.history, ...(value.revision !== undefined ? { revision: value.revision } : {}), ...options });
    if (value.includeProfileSkills && !this.profiles) throw new ApiError(503, 'ANALYSIS_UNAVAILABLE', 'Profile skills unavailable.');
    const [cv, resolved, profile] = await Promise.all([this.resumes.get(user.id, value.resumeId, signal, value.draftId),
      Promise.all(value.jobs.map(job => this.jobs.get(user.id, job.jobId, job.jobAnalysisId, signal))), value.includeProfileSkills ? this.profiles!.get(user) : null]);
    if (resolved.some(job => job.sourceStatus.stale || job.sourceStatus.expired)) throw new ApiError(409, 'JOB_ANALYSIS_STALE', 'Choose analyses of current, active jobs.');
    const skills = profile ? { version: profile.version, skills: profile.skills } : null;
    const input = CadyVerifier.input({ resume: cv.source, draftId: cv.id, jobs: resolved.map(job => ({ jobId: job.analysis.source.jobId,
      jobHash: job.analysis.source.sha256, jobAnalysisId: job.analysis.id })), profile: skills, question: value.question, history: value.history, ...(value.revision !== undefined ? { revision: value.revision } : {}), ...options });
    const result = await this.client.askCady(user.id, input, cv, resolved.map(job => job.analysis), signal);
    await this.resumes.requireSource(user.id, cv.source);
    const current = await Promise.all(resolved.map(job => this.jobs.recheck(job.analysis.source)));
    if (current.some(job => job.expired)) throw new ApiError(409, 'JOB_ANALYSIS_STALE', 'A selected job expired while Cady was answering. Choose an active listing.');
    if (profile && (await this.profiles!.get(user)).version !== profile.version) throw new ApiError(409, 'MATCH_SOURCE_CHANGED', 'Profile changed. Ask again with current context.');
    return result;
  }
}
