import { type Router, type RequestHandler } from 'express';
import { ApiError } from '../errors.js';
import { type IntelligenceClient } from './client.js';
import { JobAnalysisService } from './job-service.js';
import { AnalysisQueries } from './queries.js';

export class JobAnalysisRoutes {
  constructor(private analysis: JobAnalysisService, private client: IntelligenceClient) {}
  register(router: Router, throttle: RequestHandler) {
    router.get('/jobs/capabilities', async (_req, res) => res.json(await this.client.capabilities(undefined, true)));
    router.use('/jobs/:id', (req, _res, next) => {
      if (typeof req.params.id !== 'string' || !/^[a-f0-9]{64}$/.test(req.params.id)) throw new ApiError(400, 'INVALID_INPUT', 'Provide a valid job ID.');
      next();
    });
    router.get('/jobs/:id/tasks', async (req, res) => { await this.analysis.source(req.params.id as string); res.json(await this.client.tasks(res.locals.user.id, req.params.id as string)); });
    router.post('/jobs/:id/tasks', throttle, async (req, res) => res.status(202).json(await this.analysis.startTask(res.locals.user.id, req.params.id as string, req.body)));
    router.get('/jobs/:id/analysis', async (req, res) => res.json(await this.analysis.get(res.locals.user.id, req.params.id, AnalysisQueries.id(req.query))));
    router.get('/jobs/:id/analyses', async (req, res) => res.json(await this.analysis.history(res.locals.user.id, req.params.id, AnalysisQueries.before(req.query))));
    router.post('/jobs/:id/analyze', throttle, async (req, res) => {
      if (!req.is('application/json')) throw new ApiError(415, 'JSON_REQUIRED', 'Use application/json.');
      const cancellation = new AbortController();
      const cancel = () => { if (!res.writableEnded) cancellation.abort(); };
      res.on('close', cancel); req.on('aborted', cancel);
      try {
        const id = req.params.id;
        if (typeof id !== 'string') throw new ApiError(400, 'INVALID_INPUT', 'Provide a valid job ID.');
        const record = await this.analysis.analyze(res.locals.user.id, id, req.body, cancellation.signal);
        if (!cancellation.signal.aborted) res.json(record);
      } catch (error) {
        if (cancellation.signal.aborted) return;
        if (error instanceof ApiError && error.code === 'INTELLIGENCE_BUSY') res.setHeader('Retry-After', '5');
        throw error;
      } finally { res.off('close', cancel); req.off('aborted', cancel); }
    });
  }
}
