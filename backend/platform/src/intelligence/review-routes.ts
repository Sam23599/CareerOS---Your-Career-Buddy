import { type Router, type RequestHandler } from 'express';
import { ApiError } from '../errors.js';
import { type ResumeReviewService } from './review-service.js';

export class ResumeReviewRoutes {
  constructor(private reviews: ResumeReviewService) {}

  register(router: Router, throttle: RequestHandler) {
    router.post('/resumes/:id/review', throttle, async (req, res) => {
      if (!req.is('application/json')) throw new ApiError(415, 'JSON_REQUIRED', 'Use application/json.');
      if (Object.keys(req.query).length) throw new ApiError(400, 'INVALID_INPUT', 'Review does not accept query parameters.');
      const cancellation = new AbortController();
      const cancel = () => { if (!res.writableEnded) cancellation.abort(); };
      res.on('close', cancel); req.on('aborted', cancel);
      try {
        const id = req.params.id;
        if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw new ApiError(400, 'INVALID_INPUT', 'Provide a valid resume ID.');
        const result = await this.reviews.review(res.locals.user, id, req.body, cancellation.signal);
        if (!cancellation.signal.aborted) res.json(result);
      } catch (error) {
        if (!cancellation.signal.aborted) throw error;
      } finally { res.off('close', cancel); req.off('aborted', cancel); }
    });
  }
}
