import { resumeRouter } from './resumes/routes.js';
import { type ResumeStore } from './resumes/store.js';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { handleError } from './errors.js';
import { profileRouter } from './profiles/routes.js';
import { type ProfileStore } from './profiles/store.js';
import { authenticate, authRouter, requireRoles, type AuthOptions } from './auth/routes.js';

export function createApp(checkDatabase: () => Promise<void>, auth?: AuthOptions, profiles?: ProfileStore, resumes?: ResumeStore) {
  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    const path = req.path;
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.on('finish', () => {
      console.info(JSON.stringify({
        event: 'http_request', requestId, method: req.method, path,
        status: res.statusCode, durationMs: Date.now() - startedAt,
      }));
    });
    next();
  });
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok', service: 'platform' });
  });

  app.get('/api/v1/ready', async (_req, res) => {
    try {
      await checkDatabase();
      res.json({ status: 'ready', checks: { mongodb: 'up' } });
    } catch {
      res.status(503).json({
        status: 'not_ready', checks: { mongodb: 'down' },
        error: { code: 'DATABASE_UNAVAILABLE', message: 'Database is unavailable.', requestId: res.locals.requestId },
      });
    }
  });

  if (auth) {
    app.use('/api/v1/auth', authRouter(auth));
    if (resumes) app.use('/api/v1/resumes', resumeRouter(auth.service, resumes));
    if (profiles) app.use('/api/v1/profiles', profileRouter(auth.service, profiles));
    app.get('/api/v1/users/me', authenticate(auth.service), requireRoles('USER', 'ADMIN'), (_req, res) => {
      res.json({ user: res.locals.user });
    });
  }

  app.use((_req, res) => {
    res.status(404).json({ error: {
      code: 'NOT_FOUND', message: 'Route not found.', requestId: res.locals.requestId,
    } });
  });

  app.use(handleError);
  return app;
}
