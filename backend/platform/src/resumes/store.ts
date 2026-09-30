import { randomUUID } from 'node:crypto';
import { type Db } from 'mongodb';
import { ApiError } from '../errors.js';
import { type ResumeStorage } from './storage.js';

type Resume = { id: string; name: string; size: number; version: number; uploadedAt: Date; deleting?: boolean };
type Library = { _id: string; nextVersion: number; activeId?: string | null; items?: Resume[] };
export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const missing = () => new ApiError(404, 'RESUME_NOT_FOUND', 'Resume not found.');
export class ResumeStore {
  private libraries;
  constructor(db: Db, private storage: ResumeStorage) { this.libraries = db.collection<Library>('resume_libraries'); }
  async list(owner: string) {
    const library = await this.libraries.findOne({ _id: owner });
    return { resumes: (library?.items ?? []).map(item => ({ ...item, active: !item.deleting && item.id === library?.activeId })).sort((a, b) => b.version - a.version) };
  }
  async upload(owner: string, name: string, data: Buffer) {
    if (!name || name.length > 200 || ([...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || /[/\\]/.test(name)) || !/\.pdf$/i.test(name)) throw new ApiError(400, 'INVALID_RESUME', 'Choose a PDF filename of at most 200 characters without path separators.');
    if (!Buffer.isBuffer(data) || data.length === 0 || data.length > MAX_RESUME_BYTES) throw new ApiError(400, 'INVALID_RESUME', 'Choose a PDF file up to 5 MB.');
    if (!data.subarray(0, 5).equals(Buffer.from('%PDF-')) || !data.subarray(-1024).includes(Buffer.from('%%EOF'))) throw new ApiError(400, 'INVALID_RESUME', 'The file does not have a valid PDF header and end marker.');
    const counter = await this.libraries.findOneAndUpdate({ _id: owner }, { $inc: { nextVersion: 1 } }, { upsert: true, returnDocument: 'after' });
    const item: Resume = { id: randomUUID(), name, size: data.length, version: counter!.nextVersion, uploadedAt: new Date() };
    await this.storage.put(item.id, data);
    // Keep the file if a database response is lost: deleting it here could break a committed upload.
    await this.libraries.updateOne({ _id: owner }, [{ $set: {
      items: { $concatArrays: [{ $ifNull: ['$items', []] }, { $literal: [item] }] },
      activeId: { $ifNull: ['$activeId', item.id] },
    } }]);
    return this.list(owner);
  }
  async activate(owner: string, id: string) {
    const result = await this.libraries.updateOne({ _id: owner, items: { $elemMatch: { id, deleting: { $ne: true } } } }, { $set: { activeId: id } });
    if (!result.matchedCount) throw missing();
    return this.list(owner);
  }
  async download(owner: string, id: string) {
    const library = await this.libraries.findOne({ _id: owner });
    const item = library?.items?.find(item => item.id === id && !item.deleting);
    if (!item) throw missing();
    try { return { item, data: await this.storage.get(item.id) }; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw missing();
      throw error;
    }
  }
  async remove(owner: string, id: string) {
    const result = await this.libraries.updateOne({ _id: owner, 'items.id': id }, { $set: { 'items.$.deleting': true } });
    if (!result.matchedCount) throw missing();
    await this.storage.remove(id);
    await this.libraries.updateOne({ _id: owner }, [{ $set: {
      items: { $filter: { input: '$items', as: 'item', cond: { $ne: ['$$item.id', id] } } },
      activeId: { $cond: [{ $eq: ['$activeId', id] }, null, '$activeId'] },
    } }]);
    return this.list(owner);
  }
}
