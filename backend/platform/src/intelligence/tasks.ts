import { ApiError } from '../errors.js';

export type AnalysisTask = { id: string; kind?: 'preparation'; jobId: string; sourceHash: string; state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'; createdAt: string; updatedAt: string; analysisId: string | null; errorCode: string | null };
export class TaskVerifier {
  static uuid(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value); }
  static invalid(): never { throw new ApiError(502, 'INVALID_INTELLIGENCE_RESPONSE', 'Task history could not be read.'); }
  static history(input: unknown): { tasks: AnalysisTask[] } {
    if (!input || typeof input !== 'object' || Object.keys(input).join(',') !== 'tasks' || !('tasks' in input) || !Array.isArray(input.tasks) || input.tasks.length > 100) this.invalid();
    for (const item of input.tasks) {
      if (!item || typeof item !== 'object' || !['analysisId,createdAt,errorCode,id,jobId,sourceHash,state,updatedAt', 'analysisId,createdAt,errorCode,id,jobId,kind,sourceHash,state,updatedAt'].includes(Object.keys(item).sort().join(','))
        || ('kind' in item && item.kind !== 'preparation')
        || !this.uuid(item.id) || typeof item.jobId !== 'string' || typeof item.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(item.jobId) || !/^[a-f0-9]{64}$/.test(item.sourceHash)
        || !['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(item.state)
        || typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt)) || typeof item.updatedAt !== 'string' || !Number.isFinite(Date.parse(item.updatedAt))
        || (item.analysisId !== null && !this.uuid(item.analysisId)) || (item.state === 'succeeded' && !item.analysisId)
        || (item.errorCode !== null && (typeof item.errorCode !== 'string' || !/^[A-Z_]{1,64}$/.test(item.errorCode)))) this.invalid();
    }
    return input as { tasks: AnalysisTask[] };
  }
}
