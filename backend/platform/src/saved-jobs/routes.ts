import { Router } from 'express';
import { authenticate, requireRoles } from '../auth/routes.js';
import { type AuthService } from '../auth/service.js';
import { ApiError } from '../errors.js';
import { SavedJobStore, parseSavedPatch, parseSavedQuery } from './store.js';

export function savedJobRouter(auth: AuthService, store: SavedJobStore) {
  const router = Router();
  router.use(authenticate(auth), requireRoles('USER', 'ADMIN'));
  router.get('/', async (req, res) => res.json(await store.list(res.locals.user.id, parseSavedQuery(req.query))));
  router.get('/:jobId', async (req, res) => res.json({ savedJob: await store.get(res.locals.user.id, req.params.jobId) }));
  router.put('/:jobId', async (req, res) => {
    if (req.body && Object.keys(req.body).length) throw new ApiError(400, 'INVALID_SAVED_JOB', 'Save takes no fields. Use PATCH to edit a saved job.');
    res.json({ savedJob: await store.save(res.locals.user.id, req.params.jobId) });
  });
  router.patch('/:jobId', async (req, res) => {
    if (!req.is('application/json')) throw new ApiError(415, 'JSON_REQUIRED', 'Use application/json.');
    res.json({ savedJob: await store.update(res.locals.user.id, req.params.jobId, parseSavedPatch(req.body)) });
  });
  router.delete('/:jobId', async (req, res) => { await store.remove(res.locals.user.id, req.params.jobId); res.sendStatus(204); });
  return router;
}
