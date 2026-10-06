import { type Router, type RequestHandler } from 'express';
import { ApiError } from '../errors.js';
import { type SavedJobRankingService } from './ranking-service.js';

export class SavedJobRankingRoutes {
  constructor(private ranking: SavedJobRankingService) {}
  register(router: Router, throttle: RequestHandler) {
    router.post('/saved-jobs/rank', throttle, async (req, res) => {
      if (!req.is('application/json')) throw new ApiError(415, 'JSON_REQUIRED', 'Use application/json.');
      if (Object.keys(req.query).length) throw new ApiError(400, 'INVALID_INPUT', 'Ranking does not accept query parameters.');
      const cancellation = new AbortController(), deadline = AbortSignal.timeout(60_000);
      const signal = AbortSignal.any([cancellation.signal, deadline]);
      const cancel = () => { if (!res.writableEnded) cancellation.abort(); };
      res.on('close', cancel); req.on('aborted', cancel);
      try {
        const result = await this.ranking.rank(res.locals.user, req.body, signal);
        if (!signal.aborted) res.json(result);
      } catch (error) {
        if (cancellation.signal.aborted) return;
        if (deadline.aborted) throw new ApiError(504, 'RANKING_TIMEOUT', 'Ranking took too long. Narrow your saved-job filters and retry.');
        throw error;
      } finally { res.off('close', cancel); req.off('aborted', cancel); }
    });
  }
}
