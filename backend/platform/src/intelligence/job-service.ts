import { ApiError } from '../errors.js';
import { type JobStore } from '../jobs/store.js';
import { type IntelligenceClient } from './client.js';
import { validateModel } from './drafts.js';
import { JobTextSource, type JobSource } from './jobs.js';
import { type JobAnalysisCleanup } from './job-cleanup.js';

export class JobAnalysisService {
  constructor(private jobs: JobStore, private client: IntelligenceClient, private cleanup?: JobAnalysisCleanup) {}
  async source(id: string) {
    const job = await this.jobs.get(id);
    return { source: JobTextSource.create(job), expired: Boolean(job.expiresAt && job.expiresAt.getTime() <= Date.now()) };
  }
  async recheck(source: JobSource) {
    const current = await this.source(source.jobId);
    if (current.source.sha256 !== source.sha256) throw new ApiError(409, 'JOB_CHANGED', 'This listing changed during processing. Reopen it and review the latest text.');
    return current;
  }
  async analyze(owner: string, id: string, input: unknown, signal: AbortSignal) {
    const options = validateModel(input);
    const { source, expired } = await this.source(id);
    if (expired) throw new ApiError(409, 'JOB_EXPIRED', 'This listing has expired. Saved analysis remains available.');
    if (!source.sections[3].text) throw new ApiError(422, 'JOB_TEXT_EMPTY', 'This listing has no description to analyze.');
    if (Buffer.byteLength(JSON.stringify(source)) > 60_000) throw new ApiError(413, 'LLM_BUDGET_LIMIT', 'This listing exceeds the configured AI input limit.');
    await this.cleanup?.track(owner, id);
    const analysis = await this.client.analyzeJob(owner, source, options, signal);
    const current = await this.recheck(source);
    return { analysis, sourceStatus: { stale: false, expired: current.expired } };
  }
  async get(owner: string, id: string, analysisId?: string, signal?: AbortSignal) {
    const { source } = await this.source(id);
    const analysis = await this.client.jobAnalysis(owner, source, analysisId, signal);
    const current = await this.recheck(source);
    return { analysis, sourceStatus: { stale: analysis.source.sha256 !== current.source.sha256, expired: current.expired } };
  }
  async history(owner: string, id: string, beforeVersion?: number) {
    const { source } = await this.source(id);
    const history = await this.client.jobHistory(owner, source, beforeVersion);
    await this.recheck(source);
    return { ...history, versions: history.versions.map(item => ({ ...item, stale: item.sourceHash !== source.sha256 })) };
  }
}
