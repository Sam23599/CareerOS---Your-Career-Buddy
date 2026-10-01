import { createHash } from 'node:crypto';
import { type Db, type Filter, MongoServerError } from 'mongodb';
import { ApiError } from '../errors.js';
import { type Job, type JobSource, publicJob, validateJob, employmentTypes, remoteTypes } from './model.js';

type Run = { _id: string; nextAllowedAt: Date; startedAt: Date; finishedAt?: Date; status: 'running' | 'success' | 'failed'; imported?: number };
export function parseSearch(query: Record<string, unknown>) {
  const read = (key: string, max = 100) => { const value = query[key]; if (value === undefined) return ''; if (typeof value !== 'string' || value.length > max) throw new ApiError(400, 'INVALID_SEARCH', `Invalid ${key}.`); return value.trim(); };
  const integer = (key: string, fallback: number, max: number) => { const raw = read(key); const n = raw ? Number(raw) : fallback; if (!/^\d*$/.test(raw) || !Number.isSafeInteger(n) || n < 1 || n > max) throw new ApiError(400, 'INVALID_SEARCH', `Invalid ${key}.`); return n; };
  const employmentType = read('employmentType'), remoteType = read('remoteType');
  if (employmentType && !employmentTypes.includes(employmentType as typeof employmentTypes[number])) throw new ApiError(400, 'INVALID_SEARCH', 'Invalid employment type.');
  if (remoteType && !remoteTypes.includes(remoteType as typeof remoteTypes[number])) throw new ApiError(400, 'INVALID_SEARCH', 'Invalid work mode.');
  return { q: read('q'), location: read('location'), company: read('company'), skill: read('skill'), source: read('source'), employmentType, remoteType, page: integer('page', 1, 1000), limit: integer('limit', 20, 50) };
}
export class JobStore {
  readonly jobs; private runs;
  constructor(db: Db) { this.jobs = db.collection<Job>('jobs'); this.runs = db.collection<Run>('job_ingestion_runs'); }
  private initialization?: Promise<void>;
  initialize() {
    this.initialization ??= this.createIndexes().catch(error => { this.initialization = undefined; throw error; });
    return this.initialization;
  }
  private async createIndexes() {
    await this.jobs.createIndex({ source: 1, sourceId: 1 }, { unique: true });
    await this.jobs.createIndex({ postedAt: -1, _id: 1 });
  }
  async nextRefreshAt(source: JobSource) {
    const run = await this.runs.findOne({ _id: source.id });
    if (!run) return new Date(0);
    // Respect an in-progress lease; adopt shorter configured intervals for completed runs.
    return run.status === 'running' ? run.nextAllowedAt
      : new Date(Math.min(run.nextAllowedAt.getTime(), run.startedAt.getTime() + source.cooldownMs));
  }
  async ingest(source: JobSource) {
    const now = new Date();
    try {
      await this.runs.findOneAndUpdate({ _id: source.id, $or: [{ nextAllowedAt: { $lte: now } }, { status: { $ne: 'running' }, startedAt: { $lte: new Date(now.getTime() - source.cooldownMs) } }] }, { $set: { nextAllowedAt: new Date(now.getTime() + Math.max(source.cooldownMs, 60_000)), startedAt: now, status: 'running' } }, { upsert: true });
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) throw new ApiError(409, 'INGESTION_COOLDOWN', 'This source was refreshed recently or an import is running. Try again later.');
      throw error;
    }
    try {
      const incoming = await source.fetchJobs();
      const seen = new Set<string>();
      for (const job of incoming) { validateJob(job); if (seen.has(job.sourceId)) throw new Error('Duplicate source IDs.'); seen.add(job.sourceId); }
      if (incoming.length) await this.jobs.bulkWrite(incoming.map(job => ({ updateOne: {
        filter: { _id: createHash('sha256').update(`${source.id}\0${job.sourceId}`).digest('hex') },
        update: { $set: { ...job, source: source.id, updatedAt: now }, $setOnInsert: { createdAt: now } }, upsert: true,
      } })));
      await this.runs.updateOne({ _id: source.id }, { $set: { status: 'success', finishedAt: new Date(), imported: incoming.length, nextAllowedAt: new Date(now.getTime() + source.cooldownMs) } });
      return { source: source.id, imported: incoming.length };
    } catch (error) {
      await this.runs.updateOne({ _id: source.id }, { $set: { status: 'failed', finishedAt: new Date() } });
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, 'INGESTION_FAILED', 'The source could not be imported. Existing listings were retained.');
    }
  }
  async list(query: ReturnType<typeof parseSearch>) {
    const filter: Filter<Job> = { $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] };
    const literal = (value: string) => ({ $regex: value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' });
    if (query.q) filter.$and = [{ $or: ['title', 'company', 'description', 'skills'].map(key => ({ [key]: literal(query.q) })) }];
    for (const key of ['location', 'company'] as const) if (query[key]) filter[key] = literal(query[key]);
    if (query.skill) filter.skills = literal(query.skill);
    if (query.source) filter.source = query.source;
    if (query.employmentType) filter.employmentType = query.employmentType as Job['employmentType'];
    if (query.remoteType) filter.remoteType = query.remoteType as Job['remoteType'];
    const [total, rows] = await Promise.all([this.jobs.countDocuments(filter), this.jobs.find(filter).sort({ postedAt: -1, _id: 1 }).skip((query.page - 1) * query.limit).limit(query.limit).toArray()]);
    return { jobs: rows.map(publicJob), total, page: query.page, limit: query.limit };
  }
  async get(id: string) { const job = /^[a-f0-9]{64}$/.test(id) ? await this.jobs.findOne({ _id: id }) : null; if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', 'Job not found.'); return publicJob(job); }
}
