import { type RequestHandler, type Router } from 'express';
import { ApiError } from '../errors.js';
import { type CadyService } from './cady-service.js';

export class CadyRoutes {
  constructor(private service: CadyService) {}
  register(router: Router, throttle: RequestHandler) {
    router.get('/cady/conversation', async (req, res) => {
      if (Object.keys(req.query).length) throw new ApiError(400, 'INVALID_INPUT', 'Conversation does not accept query parameters.');
      res.json(await this.service.conversation(res.locals.user));
    });
    router.post('/cady/conversation/reset', async (req, res) => {
      if (!req.is('application/json')) throw new ApiError(415, 'JSON_REQUIRED', 'Use application/json.');
      if (Object.keys(req.query).length) throw new ApiError(400, 'INVALID_INPUT', 'Conversation does not accept query parameters.');
      res.json(await this.service.reset(res.locals.user, req.body));
    });
    router.post('/cady/ask', throttle, async (req, res) => {
      if (!req.is('application/json')) throw new ApiError(415, 'JSON_REQUIRED', 'Use application/json.');
      if (Object.keys(req.query).length) throw new ApiError(400, 'INVALID_INPUT', 'Cady does not accept query parameters.');
      const controller = new AbortController(), cancel = () => { if (!res.writableEnded) controller.abort(); };
      res.on('close', cancel); req.on('aborted', cancel);
      try { const result = await this.service.ask(res.locals.user, req.body, controller.signal); if (!controller.signal.aborted) res.json(result); }
      catch (error) { if (!controller.signal.aborted) throw error; }
      finally { res.off('close', cancel); req.off('aborted', cancel); }
    });
  }
}
