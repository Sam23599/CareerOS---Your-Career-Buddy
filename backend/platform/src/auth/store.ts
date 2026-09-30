import { type Db } from 'mongodb';
import { type ProviderId } from './oauth-providers.js';

export type Role = 'USER' | 'ADMIN';
export type User = {
  _id: string; email: string; name: string; passwordHash?: string; oauth?: { provider: ProviderId; subject: string }; roles: Role[]; createdAt: Date;
};
export type Session = {
  _id: string; userId: string; refreshHash: string; createdAt: Date; expiresAt: Date; revokedAt?: Date;
};
export type OAuthState = {
  _id: string; provider: ProviderId; bindingHash: string; verifier: string; nonce: string; expiresAt: Date;
};
export function publicUser(user: User) {
  return { id: user._id, email: user.email, name: user.name, roles: user.roles };
}

export class AuthStore {
  readonly users;
  readonly sessions;
  readonly oauthAttempts;
  constructor(db: Db) {
    this.users = db.collection<User>('users');
    this.sessions = db.collection<Session>('auth_sessions');
    this.oauthAttempts = db.collection<OAuthState>('oauth_attempts');
  }
  private initialization?: Promise<void>;
  initialize() {
    this.initialization ??= this.createIndexes().catch(error => {
      this.initialization = undefined;
      throw error;
    });
    return this.initialization;
  }
  private async createIndexes() {
    await this.users.createIndex({ email: 1 }, { unique: true });
    await this.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await this.sessions.createIndex({ userId: 1 });
    await this.users.createIndex({ 'oauth.provider': 1, 'oauth.subject': 1 }, { unique: true, partialFilterExpression: { oauth: { $exists: true } } });
    await this.oauthAttempts.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  }
  async activeSession(id: string) {
    return this.sessions.findOne({ _id: id, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } });
  }
  async revoke(id: string) {
    await this.sessions.updateOne({ _id: id }, { $set: { revokedAt: new Date() } });
  }
  async rotate(id: string, oldHash: string, newHash: string) {
    const result = await this.sessions.updateOne({
      _id: id, refreshHash: oldHash, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() },
    }, { $set: { refreshHash: newHash } });
    return result.modifiedCount === 1;
  }
}
