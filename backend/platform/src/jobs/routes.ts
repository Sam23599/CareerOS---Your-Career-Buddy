import { Router } from 'express';
import { authenticate, requireRoles } from '../auth/routes.js';
import { type AuthService } from '../auth/service.js';
import { ApiError } from '../errors.js';
import { type JobSource } from './model.js';
import { JobStore, parseSearch } from './store.js';

export function jobRouter(store: JobStore, auth: AuthService, sources: JobSource[]) {
  const router = Router();
  router.get('/', async (req, res) => res.json(await store.list(parseSearch(req.query))));
  router.get('/sources', async (_req, res) => res.json({ sources: await store.sources() }));
  router.post('/ingest/:source', authenticate(auth), requireRoles('ADMIN'), async (req, res) => {
    const source = sources.find(source => source.id === req.params.source);
    if (!source) throw new ApiError(404, 'SOURCE_NOT_FOUND', 'Source not found.');
    res.json(await store.ingest(source));
  });
  router.get('/:id', async (req, res) => res.json({ job: await store.get(req.params.id) }));
  return router;
}
