import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';

export function createApp(checkDatabase: () => Promise<void>) {
  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.on('finish', () => {
      console.info(JSON.stringify({
        event: 'http_request', requestId, method: req.method, path: req.path,
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

  app.use((_req, res) => {
    res.status(404).json({ error: {
      code: 'NOT_FOUND', message: 'Route not found.', requestId: res.locals.requestId,
    } });
  });

  const handleError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const type = typeof error === 'object' && error !== null && 'type' in error ? error.type : undefined;
    const status = type === 'entity.parse.failed' ? 400 : type === 'entity.too.large' ? 413 : 500;
    const code = status === 400 ? 'INVALID_JSON' : status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL_ERROR';
    const message = status === 400 ? 'Request body must be valid JSON.'
      : status === 413 ? 'Request body is too large.' : 'An unexpected error occurred.';
    res.status(status).json({ error: { code, message, requestId: res.locals.requestId } });
  };
  app.use(handleError);
  return app;
}
