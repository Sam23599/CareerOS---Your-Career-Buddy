import { Router } from 'express';
import { authenticate, requireRoles } from '../auth/routes.js';
import { type AuthService } from '../auth/service.js';
import { ApiError } from '../errors.js';
import { CareerSourceStore, parseSource } from './store.js';

export function careerSourceRouter(auth: AuthService, store: CareerSourceStore) {
  const router = Router(); router.use(authenticate(auth), requireRoles('USER', 'ADMIN'));
  router.get('/', async (req, res) => res.json(await store.list(res.locals.user.id, req.query)));
  router.post('/', async (req, res) => { if (!req.is('application/json')) throw new ApiError(415, 'JSON_REQUIRED', 'Use application/json.'); res.status(201).json({ source: await store.create(res.locals.user.id, parseSource(req.body)) }); });
  router.patch('/:id', async (req, res) => { if (!req.is('application/json')) throw new ApiError(415, 'JSON_REQUIRED', 'Use application/json.'); res.json({ source: await store.update(res.locals.user.id, req.params.id, parseSource(req.body)) }); });
  router.delete('/:id', async (req, res) => { await store.remove(res.locals.user.id, req.params.id); res.sendStatus(204); });
  router.get('/:id/jobs', async (req, res) => res.json(await store.matchingJobs(res.locals.user.id, req.params.id, req.query)));
  router.post('/:id/refresh', async (req, res) => { if (req.body && Object.keys(req.body).length) throw new ApiError(400, 'INVALID_CAREER_SOURCE', 'No fields are required.'); res.json(await store.refresh(res.locals.user.id, req.params.id)); });
  return router;
}
