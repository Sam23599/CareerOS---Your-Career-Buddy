import { randomUUID } from 'node:crypto';
import { type Db, type Filter, MongoServerError } from 'mongodb';
import { ApiError } from '../errors.js';
import { type Job, type JobSource, publicJob } from '../jobs/model.js';
import { type JobStore } from '../jobs/store.js';
import { type Notice, type NotificationService } from '../notifications/store.js';
import { careerUrl, createSource, detectSource, registryVersion, type SourceDefinition } from './registry.js';

type Settings = { kind: 'bookmark' | 'job-source'; company: string; careerUrl: string; keywords: string[]; locations: string[]; scanHours: number; enabled: boolean };
type Source = Settings & {
  _id: string; ownerId: string; connection: SourceDefinition | null; registryVersion: number; board?: string | null; revision: string; createdAt: Date; updatedAt: Date;
  status: 'unchecked' | 'success' | 'failed'; lastCheckedAt: Date | null; importedAt: Date | null;
  matchingCount: number; newCount: number; nextScanAt: Date; seenIds: string[];
  leaseUntil?: Date; leaseToken?: string; pendingNotice?: Notice;
};
const invalid = (message: string) => new ApiError(400, 'INVALID_CAREER_SOURCE', message);
const literal = (value: string) => ({ $regex: value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' });
export type SourceFilters = Pick<Settings, 'keywords' | 'locations'>;
function filterTags(value: unknown, key: string) {
  if (!Array.isArray(value) || value.length > 30 || value.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 100)) throw invalid(`${key} must contain up to 30 short values.`);
  return [...new Set((value as string[]).map(tag => tag.trim()))];
}
export function parseCheckFilters(body: unknown): Partial<SourceFilters> | undefined {
  if (body === undefined) return undefined;
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'filters')) throw invalid('Provide optional keywords and locations in filters.');
  const value = (body as Record<string, unknown>).filters;
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['keywords', 'locations'].includes(key))) throw invalid('Only keyword and location filters are supported.');
  const filters: Partial<SourceFilters> = {};
  for (const key of ['keywords', 'locations'] as const) if (Object.hasOwn(value, key)) filters[key] = filterTags((value as Record<string, unknown>)[key], key);
  return Object.keys(filters).length ? filters : undefined;
}
function queryFilters(query: Record<string, unknown>) {
  const filters: Record<string, unknown> = {};
  for (const key of ['keywords', 'locations']) if (query[key] !== undefined) {
    const raw = query[key]; if (typeof raw !== 'string' || raw.length > 10_000) throw invalid(`Invalid ${key} filter.`);
    try { filters[key] = JSON.parse(raw); } catch { throw invalid(`Provide ${key} as a JSON array.`); }
  }
  return parseCheckFilters({ filters });
}
export function parseSource(body: unknown): Settings & { connection: SourceDefinition | null; revision?: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('Provide career source settings.');
  const input = body as Record<string, unknown>;
  if (input.kind !== 'bookmark' && input.kind !== 'job-source') throw invalid('Choose a job source or career bookmark.');
  const fields = ['kind', 'company', 'careerUrl', 'revision', ...(input.kind === 'job-source' ? ['keywords', 'locations', 'scanHours', 'enabled'] : [])];
  if (Object.keys(input).some(key => !fields.includes(key))) throw invalid('Unsupported career source field.');
  const text = (key: string, max: number) => { const value = input[key]; if (typeof value !== 'string' || !value.trim() || value.length > max) throw invalid(`Invalid ${key}.`); return value.trim(); };
  const tags = (key: string) => filterTags(input[key], key);
  const company = text('company', 200), url = careerUrl(input.careerUrl), connection = detectSource(url);
  if (input.revision !== undefined && (typeof input.revision !== 'string' || !/^[a-f0-9-]{36}$/.test(input.revision))) throw invalid('Invalid revision.');
  const revision = input.revision ? { revision: input.revision as string } : {};
  if (input.kind === 'bookmark') return { kind: 'bookmark', company, careerUrl: url.href, connection, keywords: [], locations: [], scanHours: 0, enabled: false, ...revision };
  if (!connection) throw invalid('Job tracking is not supported for this page. Save it as a career bookmark.');
  if (![0, 4, 12, 24].includes(input.scanHours as number)) throw invalid('Choose manual, 4, 12, or 24 hours.');
  if (typeof input.enabled !== 'boolean') throw invalid('Provide an enabled boolean.');
  return { kind: 'job-source', company, careerUrl: connection.careerUrl, connection, keywords: tags('keywords'), locations: tags('locations'), scanHours: input.scanHours as number, enabled: input.enabled, ...revision };
}
function pagination(query: Record<string, unknown>) {
  const integer = (key: string, fallback: number, max: number) => { const raw = query[key]; if (raw === undefined) return fallback; if (typeof raw !== 'string' || !/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > max) throw invalid(`Invalid ${key}.`); return Number(raw); };
  return { page: integer('page', 1, 1000), limit: integer('limit', 20, 50) };
}
function response(source: Source) {
  const { _id, kind, company, careerUrl, keywords, locations, scanHours, enabled, connection, revision, createdAt, updatedAt, status, lastCheckedAt, importedAt, matchingCount, newCount, nextScanAt } = source;
  const canRefresh = kind === 'job-source' && Boolean(connection);
  return { id: _id, kind, company, careerUrl, keywords, locations, scanHours, enabled, provider: connection?.provider ?? null, providerName: connection?.name ?? null, sourceId: connection?.sourceId ?? null, coverage: connection?.coverage ?? 'link', canRefresh, canEnableTracking: kind === 'bookmark' && Boolean(connection), revision, createdAt, updatedAt, status, lastCheckedAt, importedAt, matchingCount, newCount, nextScanAt: enabled && canRefresh && scanHours ? nextScanAt : null };
}
export class CareerSourceStore {
  private sources; private initialized?: Promise<unknown>;
  constructor(db: Db, private jobs: JobStore, private notifications: NotificationService, private adapter: (source: SourceDefinition) => JobSource = createSource) { this.sources = db.collection<Source>('career_sources'); }
  initialize() {
    return this.initialized ??= Promise.all([
      this.sources.createIndex({ ownerId: 1, careerUrl: 1 }, { unique: true }),
      this.sources.createIndex({ enabled: 1, nextScanAt: 1 }),
      this.sources.createIndex({ ownerId: 1, createdAt: -1, _id: 1 }),
      this.sources.createIndex({ ownerId: 1, 'connection.sourceId': 1 }),
      this.sources.createIndex({ ownerId: 1, kind: 1, createdAt: -1, _id: 1 }),
    ]).then(() => this.upgradeLinks()).catch(error => { this.initialized = undefined; throw error; });
  }
  private async upgradeLinks() {
    // Keep original URLs to avoid collisions between old aliases; never recreate user records.
    const outdated: Filter<Source> = { $or: [{ kind: { $exists: false } }, { registryVersion: { $ne: registryVersion } }] };
    for await (const source of this.sources.find(outdated)) {
      let connection: SourceDefinition | null = null;
      try { connection = detectSource(careerUrl(source.careerUrl)); } catch { /* Invalid legacy links remain references. */ }
      const previousId = source.connection?.sourceId ?? (source.board ? `greenhouse:${source.board}` : null);
      // Backfill from prior capability; discovering an adapter never activates a bookmark.
      const kind = source.kind ?? (previousId ? 'job-source' : 'bookmark');
      const changed = previousId !== (connection?.sourceId ?? null);
      await this.sources.updateOne({ _id: source._id, revision: source.revision, ...outdated }, {
        $set: { kind, connection, registryVersion, ...(kind === 'bookmark' ? { scanHours: 0, enabled: false } : !connection ? { scanHours: 0 } : {}), ...(changed ? { revision: randomUUID(), updatedAt: new Date(), status: 'unchecked', lastCheckedAt: null, importedAt: null, matchingCount: 0, newCount: 0, seenIds: [], nextScanAt: new Date() } : {}) },
        ...(changed || kind === 'bookmark' ? { $unset: { leaseUntil: '', leaseToken: '', ...(kind === 'bookmark' ? { pendingNotice: '' } : {}) } } : {}),
      });
    }
  }
  private async uniqueConnection(owner: string, connection: SourceDefinition | null, id?: string) {
    if (connection && await this.sources.findOne({ ownerId: owner, kind: 'job-source', 'connection.sourceId': connection.sourceId, ...(id ? { _id: { $ne: id } } : {}) })) throw new ApiError(409, 'SOURCE_EXISTS', 'You already saved this career page.');
  }
  private duplicate(error: unknown): never { if (error instanceof MongoServerError && error.code === 11000) throw new ApiError(409, 'SOURCE_EXISTS', 'You already saved this career page.'); throw error; }
  async create(owner: string, input: ReturnType<typeof parseSource>) {
    await this.initialize(); const now = new Date();
    if (input.kind === 'job-source') await this.uniqueConnection(owner, input.connection);
    const source: Source = { ...input, registryVersion, _id: randomUUID(), ownerId: owner, revision: randomUUID(), createdAt: now, updatedAt: now, status: 'unchecked', lastCheckedAt: null, importedAt: null, matchingCount: 0, newCount: 0, nextScanAt: now, seenIds: [] };
    try { await this.sources.insertOne(source); } catch (error) { this.duplicate(error); }
    return response(source);
  }
  private async owned(owner: string, id: string) { await this.initialize(); const source = await this.sources.findOne({ _id: id, ownerId: owner }); if (!source) throw new ApiError(404, 'SOURCE_NOT_FOUND', 'Career source not found.'); return source; }
  async update(owner: string, id: string, input: ReturnType<typeof parseSource>) {
    if (!input.revision) throw invalid('Provide the source revision.');
    const current = await this.owned(owner, id); const { revision, ...settings } = input;
    const changedKind = current.kind !== input.kind;
    const changedProvider = current.connection?.sourceId !== input.connection?.sourceId;
    if (input.kind === 'job-source' && (changedProvider || changedKind)) await this.uniqueConnection(owner, input.connection, id);
    // Legacy aliases can coexist. Settings edits keep their URLs instead of colliding with another alias.
    if (input.kind === 'job-source' && !changedProvider && input.connection) settings.careerUrl = current.careerUrl;
    // Keep legacy filters available for a later explicit tracking setup.
    if (input.kind === 'bookmark') { settings.keywords = current.keywords; settings.locations = current.locations; }
    const changedFilters = changedKind || changedProvider || JSON.stringify(current.keywords) !== JSON.stringify(settings.keywords) || JSON.stringify(current.locations) !== JSON.stringify(settings.locations);
    let result;
    try { result = await this.sources.findOneAndUpdate({ _id: id, ownerId: owner, revision }, { $set: { ...settings, registryVersion, revision: randomUUID(), updatedAt: new Date(), nextScanAt: new Date(), ...(changedFilters ? { status: 'unchecked' as const, lastCheckedAt: null, matchingCount: 0, newCount: 0 } : {}), ...(changedProvider || changedKind ? { importedAt: null, seenIds: [] } : {}) }, $unset: { leaseUntil: '', leaseToken: '', ...(changedProvider || changedKind || input.kind === 'bookmark' ? { pendingNotice: '' } : {}) } }, { returnDocument: 'after' }); }
    catch (error) { this.duplicate(error); }
    if (!result) throw new ApiError(409, 'SOURCE_CHANGED', 'This source changed. Reload before saving again.');
    return response(result);
  }
  async remove(owner: string, id: string) { await this.initialize(); await this.sources.deleteOne({ _id: id, ownerId: owner }); }
  async list(owner: string, query: Record<string, unknown>) {
    await this.initialize();
    const { page, limit } = pagination(query); const filter: Filter<Source> = { ownerId: owner };
    if (query.kind !== undefined) { if (!['bookmark', 'job-source'].includes(query.kind as string)) throw invalid('Invalid source kind.'); filter.kind = query.kind as Settings['kind']; }
    if (query.q !== undefined) { if (typeof query.q !== 'string' || query.q.length > 200) throw invalid('Invalid search.'); if (query.q.trim()) filter.$or = [{ company: literal(query.q.trim()) }, { careerUrl: literal(query.q.trim()) }]; }
    if (query.filter !== undefined && !['', 'supported', 'reference', 'paused'].includes(query.filter as string)) throw invalid('Invalid source filter.');
    if (query.filter === 'supported') { filter.connection = { $ne: null }; filter.$and = [{ kind: 'job-source' }]; }
    if (query.filter === 'reference') filter.$and = [{ kind: 'bookmark' }];
    if (query.filter === 'paused') { filter.enabled = false; filter.$and = [{ kind: 'job-source' }]; }
    const [total, rows] = await Promise.all([this.sources.countDocuments(filter), this.sources.find(filter).sort({ createdAt: -1, _id: 1 }).skip((page - 1) * limit).limit(limit).toArray()]);
    return { sources: rows.map(response), total, page, limit };
  }
  private matches(source: Source, filters: SourceFilters = source): Filter<Job> {
    const filter: Filter<Job> = { source: source.connection!.sourceId, $and: [{ $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }] };
    if (filters.keywords.length) filter.$and!.push({ $or: filters.keywords.flatMap(value => ['title', 'description', 'skills'].map(key => ({ [key]: literal(value) }))) });
    if (filters.locations.length) filter.$and!.push({ $or: filters.locations.map(value => ({ location: literal(value) })) });
    return filter;
  }
  async matchingJobs(owner: string, id: string, query: Record<string, unknown>) {
    const source = await this.owned(owner, id), { page, limit } = pagination(query);
    if (source.kind !== 'job-source' || !source.connection) throw invalid('Enable job tracking on a supported career page before viewing matching jobs.');
    const overrides = queryFilters(query), filters = { keywords: source.keywords, locations: source.locations, ...overrides };
    const filter = this.matches(source, filters);
    const [total, rows] = await Promise.all([this.jobs.jobs.countDocuments(filter), this.jobs.jobs.find(filter).sort({ updatedAt: -1, _id: 1 }).skip((page - 1) * limit).limit(limit).toArray()]);
    return { source: response(source), filters, temporary: Boolean(overrides), jobs: rows.map(publicJob), total, page, limit };
  }
  private async deliver(source: Source) {
    if (source.kind !== 'job-source' || !source.pendingNotice) return;
    await this.notifications.publish(source.ownerId, source.pendingNotice);
    await this.sources.updateOne({ _id: source._id, 'pendingNotice.key': source.pendingNotice.key }, { $unset: { pendingNotice: '' } });
  }
  async refresh(owner: string, id: string, overrides?: Partial<SourceFilters>) {
    const current = await this.owned(owner, id);
    if (current.kind !== 'job-source') throw invalid('Career bookmarks do not check jobs. Enable job tracking first.');
    if (!current.enabled) throw invalid('Resume this source before checking it.');
    if (!current.connection) throw invalid('This career page is saved as a link. Automatic job reading is not supported yet.');
    if (!overrides) await this.deliver(current);
    const now = new Date(), token = randomUUID();
    const source = await this.sources.findOneAndUpdate({ _id: id, ownerId: owner, revision: current.revision, $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }] }, { $set: { leaseUntil: new Date(now.getTime() + 60_000), leaseToken: token } }, { returnDocument: 'after' });
    if (!source) throw new ApiError(409, 'SOURCE_BUSY', 'This source is being checked or was changed. Try again shortly.');
    const adapter = this.adapter(current.connection); let importedAt: Date | null = null;
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
    if (overrides) {
      // A one-time check shares the provider import, without changing watch history or alerts.
      const filters = { keywords: source.keywords, locations: source.locations, ...overrides };
      try {
        const matchingCount = failure ? null : await this.jobs.jobs.countDocuments(this.matches(source, filters));
        const unchanged = await this.sources.findOne({ _id: id, ownerId: owner, revision: source.revision, leaseToken: token });
        if (!unchanged) throw new ApiError(409, 'SOURCE_CHANGED', 'The settings changed during the check. Check the updated source again.');
        return { source: response(unchanged), cached: Boolean(importedAt && importedAt.getTime() < now.getTime()), failed: Boolean(failure), temporary: true, filters, matchingCount };
      } finally { await this.sources.updateOne({ _id: id, leaseToken: token }, { $unset: { leaseUntil: '', leaseToken: '' } }); }
    }
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
    return { source: response(finished), cached: Boolean(importedAt && importedAt.getTime() < now.getTime()), failed: Boolean(failure), temporary: false, filters: { keywords: source.keywords, locations: source.locations }, matchingCount: failure ? null : ids.length };
  }
  async refreshDue() {
    await this.initialize();
    const pending = await this.sources.find({ kind: 'job-source', pendingNotice: { $exists: true } }).limit(25).toArray();
    for (const source of pending) { try { await this.deliver(source); } catch { console.error(JSON.stringify({ event: 'notification_delivery_failed', source: source._id })); } }
    const due = await this.sources.find({ kind: 'job-source', enabled: true, connection: { $ne: null }, scanHours: { $gt: 0 }, nextScanAt: { $lte: new Date() } }).sort({ nextScanAt: 1 }).limit(25).toArray();
    for (const source of due) { try { await this.refresh(source.ownerId, source._id); } catch (error) { if (!(error instanceof ApiError && [404, 409].includes(error.status))) console.error(JSON.stringify({ event: 'career_source_refresh_failed', source: source._id })); } }
  }
}
