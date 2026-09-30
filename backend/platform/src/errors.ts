import { type ErrorRequestHandler } from 'express';
import { MongoNetworkError, MongoServerSelectionError, MongoOperationTimeoutError } from 'mongodb';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export const handleError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  const type = typeof error === 'object' && error !== null && 'type' in error ? error.type : undefined;
  const known = error instanceof ApiError ? error
    : type === 'entity.parse.failed' ? new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.')
    : type === 'entity.too.large' ? new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.')
    : error instanceof MongoNetworkError || error instanceof MongoServerSelectionError || error instanceof MongoOperationTimeoutError
      ? new ApiError(503, 'DATABASE_UNAVAILABLE', 'Service temporarily unavailable. Please try again.')
    : new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  res.status(known.status).json({ error: {
    code: known.code, message: known.message, requestId: res.locals.requestId,
  } });
};
