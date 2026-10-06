import { Router } from 'express';
import { authenticate, requireRoles } from '../auth/routes.js';
import { type AuthService } from '../auth/service.js';
import { type RecoveryStore } from './store.js';
import { ApiError } from '../errors.js';

export function recoveryRouter(auth: AuthService, store: RecoveryStore) {
  const router = Router();
  router.use(authenticate(auth));
  router.get('/', async (_req, res) => res.json(await store.list(res.locals.user.id)));
  router.get('/preferences', async (_req, res) => res.json(await store.settings(res.locals.user.id)));
  router.patch('/preferences', async (req, res) => res.json(await store.configure(res.locals.user.id, req.body)));
  router.post('/:kind/:id/restore', async (req, res) => res.json(await store.restore(res.locals.user.id, res.locals.user.id, req.params.kind, req.params.id)));
  router.use('/support', requireRoles('ADMIN'));
  router.get('/support/:owner', async (req, res) => {
    if (!/^[a-f0-9-]{36}$/i.test(req.params.owner)) throw new ApiError(400, 'INVALID_OWNER', 'Provide a valid owner ID.');
    res.json(await store.list(req.params.owner, true, res.locals.user.id));
  });
  router.post('/support/:owner/:kind/:id/restore', async (req, res) => res.json(await store.restore(res.locals.user.id, req.params.owner, req.params.kind, req.params.id, true)));
  return router;
}
