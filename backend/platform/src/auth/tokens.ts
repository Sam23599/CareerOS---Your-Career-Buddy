import { createHash, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { ApiError } from '../errors.js';

export const ACCESS_SECONDS = 15 * 60;
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const unauthorized = () => new ApiError(401, 'UNAUTHENTICATED', 'Please sign in again.');
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export class Tokens {
  private readonly key: Uint8Array;
  constructor(secret: string) { this.key = Buffer.from(secret, 'hex'); }

  async issue(kind: 'access' | 'refresh', userId: string, sessionId: string, expiresAt: Date) {
    return new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: 'HS256', typ: `${kind}+jwt` })
      .setIssuer('careeros-platform').setAudience(`careeros-${kind}`)
      .setSubject(userId).setJti(randomUUID()).setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000)).sign(this.key);
  }
  async verify(kind: 'access' | 'refresh', token: string) {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'], issuer: 'careeros-platform', audience: `careeros-${kind}`, typ: `${kind}+jwt`,
        requiredClaims: ['sub', 'sid', 'jti', 'iat', 'exp'],
      });
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') throw unauthorized();
      return { userId: payload.sub, sessionId: payload.sid };
    } catch { throw unauthorized(); }
  }
}
