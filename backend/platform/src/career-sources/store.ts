import { randomUUID } from 'node:crypto';
import { type Db, type Filter, MongoServerError } from 'mongodb';
import { ApiError } from '../errors.js';
import { type Job, type JobSource, publicJob } from '../jobs/model.js';
import { type JobStore } from '../jobs/store.js';
import { type Notice, type NotificationService } from '../notifications/store.js';
import { GreenhouseSource, greenhouseBoard } from './greenhouse.js';

type Settings = { company: string; careerUrl: string; keywords: string[]; locations: string[]; scanHours: number; enabled: boolean };
type Source = Settings & {
  _id: string; ownerId: string; board: string | null; revision: string; createdAt: Date; updatedAt: Date;
  status: 'unchecked' | 'success' | 'failed'; lastCheckedAt: Date | null; importedAt: Date | null;
  matchingCount: number; newCount: number; nextScanAt: Date; seenIds: string[];
  leaseUntil?: Date; leaseToken?: string; pendingNotice?: Notice;
};
const invalid = (message: string) => new ApiError(400, 'INVALID_CAREER_SOURCE', message);
const literal = (value: string) => ({ $regex: value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' });
export function parseSource(body: unknown): Settings & { board: string | null; revision?: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('Provide career source settings.');
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => !['company', 'careerUrl', 'keywords', 'locations', 'scanHours', 'enabled', 'revision'].includes(key))) throw invalid('Unsupported career source field.');
  const text = (key: string, max: number) => { const value = input[key]; if (typeof value !== 'string' || !value.trim() || value.length > max) throw invalid(`Invalid ${key}.`); return value.trim(); };
  const tags = (key: string) => { const value = input[key]; if (!Array.isArray(value) || value.length > 30 || value.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 100)) throw invalid(`${key} must contain up to 30 short values.`); return [...new Set((value as string[]).map(tag => tag.trim()))]; };
  const company = text('company', 200), rawUrl = text('careerUrl', 2048);
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw invalid('Provide a valid HTTPS career page URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) throw invalid('Provide a public HTTPS career page URL without credentials.');
  const board = greenhouseBoard(url);
  if (![0, 4, 12, 24].includes(input.scanHours as number) || (!board && input.scanHours !== 0)) throw invalid('Choose manual, 4, 12, or 24 hours. Link-only sources use manual.');
  if (typeof input.enabled !== 'boolean') throw invalid('Provide an enabled boolean.');
  if (input.revision !== undefined && (typeof input.revision !== 'string' || !/^[a-f0-9-]{36}$/.test(input.revision))) throw invalid('Invalid revision.');
  url.hash = '';
  return { company, careerUrl: board ? `https://job-boards.greenhouse.io/${board}` : url.href, board, keywords: tags('keywords'), locations: tags('locations'), scanHours: input.scanHours as number, enabled: input.enabled, ...(input.revision ? { revision: input.revision as string } : {}) };
}
function pagination(query: Record<string, unknown>) {
  const integer = (key: string, fallback: number, max: number) => { const raw = query[key]; if (raw === undefined) return fallback; if (typeof raw !== 'string' || !/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > max) throw invalid(`Invalid ${key}.`); return Number(raw); };
  return { page: integer('page', 1, 1000), limit: integer('limit', 20, 50) };
}
function response(source: Source) {
  const { _id, company, careerUrl, keywords, locations, scanHours, enabled, board, revision, createdAt, updatedAt, status, lastCheckedAt, importedAt, matchingCount, newCount, nextScanAt } = source;
  return { id: _id, company, careerUrl, keywords, locations, scanHours, enabled, provider: board ? 'greenhouse' : null, revision, createdAt, updatedAt, status, lastCheckedAt, importedAt, matchingCount, newCount, nextScanAt: enabled && board && scanHours ? nextScanAt : null };
}
export class CareerSourceStore {
  private sources; private initialized?: Promise<unknown>;
  constructor(db: Db, private jobs: JobStore, private notifications: NotificationService, private adapter: (board: string) => JobSource = board => new GreenhouseSource(board)) { this.sources = db.collection<Source>('career_sources'); }
  initialize() {
    return this.initialized ??= Promise.all([
      this.sources.createIndex({ ownerId: 1, careerUrl: 1 }, { unique: true }),
      this.sources.createIndex({ enabled: 1, nextScanAt: 1 }),
      this.sources.createIndex({ ownerId: 1, createdAt: -1, _id: 1 }),
    ]).catch(error => { this.initialized = undefined; throw error; });
  }
  private duplicate(error: unknown): never { if (error instanceof MongoServerError && error.code === 11000) throw new ApiError(409, 'SOURCE_EXISTS', 'You already saved this career page.'); throw error; }
  async create(owner: string, input: ReturnType<typeof parseSource>) {
    await this.initialize(); const now = new Date();
    const source: Source = { ...input, _id: randomUUID(), ownerId: owner, revision: randomUUID(), createdAt: now, updatedAt: now, status: 'unchecked', lastCheckedAt: null, importedAt: null, matchingCount: 0, newCount: 0, nextScanAt: now, seenIds: [] };
    try { await this.sources.insertOne(source); } catch (error) { this.duplicate(error); }
    return response(source);
  }
  private async owned(owner: string, id: string) { const source = await this.sources.findOne({ _id: id, ownerId: owner }); if (!source) throw new ApiError(404, 'SOURCE_NOT_FOUND', 'Career source not found.'); return source; }
  async update(owner: string, id: string, input: ReturnType<typeof parseSource>) {
    if (!input.revision) throw invalid('Provide the source revision.');
    const current = await this.owned(owner, id); const { revision, ...settings } = input;
    const changedBoard = current.board !== input.board;
    const changedFilters = changedBoard || JSON.stringify(current.keywords) !== JSON.stringify(input.keywords) || JSON.stringify(current.locations) !== JSON.stringify(input.locations);
    let result;
    try { result = await this.sources.findOneAndUpdate({ _id: id, ownerId: owner, revision }, { $set: { ...settings, revision: randomUUID(), updatedAt: new Date(), nextScanAt: new Date(), ...(changedFilters ? { status: 'unchecked' as const, lastCheckedAt: null, matchingCount: 0, newCount: 0 } : {}), ...(changedBoard ? { importedAt: null, seenIds: [] } : {}) }, $unset: { leaseUntil: '', leaseToken: '' } }, { returnDocument: 'after' }); }
    catch (error) { this.duplicate(error); }
    if (!result) throw new ApiError(409, 'SOURCE_CHANGED', 'This source changed. Reload before saving again.');
    return response(result);
  }
  async remove(owner: string, id: string) { await this.sources.deleteOne({ _id: id, ownerId: owner }); }
  async list(owner: string, query: Record<string, unknown>) {
    const { page, limit } = pagination(query); const filter: Filter<Source> = { ownerId: owner };
    if (query.q !== undefined) { if (typeof query.q !== 'string' || query.q.length > 200) throw invalid('Invalid search.'); if (query.q.trim()) filter.$or = [{ company: literal(query.q.trim()) }, { careerUrl: literal(query.q.trim()) }]; }
    if (query.filter !== undefined && !['', 'supported', 'reference', 'paused'].includes(query.filter as string)) throw invalid('Invalid source filter.');
    if (query.filter === 'supported') filter.board = { $ne: null };
    if (query.filter === 'reference') filter.board = null;
    if (query.filter === 'paused') filter.enabled = false;
    const [total, rows] = await Promise.all([this.sources.countDocuments(filter), this.sources.find(filter).sort({ createdAt: -1, _id: 1 }).skip((page - 1) * limit).limit(limit).toArray()]);
    return { sources: rows.map(response), total, page, limit };
  }
  private matches(source: Source): Filter<Job> {
    const filter: Filter<Job> = { source: `greenhouse:${source.board}`, $and: [{ $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }] };
    if (source.keywords.length) filter.$and!.push({ $or: source.keywords.flatMap(value => ['title', 'description', 'skills'].map(key => ({ [key]: literal(value) }))) });
    if (source.locations.length) filter.$and!.push({ $or: source.locations.map(value => ({ location: literal(value) })) });
    return filter;
  }
  async matchingJobs(owner: string, id: string, query: Record<string, unknown>) {
    const source = await this.owned(owner, id), { page, limit } = pagination(query);
    if (!source.board) throw invalid('This career page is saved as a link. Automatic job reading is not supported yet.');
    const filter = this.matches(source);
    const [total, rows] = await Promise.all([this.jobs.jobs.countDocuments(filter), this.jobs.jobs.find(filter).sort({ updatedAt: -1, _id: 1 }).skip((page - 1) * limit).limit(limit).toArray()]);
    return { source: response(source), jobs: rows.map(publicJob), total, page, limit };
  }
  private async deliver(source: Source) {
    if (!source.pendingNotice) return;
    await this.notifications.publish(source.ownerId, source.pendingNotice);
    await this.sources.updateOne({ _id: source._id, 'pendingNotice.key': source.pendingNotice.key }, { $unset: { pendingNotice: '' } });
  }
  async refresh(owner: string, id: string) {
    const current = await this.owned(owner, id);
    if (!current.enabled) throw invalid('Resume this source before checking it.');
    if (!current.board) throw invalid('This career page is saved as a link. Automatic job reading is not supported yet.');
    await this.deliver(current);
    const now = new Date(), token = randomUUID();
    const source = await this.sources.findOneAndUpdate({ _id: id, ownerId: owner, revision: current.revision, $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }] }, { $set: { leaseUntil: new Date(now.getTime() + 60_000), leaseToken: token } }, { returnDocument: 'after' });
    if (!source) throw new ApiError(409, 'SOURCE_BUSY', 'This source is being checked or was changed. Try again shortly.');
    const adapter = this.adapter(current.board); let importedAt: Date | null = null;
    let failure: unknown;
    try {
      try { await this.jobs.initialize(); await this.jobs.ingest(adapter); }
      catch (error) {
        if (!(error instanceof ApiError && error.status === 409)) throw error;
        const latest = await this.jobs.refreshState(adapter.id);
        if (latest?.status === 'failed') throw new ApiError(502, 'INGESTION_FAILED', 'The last provider import failed.');
        if (latest?.status !== 'success') throw error;
      }
      const latest = await this.jobs.refreshState(adapter.id);
      importedAt = latest?.status === 'success' ? latest.finishedAt : null;
      if (!importedAt) throw new ApiError(409, 'SOURCE_BUSY', 'The provider is still being checked. Try again shortly.');
    } catch (error) { failure = error; }
    // A concurrent provider import is not a source failure; retry it on the next scheduler tick.
    if (failure instanceof ApiError && failure.status === 409) { await this.sources.updateOne({ _id: id, leaseToken: token }, { $unset: { leaseUntil: '', leaseToken: '' } }); throw failure; }
    const matches = failure ? [] : await this.jobs.jobs.find(this.matches(source), { projection: { _id: 1 } }).limit(10_000).toArray();
    const ids = matches.map(job => job._id), seen = new Set(source.seenIds), newCount = ids.filter(job => !seen.has(job)).length;
    const notice: Notice | undefined = failure ? (source.status !== 'failed' ? { key: token, type: 'SOURCE_ERROR', title: `Could not check ${source.company}`, message: `The career board could not be refreshed. Existing jobs are kept. ${source.scanHours ? 'Scheduled checks will retry while CareerOS is running.' : 'Check this source again later.'}`, href: '/career-sources' } : undefined) : newCount ? { key: token, type: 'NEW_JOBS', title: `${newCount} matching ${newCount === 1 ? 'job' : 'jobs'} at ${source.company}`, message: 'New listings match your saved keywords and locations. The first check includes existing matches.', href: `/career-sources/${id}/jobs` } : undefined;
    const finished = await this.sources.findOneAndUpdate({ _id: id, revision: source.revision, leaseToken: token }, { $set: {
      status: failure ? 'failed' : 'success', lastCheckedAt: new Date(), nextScanAt: new Date(Date.now() + (failure ? 1 : source.scanHours || 1) * 3_600_000),
      ...(!failure ? { importedAt, matchingCount: ids.length, newCount, seenIds: ids } : { newCount: 0 }), ...(notice ? { pendingNotice: notice } : {}),
    }, $unset: { leaseUntil: '', leaseToken: '' } }, { returnDocument: 'after' });
    if (!finished) throw new ApiError(409, 'SOURCE_CHANGED', 'The settings changed during the check. Check the updated source again.');
    // Delivery failures leave the notice persisted for retry, without losing a successful refresh.
    try { await this.deliver(finished); } catch { console.error(JSON.stringify({ event: 'notification_delivery_failed', source: id })); }
    return { source: response(finished), cached: Boolean(importedAt && importedAt.getTime() < now.getTime()), failed: Boolean(failure) };
  }
  async refreshDue() {
    await this.initialize();
    const pending = await this.sources.find({ pendingNotice: { $exists: true } }).limit(25).toArray();
    for (const source of pending) { try { await this.deliver(source); } catch { console.error(JSON.stringify({ event: 'notification_delivery_failed', source: source._id })); } }
    const due = await this.sources.find({ enabled: true, board: { $ne: null }, scanHours: { $gt: 0 }, nextScanAt: { $lte: new Date() } }).sort({ nextScanAt: 1 }).limit(25).toArray();
    for (const source of due) { try { await this.refresh(source.ownerId, source._id); } catch (error) { if (!(error instanceof ApiError && [404, 409].includes(error.status))) console.error(JSON.stringify({ event: 'career_source_refresh_failed', source: source._id })); } }
  }
}
