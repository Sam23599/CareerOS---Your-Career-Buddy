import { type Db, MongoServerError } from 'mongodb';
import { ApiError } from '../errors.js';
import { emptyProfile, profileResponse, type ProfileData, type ProfileDocument } from './model.js';

export class ProfileStore {
  readonly profiles;
  constructor(db: Db) { this.profiles = db.collection<ProfileDocument>('profiles'); }
  async get(user: { id: string; name: string }) {
    const saved = await this.profiles.findOne({ _id: user.id });
    return saved ? profileResponse(saved) : { ...emptyProfile(user.name), version: 0, updatedAt: null };
  }
  async update(user: { id: string; name: string }, version: number, changes: Partial<ProfileData>) {
    const conflict = () => new ApiError(409, 'PROFILE_CONFLICT', 'Your profile changed in another tab. Reload the latest version before saving again.');
    const now = new Date();
    if (version === 0) {
      const document: ProfileDocument = { ...emptyProfile(user.name), ...changes, _id: user.id, version: 1, createdAt: now, updatedAt: now };
      try { await this.profiles.insertOne(document); }
      catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) throw conflict();
        throw error;
      }
      return profileResponse(document);
    }
    const document = await this.profiles.findOneAndUpdate({ _id: user.id, version }, {
      $set: { ...changes, updatedAt: now }, $inc: { version: 1 },
    }, { returnDocument: 'after' });
    if (!document) throw conflict();
    return profileResponse(document);
  }
}
