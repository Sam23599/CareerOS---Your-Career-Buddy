import { Router, type RequestHandler, type Response } from 'express';
import { parse } from 'cookie';
import { rateLimit } from 'express-rate-limit';
import { ApiError } from '../errors.js';
import { type AuthService } from './service.js';
import { type Role } from './store.js';
import { unauthorized } from './tokens.js';
import { oauthRouter } from './oauth-routes.js';
import { type OAuthProvider } from './oauth-providers.js';

export type AuthOptions = { service: AuthService; allowedOrigins: string[]; secureCookie: boolean; oauth?: { providers: OAuthProvider[]; publicOrigin: string } };
export const REFRESH_COOKIE = 'careeros_refresh';
const cookiePath = '/api/v1/auth';

export function authenticate(service: AuthService): RequestHandler {
  return async (req, res, next) => {
    const value = req.headers.authorization;
    if (!value?.startsWith('Bearer ')) throw unauthorized();
    res.locals.user = await service.authenticate(value.slice(7));
    next();
  };
}
export function requireRoles(...roles: Role[]): RequestHandler {
  return (_req, res, next) => {
    const user = res.locals.user as { roles: Role[] } | undefined;
    if (!user) throw unauthorized();
    if (!roles.some(role => user.roles.includes(role))) throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to do this.');
    next();
  };
}

export function authRouter(options: AuthOptions) {
  const { service, allowedOrigins, secureCookie } = options;
  const router = Router();
  const cookieOptions = { httpOnly: true, secure: secureCookie, sameSite: 'strict' as const, path: cookiePath };
  const clear = (res: Response) => res.clearCookie(REFRESH_COOKIE, cookieOptions);
  const setSessionCookie = (res: Response, result: Awaited<ReturnType<AuthService['login']>>) => {
    res.cookie(REFRESH_COOKIE, result.refreshToken, { ...cookieOptions, expires: result.sessionExpiresAt });
  };
  const complete = (res: Response, result: Awaited<ReturnType<AuthService['login']>>, status = 200) => {
    setSessionCookie(res, result);
    res.status(status).json({ user: result.user, accessToken: result.accessToken, expiresAt: result.expiresAt });
  };
  // Browser forms cannot set this custom header, and untrusted origins are rejected explicitly.
  router.use((req, _res, next) => {
    if (req.method !== 'POST') return next();
    if (!allowedOrigins.includes(req.get('origin') ?? '') || req.get('x-careeros-client') !== 'web') {
      throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed.');
    }
    if (!req.is('application/json')) throw new ApiError(415, 'JSON_REQUIRED', 'Use application/json.');
    next();
  });
  router.use(async (_req, _res, next) => { await service.store.initialize(); next(); });
  const limit = (max: number, skipSuccessfulRequests = false) => rateLimit({
    windowMs: 15 * 60 * 1000, limit: max, standardHeaders: 'draft-8', legacyHeaders: false, skipSuccessfulRequests,
    handler: (_req, _res, next) => next(new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.')),
  });
  router.get('/providers', (_req, res) => res.json({ providers: options.oauth?.providers.map(provider => ({
    id: provider.id, name: provider.name, url: `${options.oauth!.publicOrigin}/api/v1/auth/oauth/${provider.id}/start`,
  })) ?? [] }));
  if (options.oauth) router.use('/oauth', oauthRouter({ ...options.oauth, service, secureCookie, setSessionCookie }));
  router.post('/register', limit(10), async (req, res) => complete(res, await service.register(req.body), 201));
  router.post('/login', limit(20, true), async (req, res) => complete(res, await service.login(req.body)));
  router.post('/refresh', limit(120), async (req, res) => {
    try { complete(res, await service.refresh(parse(req.headers.cookie ?? '')[REFRESH_COOKIE] ?? '')); }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) clear(res);
      throw error;
    }
  });
  router.post('/logout', async (req, res) => {
    await service.logout(parse(req.headers.cookie ?? '')[REFRESH_COOKIE]);
    clear(res);
    res.sendStatus(204);
  });
  return router;
}
