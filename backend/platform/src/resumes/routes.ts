import express, { Router } from 'express';
import { authenticate, requireRoles } from '../auth/routes.js';
import { type AuthService } from '../auth/service.js';
import { ApiError } from '../errors.js';
import { MAX_RESUME_BYTES, type ResumeStore } from './store.js';

export function resumeRouter(auth: AuthService, store: ResumeStore) {
  const router = Router();
  router.use(authenticate(auth), requireRoles('USER', 'ADMIN'));
  router.get('/', async (_req, res) => res.json(await store.list(res.locals.user.id)));
  router.post('/', (req, _res, next) => {
    if (!req.is('application/pdf')) return next(new ApiError(415, 'PDF_REQUIRED', 'Upload a PDF file.'));
    next();
  }, express.raw({ type: 'application/pdf', limit: MAX_RESUME_BYTES }), async (req, res) => {
    const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
    res.status(201).json(await store.upload(res.locals.user.id, name, req.body));
  });
  router.put('/:id/active', async (req, res) => res.json(await store.activate(res.locals.user.id, req.params.id)));
  router.get('/:id/download', async (req, res) => {
    const { item, data } = await store.download(res.locals.user.id, req.params.id);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.attachment(item.name).type('application/pdf').send(data);
  });
  router.delete('/:id', async (req, res) => res.json(await store.remove(res.locals.user.id, req.params.id)));
  return router;
}
