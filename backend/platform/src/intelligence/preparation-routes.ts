import { type RequestHandler, type Router } from 'express';
import { ApiError } from '../errors.js';
import { AnalysisQueries } from './queries.js';
import { type PreparationService } from './preparation-service.js';
import { TaskVerifier } from './tasks.js';

export class PreparationRoutes {
  constructor(private service: PreparationService) {}
  register(router: Router, throttle: RequestHandler) {
    const root = '/jobs/:id/preparation-plans';
    router.use(root, (req, _res, next) => {
      if (typeof req.params.id !== 'string' || !/^[a-f0-9]{64}$/.test(req.params.id)) throw new ApiError(400, 'INVALID_INPUT', 'Choose a valid job.');
      next();
    });
    router.post(root, throttle, async (req, res) => {
      this.body(req);
      res.status(202).json(await this.service.start(res.locals.user, req.params.id as string, req.body));
    });
    router.get(root, async (req, res) => res.json(await this.service.history(res.locals.user, req.params.id as string, AnalysisQueries.before(req.query))));
    router.get(root + '/:planId', async (req, res) => {
      this.id(req.params.planId); if (Object.keys(req.query).length) throw new ApiError(400, 'INVALID_INPUT', 'Plan reads do not accept query parameters.');
      res.json(await this.service.get(res.locals.user, req.params.id as string, req.params.planId as string));
    });
    router.patch(root + '/:planId/review', async (req, res) => {
      this.id(req.params.planId); this.body(req);
      res.json(await this.service.review(res.locals.user, req.params.id as string, req.params.planId as string, req.body));
    });
  }
  private id(value: unknown) { if (!TaskVerifier.uuid(value)) throw new ApiError(400, 'INVALID_INPUT', 'Choose a valid preparation plan.'); }
  private body(req: { is: (type: string) => unknown; query: object }) {
    if (!req.is('application/json')) throw new ApiError(415, 'JSON_REQUIRED', 'Use application/json.');
    if (Object.keys(req.query).length) throw new ApiError(400, 'INVALID_INPUT', 'This action does not accept query parameters.');
  }
}
