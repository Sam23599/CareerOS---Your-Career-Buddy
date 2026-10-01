import { createHash } from 'node:crypto';
import { type Db } from 'mongodb';
import { ApiError } from '../errors.js';

export type Notice = { key: string; type: 'NEW_JOBS' | 'SOURCE_ERROR'; title: string; message: string; href: string };
export type Preferences = { newJobs: boolean; sourceErrors: boolean };
type Notification = Notice & { _id: string; ownerId: string; createdAt: Date; readAt: Date | null };
export interface NotificationProvider { deliver(owner: string, notice: Notice): Promise<void> }
export function parsePreferences(body: unknown): Partial<Preferences> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'INVALID_PREFERENCES', 'Provide notification preferences.');
  const input = body as Record<string, unknown>;
  if (!Object.keys(input).length || Object.keys(input).some(key => !['newJobs', 'sourceErrors'].includes(key) || typeof input[key] !== 'boolean')) throw new ApiError(400, 'INVALID_PREFERENCES', 'Preferences must be newJobs/sourceErrors booleans.');
  return input;
}
function number(value: unknown, fallback: number, max: number) { if (value === undefined) return fallback; if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) throw new ApiError(400, 'INVALID_FILTER', 'Invalid pagination.'); return Number(value); }
export class NotificationStore implements NotificationProvider {
  private records; private settings; private initialized?: Promise<unknown>;
  constructor(db: Db) { this.records = db.collection<Notification>('notifications'); this.settings = db.collection<Preferences & { _id: string }>('notification_preferences'); }
  initialize() { return this.initialized ??= this.records.createIndex({ ownerId: 1, createdAt: -1, _id: 1 }).catch(error => { this.initialized = undefined; throw error; }); }
  async preferences(owner: string): Promise<Preferences> { const settings = await this.settings.findOne({ _id: owner }); return { newJobs: settings?.newJobs ?? true, sourceErrors: settings?.sourceErrors ?? true }; }
  async updatePreferences(owner: string, changes: Partial<Preferences>) { await this.settings.updateOne({ _id: owner }, { $set: changes }, { upsert: true }); return this.preferences(owner); }
  async deliver(owner: string, notice: Notice) {
    const id = createHash('sha256').update(`${owner}\0${notice.key}`).digest('hex');
    await this.records.updateOne({ _id: id }, { $setOnInsert: { ...notice, ownerId: owner, createdAt: new Date(), readAt: null } }, { upsert: true });
  }
  async list(owner: string, query: Record<string, unknown>) {
    const page = number(query.page, 1, 1000), limit = number(query.limit, 20, 50);
    if (query.unread !== undefined && !['true', 'false'].includes(query.unread as string)) throw new ApiError(400, 'INVALID_FILTER', 'Invalid unread filter.');
    const filter = { ownerId: owner, ...(query.unread === 'true' ? { readAt: null } : {}) };
    const [total, unreadCount, rows] = await Promise.all([this.records.countDocuments(filter), this.records.countDocuments({ ownerId: owner, readAt: null }), this.records.find(filter).sort({ createdAt: -1, _id: 1 }).skip((page - 1) * limit).limit(limit).toArray()]);
    return { notifications: rows.map(row => ({ id: row._id, type: row.type, title: row.title, message: row.message, href: row.href, createdAt: row.createdAt, read: Boolean(row.readAt) })), total, unreadCount, page, limit };
  }
  async read(owner: string, id: string, read: boolean) {
    const result = await this.records.updateOne({ _id: id, ownerId: owner }, { $set: { readAt: read ? new Date() : null } });
    if (!result.matchedCount) throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found.');
  }
  async readAll(owner: string) { await this.records.updateMany({ ownerId: owner, readAt: null }, { $set: { readAt: new Date() } }); }
}
export class NotificationService {
  constructor(private store: NotificationStore, private provider: NotificationProvider = store) {}
  async publish(owner: string, notice: Notice) {
    const preferences = await this.store.preferences(owner);
    if (notice.type === 'NEW_JOBS' ? preferences.newJobs : preferences.sourceErrors) await this.provider.deliver(owner, notice);
  }
}
