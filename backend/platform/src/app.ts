import { recoveryRouter } from './recovery/routes.js';
import { type RecoveryStore } from './recovery/store.js';
import { savedJobRouter } from './saved-jobs/routes.js';
import { type SavedJobStore } from './saved-jobs/store.js';
import { jobRouter } from './jobs/routes.js';
import { type JobStore } from './jobs/store.js';
import { type JobSource } from './jobs/model.js';
import { resumeRouter } from './resumes/routes.js';
import { type ResumeStore } from './resumes/store.js';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { handleError } from './errors.js';
import { profileRouter } from './profiles/routes.js';
import { type ProfileStore } from './profiles/store.js';
import { authenticate, authRouter, requireRoles, type AuthOptions } from './auth/routes.js';
import { careerSourceRouter } from './career-sources/routes.js';
import { type CareerSourceStore } from './career-sources/store.js';
import { notificationRouter } from './notifications/routes.js';
import { type NotificationStore } from './notifications/store.js';
import { intelligenceRouter } from './intelligence/routes.js';
import { IntelligenceClient } from './intelligence/client.js';
import { type JobAnalysisCleanup } from './intelligence/job-cleanup.js';

export function createApp(checkDatabase: () => Promise<void>, auth?: AuthOptions, profiles?: ProfileStore, resumes?: ResumeStore, jobs?: { store: JobStore; sources: JobSource[] }, savedJobs?: SavedJobStore, features?: { careerSources: CareerSourceStore; notifications: NotificationStore }, intelligence = new IntelligenceClient({}), jobCleanup?: JobAnalysisCleanup, recovery?: RecoveryStore) {
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
        ...(res.locals.errorCode ? { code: res.locals.errorCode } : {}),
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
    app.get('/api/v1/system/status', authenticate(auth.service), async (_req, res) => {
      let mongodb = false;
      try { await checkDatabase(); mongodb = true; } catch { /* Report, without hiding other services. */ }
      res.json({ api: true, mongodb, ...await intelligence.dependencies(), aiProviderChecked: false });
    });
    if (recovery) app.use('/api/v1/recycle-bin', recoveryRouter(auth.service, recovery));
    if (features) {
      app.use('/api/v1/career-sources', careerSourceRouter(auth.service, features.careerSources));
      app.use('/api/v1/notifications', notificationRouter(auth.service, features.notifications));
    }
    if (savedJobs) app.use('/api/v1/saved-jobs', savedJobRouter(auth.service, savedJobs));
    if (jobs) app.use('/api/v1/jobs', jobRouter(jobs.store, auth.service, jobs.sources));
    app.use('/api/v1/auth', authRouter(auth));
    if (resumes) {
      app.use('/api/v1/resumes', resumeRouter(auth.service, resumes));
    }
    if (resumes || jobs) app.use('/api/v1/intelligence', intelligenceRouter(auth.service, resumes, intelligence, profiles, jobs?.store, jobCleanup, savedJobs));
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
