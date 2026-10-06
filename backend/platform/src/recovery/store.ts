import { randomUUID } from 'node:crypto';
import { type Db, type Document, MongoServerError } from 'mongodb';
import { ApiError } from '../errors.js';

export type Trash = { deletedAt: Date; expiresAt: Date };
const collections = { 'saved-job': 'saved_jobs', 'career-source': 'career_sources' } as const;
export class RecoveryStore {
  constructor(private db: Db) {}
  async settings(owner: string) {
    const saved = await this.db.collection<{ _id: string; binDays: number }>('workspace_preferences').findOne({ _id: owner });
    return { binDays: saved?.binDays ?? 30 };
  }
  async configure(owner: string, input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'binDays')) throw new ApiError(400, 'INVALID_SETTINGS', 'Provide binDays only.');
    const binDays = (input as Record<string, unknown>).binDays;
    if (typeof binDays !== 'number' || !Number.isInteger(binDays) || binDays < 1 || binDays > 365) throw new ApiError(400, 'INVALID_SETTINGS', 'Choose 1–365 days.');
    await this.db.collection<{ _id: string; binDays: number }>('workspace_preferences').updateOne({ _id: owner }, { $set: { binDays } }, { upsert: true });
    return { binDays };
  }
  async marker(owner: string): Promise<Trash> {
    const { binDays } = await this.settings(owner), deletedAt = new Date();
    return { deletedAt, expiresAt: new Date(deletedAt.getTime() + binDays * 86_400_000) };
  }
  async list(owner: string, support = false, actor?: string) {
    if (support && actor) await this.db.collection('support_recovery_audit').insertOne({ actor, owner, action: 'list_retained_items', at: new Date() });
    const items: { kind: string; id: string; title: string; trash: Trash; archived: boolean }[] = [], now = new Date();
    const visible = support ? { $exists: true } : { $gt: now };
    for (const [kind, name] of Object.entries(collections)) {
      const rows = await this.db.collection<Document & { _id: string }>(name).find({ ownerId: owner, 'trash.expiresAt': visible }).limit(100).toArray();
      for (const row of rows) items.push({ kind, id: row._id, title: row.company ?? row.snapshot?.title ?? 'Saved item', trash: row.trash, archived: row.trash.expiresAt <= now });
    }
    const library = await this.db.collection<Document & { _id: string }>('resume_libraries').findOne({ _id: owner });
    for (const row of library?.items ?? []) if (row.trash && (support || row.trash.expiresAt > now)) items.push({ kind: 'resume', id: row.id, title: row.name, trash: row.trash, archived: row.trash.expiresAt <= now });
    return { items: items.sort((a, b) => b.trash.deletedAt.getTime() - a.trash.deletedAt.getTime()), ...await this.settings(owner) };
  }
  async restore(actor: string, owner: string, kind: string, id: string, support = false) {
    const rule = support ? { $exists: true } : { $gt: new Date() };
    if (!['resume', ...Object.keys(collections)].includes(kind)) throw new ApiError(400, 'INVALID_RESOURCE', 'Invalid resource type.');
    if (support) await this.db.collection('support_recovery_audit').insertOne({ actor, owner, kind, resourceId: id, action: 'restore_requested', at: new Date() });
    let changed;
    if (kind === 'resume') {
      changed = await this.db.collection<Document & { _id: string }>('resume_libraries').updateOne({ _id: owner, items: { $elemMatch: { id, 'trash.expiresAt': rule } } }, { $unset: { 'items.$.trash': '' } });
    } else {
      const name = collections[kind as keyof typeof collections];
      try { changed = await this.db.collection<Document & { _id: string }>(name).updateOne({ ownerId: owner, _id: id, 'trash.expiresAt': rule }, { $unset: { trash: '' }, $set: { revision: randomUUID(), updatedAt: new Date() } }); } catch (error) { if (error instanceof MongoServerError && error.code === 11000) throw new ApiError(409, 'RECOVERY_CONFLICT', 'A current saved item already exists. Move it to the bin before restoring this version.'); throw error; }
    }
    if (!changed.modifiedCount) throw new ApiError(404, 'RECOVERY_NOT_FOUND', 'Item is not available for restoration.');
    return { status: 'restored' };
  }
}
