import { createHash } from 'node:crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authenticate, requireRoles } from '../auth/routes.js';
import { type AuthService } from '../auth/service.js';
import { ApiError } from '../errors.js';
import { type ResumeStore } from '../resumes/store.js';
import { IntelligenceClient } from './client.js';
import { ResumeAnalysisService } from './service.js';
import { type ProfileStore } from '../profiles/store.js';

export function intelligenceRouter(auth: AuthService, resumes: ResumeStore, client: IntelligenceClient, profiles?: ProfileStore) {
  const router = Router();
  const analysis = new ResumeAnalysisService(resumes, client, profiles);
  router.use(authenticate(auth), requireRoles('USER', 'ADMIN'));
  router.get('/status', async (_req, res) => res.json(await client.status()));
  router.get('/capabilities', async (_req, res) => res.json(await client.capabilities()));
  const throttle = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: (_req, res) => res.locals.user.id,
    handler: (_req, res, next) => {
      res.setHeader('Retry-After', '900');
      next(new ApiError(429, 'RATE_LIMITED', 'Too many resume processing attempts. Please try again later.'));
    },
  });
  router.use('/resumes/:id', (req, _res, next) => {
    if (typeof req.params.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(req.params.id)) {
      throw new ApiError(400, 'INVALID_INPUT', 'Provide a valid resume ID.');
    }
    next();
  });
  router.get('/resumes/:id/draft', async (req, res) => {
    const { analysisId } = req.query;
    if (Object.keys(req.query).some(key => key !== 'analysisId') || (analysisId !== undefined
      && (typeof analysisId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(analysisId)))) {
      throw new ApiError(400, 'INVALID_INPUT', 'Choose a valid saved draft.');
    }
    res.json(await analysis.get(res.locals.user.id, req.params.id, undefined, analysisId));
  });
  router.get('/resumes/:id/drafts', async (req, res) => {
    const { beforeVersion } = req.query;
    if (Object.keys(req.query).some(key => key !== 'beforeVersion') || (beforeVersion !== undefined
      && (typeof beforeVersion !== 'string' || !/^[1-9]\d{0,9}$/.test(beforeVersion) || Number(beforeVersion) > 2147483647))) {
      throw new ApiError(400, 'INVALID_INPUT', 'Choose a valid version history cursor.');
    }
    res.json(await analysis.history(res.locals.user.id, req.params.id, beforeVersion === undefined ? undefined : Number(beforeVersion)));
  });
  router.post('/resumes/:id/analyze', throttle, async (req, res) => {
    if (!req.is('application/json')) throw new ApiError(415, 'JSON_REQUIRED', 'Use application/json.');
    const cancellation = new AbortController();
    const cancel = () => { if (!res.writableEnded) cancellation.abort(); };
    res.on('close', cancel); req.on('aborted', cancel);
    try {
      const id = req.params.id;
      if (typeof id !== 'string') throw new ApiError(400, 'INVALID_INPUT', 'Provide a valid resume ID.');
      const record = await analysis.analyze(res.locals.user.id, id, req.body, cancellation.signal, res.locals.requestId);
      if (!cancellation.signal.aborted) res.json(record);
    } catch (error) {
      if (cancellation.signal.aborted) return;
      if (error instanceof ApiError && error.code === 'INTELLIGENCE_BUSY') res.setHeader('Retry-After', '5');
      throw error;
    } finally { res.off('close', cancel); req.off('aborted', cancel); }
  });
  router.post('/resumes/:id/draft/apply', async (req, res) => {
    if (!req.is('application/json')) throw new ApiError(415, 'JSON_REQUIRED', 'Use application/json.');
    res.json({ profile: await analysis.apply(res.locals.user, req.params.id, req.body) });
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
