import { Router } from 'express';
import { ApiError } from '../errors.js';
import { authenticate, requireRoles } from '../auth/routes.js';
import { type AuthService } from '../auth/service.js';
import { type ProfileStore } from './store.js';
import { parseProfilePatch } from './validation.js';

export function profileRouter(service: AuthService, store: ProfileStore) {
  const router = Router();
  router.use(authenticate(service), requireRoles('USER', 'ADMIN'));
  router.get('/me', async (_req, res) => res.json({ profile: await store.get(res.locals.user) }));
  router.patch('/me', async (req, res) => {
    if (!req.is('application/json')) throw new ApiError(415, 'JSON_REQUIRED', 'Use application/json.');
    const { version, changes } = parseProfilePatch(req.body);
    res.json({ profile: await store.update(res.locals.user, version, changes) });
  });
  return router;
}
