import { isDeepStrictEqual } from 'node:util';
import { ApiError } from '../errors.js';
import { type SavedJobStore, parseSavedQuery } from '../saved-jobs/store.js';
import { type ProfileStore } from '../profiles/store.js';
import { type IntelligenceClient } from './client.js';
import { type ResumeAnalysisService } from './service.js';
import { type JobAnalysisService } from './job-service.js';
import { type JobSource } from './jobs.js';
import { SavedJobRanker, type RankedJob, type DeferredJob, type RankingResponse } from './ranking.js';

export class SavedJobRankingService {
  private ranker = new SavedJobRanker();
  constructor(private saved: SavedJobStore, private resumes: ResumeAnalysisService,
    private jobs: JobAnalysisService, private client: IntelligenceClient, private profiles?: ProfileStore) {}

  async rank(user: { id: string; name: string }, body: unknown, parent: AbortSignal): Promise<RankingResponse> {
    const input = SavedJobRanker.input(body);
    if ((input.includeProfileSkills || input.usePreferences) && !this.profiles) {
      throw new ApiError(503, 'ANALYSIS_UNAVAILABLE', 'Profile preferences are temporarily unavailable.');
    }
    const cancellation = new AbortController(), signal = AbortSignal.any([parent, cancellation.signal]);
    try {
      const query = parseSavedQuery({ ...input.filters, limit: '50' });
      const snapshot = await this.saved.list(user.id, query);
      if (snapshot.total > 50) throw new ApiError(413, 'RANKING_LIMIT', 'Rank up to 50 saved jobs at once. Narrow the status or priority filters and try again.');
      const [resume, profile] = await Promise.all([
        this.resumes.get(user.id, input.resumeId, signal, input.draftId),
        input.includeProfileSkills || input.usePreferences ? this.profiles!.get(user) : null,
      ]);
      const skills = input.includeProfileSkills && profile ? { version: profile.version, skills: profile.skills } : null;
      const preferences = input.usePreferences && profile ? profile.preferences : null;
      const ranked: RankedJob[] = [], unranked: DeferredJob[] = [], sources: JobSource[] = [];
      let index = 0;
      // Bound parallel private reads/comparisons. Every result uses the existing verified Python matcher.
      await Promise.all(Array.from({ length: Math.min(4, snapshot.savedJobs.length) }, async () => {
        for (;;) {
          signal.throwIfAborted();
          const saved = snapshot.savedJobs[index++];
          if (!saved) return;
          const job = { jobId: saved.jobId, title: saved.job.title, company: saved.job.company,
            location: saved.job.location, priority: saved.priority, savedAt: saved.savedAt.toISOString() };
          const defer = (reason: DeferredJob['reason']) => unranked.push({ ...job, reason });
          if (saved.status === 'NOT_INTERESTED') { defer('not_interested'); continue; }
          if (!saved.available) { defer('unavailable'); continue; }
          const current = await this.jobs.source(saved.jobId); sources.push(current.source);
          if (current.expired) { defer('expired'); continue; }
          let analysis;
          try { analysis = await this.client.jobAnalysis(user.id, current.source, undefined, signal); }
          catch (error) {
            if (error instanceof ApiError && error.code === 'JOB_ANALYSIS_NOT_FOUND') { defer('analysis_required'); continue; }
            throw error;
          }
          if (analysis.source.sha256 !== current.source.sha256) { defer('stale_analysis'); continue; }
          const match = await this.client.compare(user.id, resume, analysis, skills, signal);
          const result = this.ranker.summarize(job, match, this.ranker.preferences(saved.job, preferences));
          if ('reason' in result) unranked.push(result); else ranked.push(result);
        }
      }));
      signal.throwIfAborted();
      await this.resumes.requireSource(user.id, resume.source);
      const [latest, currentProfile] = await Promise.all([
        this.saved.list(user.id, query), profile ? this.profiles!.get(user) : null,
      ]);
      if (!isDeepStrictEqual(latest, snapshot) || currentProfile?.version !== profile?.version) throw this.changed();
      // Recheck descriptions (not present in the saved-job summary) and expiration before returning.
      for (const source of sources) {
        signal.throwIfAborted();
        const current = await this.jobs.recheck(source);
        if (current.expired && ranked.some(job => job.jobId === source.jobId)) throw this.changed();
      }
      signal.throwIfAborted();
      const order = new Map(snapshot.savedJobs.map((job, i) => [job.jobId, i]));
      const result: RankingResponse = {
        rankingVersion: 'saved-skill-coverage-v1', createdAt: new Date().toISOString(), total: snapshot.total,
        filters: input.filters, source: { resume: resume.source, draftId: resume.id, draftVersion: resume.version,
          profileVersion: profile?.version ?? null }, ranked: this.ranker.sort(ranked),
        unranked: unranked.sort((a, b) => order.get(a.jobId)! - order.get(b.jobId)!),
      };
      if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024) {
        throw new ApiError(413, 'RANKING_LIMIT', 'This ranking exceeds the supported result size. Narrow your saved-job filters and retry.');
      }
      return result;
    } catch (error) { cancellation.abort(); throw error; }
  }
  private changed() { return new ApiError(409, 'RANKING_SOURCE_CHANGED', 'Your shortlist or profile changed during ranking. Refresh and rank again.'); }
}
