import { createHash } from 'node:crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authenticate, requireRoles } from '../auth/routes.js';
import { type AuthService } from '../auth/service.js';
import { ApiError } from '../errors.js';
import { type ResumeStore } from '../resumes/store.js';
import { IntelligenceClient } from './client.js';

export function intelligenceRouter(auth: AuthService, resumes: ResumeStore, client: IntelligenceClient) {
  const router = Router();
  router.use(authenticate(auth), requireRoles('USER', 'ADMIN'));
  router.get('/status', async (_req, res) => res.json(await client.status()));
  const throttle = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: (_req, res) => res.locals.user.id,
    handler: (_req, res, next) => {
      res.setHeader('Retry-After', '900');
      next(new ApiError(429, 'RATE_LIMITED', 'Too many extraction attempts. Please try again later.'));
    },
  });
  router.post('/resumes/:id/extract', throttle, async (req, res) => {
    if (!req.is('application/json')) throw new ApiError(415, 'JSON_REQUIRED', 'Use application/json.');
    const id = req.params.id;
    if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
      || !req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length) {
      throw new ApiError(400, 'INVALID_INPUT', 'Provide a valid resume ID and an empty request body.');
    }
    const owner = res.locals.user.id;
    const { item, data } = await resumes.download(owner, id);
    const cancellation = new AbortController();
    const cancel = () => { if (!res.writableEnded) cancellation.abort(); };
    res.on('close', cancel);
    req.on('aborted', cancel);
    try {
      const result = await client.extract(data, res.locals.requestId, cancellation.signal);
      const { resumes: versions } = await resumes.list(owner);
      if (!versions.some(version => version.id === item.id && version.version === item.version && !version.deleting)) {
        throw new ApiError(404, 'RESUME_NOT_FOUND', 'Resume not found.');
      }
      if (!cancellation.signal.aborted) res.json({ ...result, source: {
        resumeId: item.id, resumeVersion: item.version, sha256: createHash('sha256').update(data).digest('hex'),
      } });
    } catch (error) {
      if (cancellation.signal.aborted) return;
      if (error instanceof ApiError && error.code === 'INTELLIGENCE_BUSY') res.setHeader('Retry-After', '5');
      throw error;
    } finally {
      res.off('close', cancel);
      req.off('aborted', cancel);
    }
  });
  return router;
}
