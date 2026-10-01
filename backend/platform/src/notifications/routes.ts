import { Router } from 'express';
import { authenticate, requireRoles } from '../auth/routes.js';
import { type AuthService } from '../auth/service.js';
import { ApiError } from '../errors.js';
import { NotificationStore, parsePreferences } from './store.js';

export function notificationRouter(auth: AuthService, store: NotificationStore) {
  const router = Router(); router.use(authenticate(auth), requireRoles('USER', 'ADMIN'));
  router.get('/', async (req, res) => res.json(await store.list(res.locals.user.id, req.query)));
  router.get('/preferences', async (_req, res) => res.json({ preferences: await store.preferences(res.locals.user.id) }));
  router.patch('/preferences', async (req, res) => {
    if (!req.is('application/json')) throw new ApiError(415, 'JSON_REQUIRED', 'Use application/json.');
    res.json({ preferences: await store.updatePreferences(res.locals.user.id, parsePreferences(req.body)) });
  });
  router.post('/read-all', async (req, res) => { if (req.body && Object.keys(req.body).length) throw new ApiError(400, 'INVALID_NOTIFICATION', 'No fields are required.'); await store.readAll(res.locals.user.id); res.sendStatus(204); });
  router.patch('/:id', async (req, res) => {
    if (!req.is('application/json')) throw new ApiError(415, 'JSON_REQUIRED', 'Use application/json.');
    if (!req.body || typeof req.body.read !== 'boolean' || Object.keys(req.body).length !== 1) throw new ApiError(400, 'INVALID_NOTIFICATION', 'Provide only a read boolean.');
    await store.read(res.locals.user.id, req.params.id, req.body.read); res.sendStatus(204);
  });
  return router;
}
