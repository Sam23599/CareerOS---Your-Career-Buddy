import { randomUUID } from 'node:crypto';
import { MongoServerError } from 'mongodb';
import { ApiError } from '../errors.js';
import { dummyPasswordHash, hashPassword, verifyPassword } from './password.js';
import { AuthStore, publicUser, type User, type Session } from './store.js';
import { ACCESS_SECONDS, SESSION_SECONDS, Tokens, tokenHash, unauthorized } from './tokens.js';
import { credentials } from './validation.js';
import { type OAuthIdentity } from './oauth-providers.js';

export class AuthService {
  constructor(readonly store: AuthStore, readonly tokens: Tokens) {}

  private async response(user: User, session: Session, refreshToken: string) {
    const expiresAt = new Date(Math.min(Date.now() + ACCESS_SECONDS * 1000, session.expiresAt.getTime()));
    return {
      user: publicUser(user), accessToken: await this.tokens.issue('access', user._id, session._id, expiresAt),
      expiresAt: expiresAt.toISOString(), refreshToken, sessionExpiresAt: session.expiresAt,
    };
  }
  private async startSession(user: User) {
    const now = new Date();
    const session: Session = {
      _id: randomUUID(), userId: user._id, createdAt: now,
      expiresAt: new Date(now.getTime() + SESSION_SECONDS * 1000), refreshHash: '',
    };
    const refreshToken = await this.tokens.issue('refresh', user._id, session._id, session.expiresAt);
    session.refreshHash = tokenHash(refreshToken);
    await this.store.sessions.insertOne(session);
    return this.response(user, session, refreshToken);
  }
  async register(body: unknown) {
    const { name, email, password } = credentials(body, true);
    const user: User = {
      _id: randomUUID(), email, name, roles: ['USER'], createdAt: new Date(), passwordHash: await hashPassword(password),
    };
    try { await this.store.users.insertOne(user); }
    catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        throw new ApiError(409, 'EMAIL_IN_USE', 'An account with this email already exists.');
      }
      throw error;
    }
    return this.startSession(user);
  }
  async login(body: unknown) {
    const { email, password } = credentials(body, false);
    const user = await this.store.users.findOne({ email });
    const valid = await verifyPassword(password, user?.passwordHash ?? dummyPasswordHash);
    if (!user || !valid) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    return this.startSession(user);
  }
  async oauthSignIn(identity: OAuthIdentity) {
    const selector = { 'oauth.provider': identity.provider, 'oauth.subject': identity.subject };
    const existing = await this.store.users.findOne(selector);
    if (existing) return this.startSession(existing);
    const user: User = {
      _id: randomUUID(), email: identity.email, name: identity.name, roles: ['USER'], createdAt: new Date(),
      oauth: { provider: identity.provider, subject: identity.subject },
    };
    try { await this.store.users.insertOne(user); }
    catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const concurrent = await this.store.users.findOne(selector);
        if (concurrent) return this.startSession(concurrent);
        throw new ApiError(409, 'OAUTH_ACCOUNT_EXISTS', 'Use the original sign-in method for this email. Account linking is not available yet.');
      }
      throw error;
    }
    return this.startSession(user);
  }
  async refresh(token: string) {
    const claims = await this.tokens.verify('refresh', token);
    const session = await this.store.activeSession(claims.sessionId);
    if (!session || session.userId !== claims.userId) throw unauthorized();
    const user = await this.store.users.findOne({ _id: session.userId });
    if (!user) throw unauthorized();
    const replacement = await this.tokens.issue('refresh', user._id, session._id, session.expiresAt);
    if (!await this.store.rotate(session._id, tokenHash(token), tokenHash(replacement))) {
      // A signed, unexpired token from this session was already used: revoke the family.
      await this.store.revoke(session._id);
      throw unauthorized();
    }
    return this.response(user, session, replacement);
  }
  async authenticate(token: string) {
    const claims = await this.tokens.verify('access', token);
    const session = await this.store.activeSession(claims.sessionId);
    if (!session || session.userId !== claims.userId) throw unauthorized();
    const user = await this.store.users.findOne({ _id: claims.userId });
    if (!user) throw unauthorized();
    return publicUser(user);
  }
  async logout(token: string | undefined) {
    if (!token) return;
    let sessionId: string;
    try { ({ sessionId } = await this.tokens.verify('refresh', token)); }
    catch { return; }
    await this.store.revoke(sessionId);
  }
}
