import { RecoveryStore, type Trash } from '../recovery/store.js';
import { randomUUID } from 'node:crypto';
import { type Db, type Filter, MongoServerError } from 'mongodb';
import { ApiError } from '../errors.js';
import { type Job } from '../jobs/model.js';

export const statuses = ['SAVED', 'INTERESTED', 'NOT_INTERESTED'] as const;
export const applicationStatuses = ['NOT_APPLIED', 'APPLIED', 'IN_PROGRESS', 'INTERVIEWING', 'OFFERED', 'REJECTED', 'WITHDRAWN'] as const;
export const priorities = ['LOW', 'MEDIUM', 'HIGH'] as const;
type Summary = Pick<Job, 'title' | 'company' | 'location' | 'source' | 'sourceUrl' | 'remoteType' | 'employmentType' | 'expiresAt' | 'postedAt'> & { companyKey: string };
type SavedJob = { _id: string; ownerId: string; jobId: string; snapshot: Summary; status: typeof statuses[number]; priority: typeof priorities[number]; notes: string; revision: string; savedAt: Date; updatedAt: Date; trash?: Trash; applicationStatus?: typeof applicationStatuses[number]; hasApplied?: boolean; applicationEvents?: { status: string; at: Date }[] };
function summary(job: Job): Summary { return { title: job.title, company: job.company, location: job.location, source: job.source, sourceUrl: job.sourceUrl, remoteType: job.remoteType, employmentType: job.employmentType, expiresAt: job.expiresAt, postedAt: job.postedAt, companyKey: job.company.normalize('NFKC').trim().toLowerCase() }; }
function response(saved: SavedJob, job: Job | null) {
  return { jobId: saved.jobId, applicationStatus: saved.applicationStatus ?? 'NOT_APPLIED', applicationEvents: saved.applicationEvents ?? [], status: saved.status, priority: saved.priority, notes: saved.notes, revision: saved.revision, savedAt: saved.savedAt, updatedAt: saved.updatedAt, available: Boolean(job), job: job ? summary(job) : saved.snapshot };
}
function validateId(id: string) { if (!/^[a-f0-9]{64}$/.test(id)) throw new ApiError(400, 'INVALID_JOB_ID', 'Invalid job ID.'); }
export function parseSavedPatch(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'INVALID_SAVED_JOB', 'Provide a JSON object.');
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => !['revision', 'status', 'priority', 'notes', 'applicationStatus'].includes(key)) || Object.keys(input).length < 2) throw new ApiError(400, 'INVALID_SAVED_JOB', 'Include only revision and fields to update.');
  if (typeof input.revision !== 'string' || !/^[a-f0-9-]{36}$/.test(input.revision)) throw new ApiError(400, 'INVALID_SAVED_JOB', 'Include the saved job revision.');
  const changes: Partial<Pick<SavedJob, 'status' | 'priority' | 'notes' | 'applicationStatus'>> = {};
  if ('status' in input) { if (!statuses.includes(input.status as SavedJob['status'])) throw new ApiError(400, 'INVALID_SAVED_JOB', 'Invalid interest status.'); changes.status = input.status as SavedJob['status']; }
  if ('priority' in input) { if (!priorities.includes(input.priority as SavedJob['priority'])) throw new ApiError(400, 'INVALID_SAVED_JOB', 'Invalid priority.'); changes.priority = input.priority as SavedJob['priority']; }
  if ('applicationStatus' in input) { if (!applicationStatuses.includes(input.applicationStatus as typeof applicationStatuses[number])) throw new ApiError(400, 'INVALID_SAVED_JOB', 'Invalid application status.'); changes.applicationStatus = input.applicationStatus as typeof applicationStatuses[number]; }
  if ('notes' in input) { if (typeof input.notes !== 'string' || input.notes.length > 5000) throw new ApiError(400, 'INVALID_SAVED_JOB', 'Notes must be text up to 5,000 characters.'); changes.notes = input.notes; }
  return { revision: input.revision, changes };
}
export function parseSavedQuery(query: Record<string, unknown>) {
  const choice = (key: string, allowed: readonly string[]) => { const value = query[key]; if (value === undefined || value === '') return ''; if (typeof value !== 'string' || !allowed.includes(value)) throw new ApiError(400, 'INVALID_FILTER', `Invalid ${key}.`); return value; };
  const number = (key: string, fallback: number, max: number) => { const value = query[key]; if (value === undefined) return fallback; if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) throw new ApiError(400, 'INVALID_FILTER', `Invalid ${key}.`); return Number(value); };
  const text = (key: string) => { const value = query[key]; if (value === undefined) return ''; if (typeof value !== 'string' || value.length > 100) throw new ApiError(400, 'INVALID_FILTER', `Invalid ${key}.`); return value.trim(); };
  const date = (key: string) => { const value = text(key); if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new ApiError(400, 'INVALID_FILTER', `Invalid ${key}.`); return value; };
  const postedFrom = date('postedFrom'), postedTo = date('postedTo');
  if (postedFrom && postedTo && postedFrom > postedTo) throw new ApiError(400, 'INVALID_FILTER', 'Start date must precede end date.');
  return { location: text('location'), postedFrom, postedTo, applicationStatus: choice('applicationStatus', applicationStatuses), companyHistory: choice('companyHistory', ['first_application', 'previously_applied']), status: choice('status', statuses), priority: choice('priority', priorities), page: number('page', 1, 1000), limit: number('limit', 20, 50) };
}
export class SavedJobStore {
  private saved; private jobs; private recovery;
  constructor(db: Db) { this.recovery = new RecoveryStore(db); this.saved = db.collection<SavedJob>('saved_jobs'); this.jobs = db.collection<Job>('jobs'); }
  private initialization?: Promise<unknown>;
  initialize() {
    this.initialization ??= this.initializeSnapshots().catch(error => { this.initialization = undefined; throw error; });
    return this.initialization;
  }
  private async initializeSnapshots() {
    await this.saved.createIndex({ ownerId: 1, savedAt: -1, _id: 1 });
    await this.saved.createIndex({ ownerId: 1, jobId: 1 }, { name: 'active_saved_job', unique: true, partialFilterExpression: { trash: null } });
    for await (const saved of this.saved.find({ 'snapshot.companyKey': { $exists: false } })) {
      const job = await this.jobs.findOne({ _id: saved.jobId });
      await this.saved.updateOne({ _id: saved._id, revision: saved.revision }, { $set: { 'snapshot.companyKey': saved.snapshot.company.normalize('NFKC').trim().toLowerCase(), 'snapshot.postedAt': job?.postedAt ?? null } });
    }
  }
  async get(owner: string, jobId: string) {
    validateId(jobId);
    const saved = await this.saved.findOne({ jobId, ownerId: owner, trash: { $exists: false } });
    return saved ? response(saved, await this.jobs.findOne({ _id: jobId })) : null;
  }
  async save(owner: string, jobId: string) {
    validateId(jobId);
    const existing = await this.get(owner, jobId); if (existing) return existing;
    const job = await this.jobs.findOne({ _id: jobId });
    if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', 'Job not found.');
    const now = new Date();
    try {
      await this.initialize();
      await this.saved.updateOne({ jobId, ownerId: owner, trash: { $exists: false } }, { $setOnInsert: { _id: randomUUID(), ownerId: owner, jobId, snapshot: summary(job), status: 'SAVED', applicationStatus: 'NOT_APPLIED', hasApplied: false, priority: 'MEDIUM', notes: '', revision: randomUUID(), savedAt: now, updatedAt: now } }, { upsert: true });
    } catch (error) { if (!(error instanceof MongoServerError && error.code === 11000)) throw error; }
    const saved = await this.get(owner, jobId);
    if (!saved) throw new ApiError(409, 'SAVED_JOB_CHANGED', 'This saved job changed. Please refresh and retry.');
    return saved;
  }
  async update(owner: string, jobId: string, patch: ReturnType<typeof parseSavedPatch>) {
    validateId(jobId);
    const current = await this.saved.findOne({ jobId, ownerId: owner, revision: patch.revision, trash: { $exists: false } });
    const applicationChanged = patch.changes.applicationStatus && patch.changes.applicationStatus !== (current?.applicationStatus ?? 'NOT_APPLIED');
    const saved = await this.saved.findOneAndUpdate({ jobId, ownerId: owner, trash: { $exists: false }, revision: patch.revision }, { $set: { ...patch.changes, ...(patch.changes.applicationStatus && patch.changes.applicationStatus !== 'NOT_APPLIED' ? { hasApplied: true } : {}), revision: randomUUID(), updatedAt: new Date() }, ...(applicationChanged ? { $push: { applicationEvents: { $each: [{ status: patch.changes.applicationStatus!, at: new Date() }], $slice: -100 } } } : {}) }, { returnDocument: 'after' });
    if (!saved) throw new ApiError(409, 'SAVED_JOB_CHANGED', 'This saved job was changed or removed. Reload it before saving again.');
    return response(saved, await this.jobs.findOne({ _id: jobId }));
  }
  async remove(owner: string, jobId: string) { validateId(jobId); await this.saved.updateOne({ jobId, ownerId: owner, trash: { $exists: false } }, { $set: { trash: await this.recovery.marker(owner) } }); }
  async list(owner: string, query: ReturnType<typeof parseSavedQuery>) {
    await this.initialize();
    const filter: Filter<SavedJob> = { ownerId: owner, trash: { $exists: false } };
    if (query.status) filter.status = query.status as SavedJob['status'];
    if (query.location) filter['snapshot.location'] = { $regex: query.location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    if (query.applicationStatus) { if (query.applicationStatus === 'NOT_APPLIED') filter.$or = [{ applicationStatus: 'NOT_APPLIED' }, { applicationStatus: { $exists: false } }]; else filter.applicationStatus = query.applicationStatus as typeof applicationStatuses[number]; }
    if (query.postedFrom || query.postedTo) filter['snapshot.postedAt'] = { ...(query.postedFrom ? { $gte: new Date(query.postedFrom) } : {}), ...(query.postedTo ? { $lt: new Date(Date.parse(query.postedTo) + 86_400_000) } : {}) };
    if (query.companyHistory) {
      const companies = await this.saved.distinct('snapshot.companyKey', { ownerId: owner, hasApplied: true });
      filter['snapshot.companyKey'] = query.companyHistory === 'previously_applied' ? { $in: companies } : { $nin: companies };
    }
    if (query.priority) filter.priority = query.priority as SavedJob['priority'];
    const [total, rows] = await Promise.all([this.saved.countDocuments(filter), this.saved.find(filter).sort({ savedAt: -1, _id: 1 }).skip((query.page - 1) * query.limit).limit(query.limit).toArray()]);
    const jobs = new Map((await this.jobs.find({ _id: { $in: rows.map(row => row.jobId) } }).toArray()).map(job => [job._id, job]));
    return { savedJobs: rows.map(row => response(row, jobs.get(row.jobId) ?? null)), total, page: query.page, limit: query.limit };
  }
}
