import { randomBytes } from 'node:crypto';
import { Router, type Response } from 'express';
import { parse } from 'cookie';
import { rateLimit } from 'express-rate-limit';
import { ApiError } from '../errors.js';
import { type AuthService } from './service.js';
import { type OAuthProvider } from './oauth-providers.js';
import { tokenHash } from './tokens.js';

export function oauthRouter(options: {
  service: AuthService; providers: OAuthProvider[]; publicOrigin: string; secureCookie: boolean;
  setSessionCookie: (res: Response, result: Awaited<ReturnType<AuthService['login']>>) => void;
}) {
  const { service, providers, publicOrigin, secureCookie, setSessionCookie } = options;
  const router = Router();
  const providerFor = (id: string) => {
    const provider = providers.find(value => value.id === id);
    if (!provider) throw new ApiError(404, 'OAUTH_NOT_CONFIGURED', 'This sign-in provider is not available.');
    return provider;
  };
  const bindingOptions = { path: '/api/v1/auth/oauth', httpOnly: true, sameSite: 'lax' as const, secure: secureCookie };
  router.use(rateLimit({
    windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_req, _res, next) => next(new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.')),
  }));
  router.get('/:provider/start', async (req, res) => {
    const provider = providerFor(req.params.provider);
    const state = randomBytes(32).toString('base64url');
    const binding = randomBytes(32).toString('base64url');
    const attempt = { state, verifier: randomBytes(32).toString('base64url'), nonce: randomBytes(32).toString('base64url') };
    const url = await provider.authorizationUrl(attempt, req.query.select_account === 'true');
    await service.store.oauthAttempts.insertOne({
      _id: tokenHash(state), provider: provider.id, bindingHash: tokenHash(binding),
      verifier: attempt.verifier, nonce: attempt.nonce, expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    res.cookie(`careeros_oauth_${provider.id}`, binding, { ...bindingOptions, maxAge: 10 * 60 * 1000 });
    res.redirect(url.href);
  });
  router.get('/:provider/callback', async (req, res) => {
    const provider = providerFor(req.params.provider);
    const cookie = `careeros_oauth_${provider.id}`;
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const binding = parse(req.headers.cookie ?? '')[cookie] ?? '';
    res.clearCookie(cookie, bindingOptions);
    let stage = 'binding';
    try {
      if (!state || !binding || state.length > 200 || binding.length > 200) throw new Error('Missing OAuth state');
      stage = 'state';
      const attempt = await service.store.oauthAttempts.findOneAndDelete({
        _id: tokenHash(state), provider: provider.id, bindingHash: tokenHash(binding), expiresAt: { $gt: new Date() },
      });
      if (!attempt) throw new Error('Invalid or consumed OAuth state');
      const callback = new URL(`${publicOrigin}/api/v1/auth/oauth/${provider.id}/callback`);
      callback.search = new URL(req.originalUrl, publicOrigin).search;
      stage = 'exchange';
      const profile = await provider.exchange(callback, { state, verifier: attempt.verifier, nonce: attempt.nonce });
      if (profile.provider !== provider.id) throw new Error('Provider mismatch');
      stage = 'session';
      const result = await service.oauthSignIn(profile);
      setSessionCookie(res, result);
      res.redirect(`${publicOrigin}/dashboard`);
    } catch (error) {
      const reason = error instanceof ApiError && error.code === 'OAUTH_ACCOUNT_EXISTS' ? 'account_exists' : 'failed';
      // Provider tokens, authorization codes, and raw errors must not enter logs or redirects.
      console.warn(JSON.stringify({ event: 'oauth_sign_in_failed', provider: provider.id, stage,
        code: error instanceof ApiError ? error.code : 'OAUTH_FAILED', requestId: res.locals.requestId }));
      res.redirect(`${publicOrigin}/login?oauth=${reason}`);
    }
  });
  return router;
}
