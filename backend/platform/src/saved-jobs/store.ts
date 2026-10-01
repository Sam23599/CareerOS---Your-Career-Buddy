import { createHash, randomUUID } from 'node:crypto';
import { type Db, type Filter, MongoServerError } from 'mongodb';
import { ApiError } from '../errors.js';
import { type Job } from '../jobs/model.js';

export const statuses = ['SAVED', 'INTERESTED', 'NOT_INTERESTED'] as const;
export const priorities = ['LOW', 'MEDIUM', 'HIGH'] as const;
type Summary = Pick<Job, 'title' | 'company' | 'location' | 'source' | 'sourceUrl' | 'remoteType' | 'employmentType' | 'expiresAt'>;
type SavedJob = { _id: string; ownerId: string; jobId: string; snapshot: Summary; status: typeof statuses[number]; priority: typeof priorities[number]; notes: string; revision: string; savedAt: Date; updatedAt: Date };
function summary(job: Job): Summary { return { title: job.title, company: job.company, location: job.location, source: job.source, sourceUrl: job.sourceUrl, remoteType: job.remoteType, employmentType: job.employmentType, expiresAt: job.expiresAt }; }
function response(saved: SavedJob, job: Job | null) {
  return { jobId: saved.jobId, status: saved.status, priority: saved.priority, notes: saved.notes, revision: saved.revision, savedAt: saved.savedAt, updatedAt: saved.updatedAt, available: Boolean(job), job: job ? summary(job) : saved.snapshot };
}
function key(owner: string, jobId: string) { return createHash('sha256').update(`${owner}\0${jobId}`).digest('hex'); }
function validateId(id: string) { if (!/^[a-f0-9]{64}$/.test(id)) throw new ApiError(400, 'INVALID_JOB_ID', 'Invalid job ID.'); }
export function parseSavedPatch(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'INVALID_SAVED_JOB', 'Provide a JSON object.');
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => !['revision', 'status', 'priority', 'notes'].includes(key)) || Object.keys(input).length < 2) throw new ApiError(400, 'INVALID_SAVED_JOB', 'Include only revision and fields to update.');
  if (typeof input.revision !== 'string' || !/^[a-f0-9-]{36}$/.test(input.revision)) throw new ApiError(400, 'INVALID_SAVED_JOB', 'Include the saved job revision.');
  const changes: Partial<Pick<SavedJob, 'status' | 'priority' | 'notes'>> = {};
  if ('status' in input) { if (!statuses.includes(input.status as SavedJob['status'])) throw new ApiError(400, 'INVALID_SAVED_JOB', 'Invalid interest status.'); changes.status = input.status as SavedJob['status']; }
  if ('priority' in input) { if (!priorities.includes(input.priority as SavedJob['priority'])) throw new ApiError(400, 'INVALID_SAVED_JOB', 'Invalid priority.'); changes.priority = input.priority as SavedJob['priority']; }
  if ('notes' in input) { if (typeof input.notes !== 'string' || input.notes.length > 5000) throw new ApiError(400, 'INVALID_SAVED_JOB', 'Notes must be text up to 5,000 characters.'); changes.notes = input.notes; }
  return { revision: input.revision, changes };
}
export function parseSavedQuery(query: Record<string, unknown>) {
  const choice = (key: string, allowed: readonly string[]) => { const value = query[key]; if (value === undefined || value === '') return ''; if (typeof value !== 'string' || !allowed.includes(value)) throw new ApiError(400, 'INVALID_FILTER', `Invalid ${key}.`); return value; };
  const number = (key: string, fallback: number, max: number) => { const value = query[key]; if (value === undefined) return fallback; if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) throw new ApiError(400, 'INVALID_FILTER', `Invalid ${key}.`); return Number(value); };
  return { status: choice('status', statuses), priority: choice('priority', priorities), page: number('page', 1, 1000), limit: number('limit', 20, 50) };
}
export class SavedJobStore {
  private saved; private jobs;
  constructor(db: Db) { this.saved = db.collection<SavedJob>('saved_jobs'); this.jobs = db.collection<Job>('jobs'); }
  private initialization?: Promise<unknown>;
  initialize() {
    this.initialization ??= this.saved.createIndex({ ownerId: 1, savedAt: -1, _id: 1 }).catch(error => { this.initialization = undefined; throw error; });
    return this.initialization;
  }
  async get(owner: string, jobId: string) {
    validateId(jobId);
    const saved = await this.saved.findOne({ _id: key(owner, jobId), ownerId: owner });
    return saved ? response(saved, await this.jobs.findOne({ _id: jobId })) : null;
  }
  async save(owner: string, jobId: string) {
    validateId(jobId);
    const existing = await this.get(owner, jobId); if (existing) return existing;
    const job = await this.jobs.findOne({ _id: jobId });
    if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', 'Job not found.');
    const now = new Date();
    try {
      await this.saved.updateOne({ _id: key(owner, jobId), ownerId: owner }, { $setOnInsert: { ownerId: owner, jobId, snapshot: summary(job), status: 'SAVED', priority: 'MEDIUM', notes: '', revision: randomUUID(), savedAt: now, updatedAt: now } }, { upsert: true });
    } catch (error) { if (!(error instanceof MongoServerError && error.code === 11000)) throw error; }
    const saved = await this.get(owner, jobId);
    if (!saved) throw new ApiError(409, 'SAVED_JOB_CHANGED', 'This saved job changed. Please refresh and retry.');
    return saved;
  }
  async update(owner: string, jobId: string, patch: ReturnType<typeof parseSavedPatch>) {
    validateId(jobId);
    const saved = await this.saved.findOneAndUpdate({ _id: key(owner, jobId), ownerId: owner, revision: patch.revision }, { $set: { ...patch.changes, revision: randomUUID(), updatedAt: new Date() } }, { returnDocument: 'after' });
    if (!saved) throw new ApiError(409, 'SAVED_JOB_CHANGED', 'This saved job was changed or removed. Reload it before saving again.');
    return response(saved, await this.jobs.findOne({ _id: jobId }));
  }
  async remove(owner: string, jobId: string) { validateId(jobId); await this.saved.deleteOne({ _id: key(owner, jobId), ownerId: owner }); }
  async list(owner: string, query: ReturnType<typeof parseSavedQuery>) {
    const filter: Filter<SavedJob> = { ownerId: owner };
    if (query.status) filter.status = query.status as SavedJob['status'];
    if (query.priority) filter.priority = query.priority as SavedJob['priority'];
    const [total, rows] = await Promise.all([this.saved.countDocuments(filter), this.saved.find(filter).sort({ savedAt: -1, _id: 1 }).skip((query.page - 1) * query.limit).limit(query.limit).toArray()]);
    const jobs = new Map((await this.jobs.find({ _id: { $in: rows.map(row => row.jobId) } }).toArray()).map(job => [job._id, job]));
    return { savedJobs: rows.map(row => response(row, jobs.get(row.jobId) ?? null)), total, page: query.page, limit: query.limit };
  }
}
