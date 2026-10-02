import { randomUUID } from 'node:crypto';
import { MongoServerError } from 'mongodb';
import { ApiError } from '../errors.js';
import { dummyPasswordHash, hashPassword, verifyPassword } from './password.js';
import { AuthStore, publicUser, type User, type Session } from './store.js';
import { ACCESS_SECONDS, SESSION_SECONDS, Tokens, tokenHash, unauthorized } from './tokens.js';
import { credentials, loginCredentials, newPassword, usernameInput } from './validation.js';
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
    const { identifier, password } = loginCredentials(body);
    const user = await this.store.users.findOne(identifier.includes('@') ? { email: identifier } : { username: identifier });
    const valid = await verifyPassword(password, user?.passwordHash ?? dummyPasswordHash);
    if (!user || !valid) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Your sign-in details are incorrect.');
    return this.startSession(user);
  }
  async oauthSignIn(identity: OAuthIdentity) {
    const selector = { 'oauth.provider': identity.provider, 'oauth.subject': identity.subject };
    const existing = await this.store.users.findOne(selector);
    if (existing) {
      // The suggestion belongs to the first signup, never a returning provider login.
      if (existing.passwordPromptPending) {
        await this.store.users.updateOne({ _id: existing._id }, { $set: { passwordPromptPending: false } });
        existing.passwordPromptPending = false;
      }
      return this.startSession(existing);
    }
    const user: User = {
      _id: randomUUID(), email: identity.email, name: identity.name, roles: ['USER'], createdAt: new Date(),
      oauth: { provider: identity.provider, subject: identity.subject },
      passwordPromptPending: true,
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
  private async refreshSession(token: string) {
    const claims = await this.tokens.verify('refresh', token);
    const session = await this.store.activeSession(claims.sessionId);
    if (!session || session.userId !== claims.userId) throw unauthorized();
    if (session.refreshHash !== tokenHash(token)) {
      await this.store.revoke(session._id);
      throw unauthorized();
    }
    const user = await this.store.users.findOne({ _id: session.userId });
    if (!user) throw unauthorized();
    return { user, session };
  }
  async restore(token: string) {
    const { user, session } = await this.refreshSession(token);
    // Page loads can be interrupted safely: only an explicit refresh rotates the cookie.
    return this.response(user, session, token);
  }
  async refresh(token: string) {
    const { user, session } = await this.refreshSession(token);
    const replacement = await this.tokens.issue('refresh', user._id, session._id, session.expiresAt);
    if (!await this.store.rotate(session._id, tokenHash(token), tokenHash(replacement))) {
      // A signed, unexpired token from this session was already used: revoke the family.
      await this.store.revoke(session._id);
      throw unauthorized();
    }
    return this.response(user, session, replacement);
  }
  private async accessSession(token: string) {
    const claims = await this.tokens.verify('access', token);
    const session = await this.store.activeSession(claims.sessionId);
    if (!session || session.userId !== claims.userId) throw unauthorized();
    const user = await this.store.users.findOne({ _id: claims.userId });
    if (!user) throw unauthorized();
    return { user, session };
  }
  async authenticate(token: string) {
    return publicUser((await this.accessSession(token)).user);
  }
  async addPassword(token: string, body: unknown) {
    const password = newPassword(body);
    const { user, session } = await this.accessSession(token);
    if (user.passwordHash || !user.oauth) throw new ApiError(409, 'PASSWORD_ALREADY_SET', 'This account already has a password.');
    if (Date.now() - session.createdAt.getTime() > ACCESS_SECONDS * 1000) {
      throw new ApiError(403, 'REAUTH_REQUIRED', 'Sign in again with your provider before adding a password.');
    }
    const updated = await this.store.users.findOneAndUpdate({ _id: user._id, passwordHash: { $exists: false } }, {
      $set: { passwordHash: await hashPassword(password), passwordPromptPending: false },
    }, { returnDocument: 'after' });
    if (!updated) throw new ApiError(409, 'PASSWORD_ALREADY_SET', 'This account already has a password.');
    return publicUser(updated);
  }
  async dismissPasswordPrompt(userId: string) {
    const user = await this.store.users.findOneAndUpdate({ _id: userId }, { $set: { passwordPromptPending: false } }, { returnDocument: 'after' });
    if (!user) throw unauthorized();
    return publicUser(user);
  }
  async setUsername(userId: string, body: unknown) {
    const username = usernameInput(body);
    try {
      const user = await this.store.users.findOneAndUpdate({ _id: userId }, username
        ? { $set: { username } } : { $unset: { username: '' } }, { returnDocument: 'after' });
      if (!user) throw unauthorized();
      return publicUser(user);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) throw new ApiError(409, 'USERNAME_IN_USE', 'This username is already taken.');
      throw error;
    }
  }
  async logout(token: string | undefined) {
    if (!token) return;
    let sessionId: string;
    try { ({ sessionId } = await this.tokens.verify('refresh', token)); }
    catch { return; }
    await this.store.revoke(sessionId);
  }
}
