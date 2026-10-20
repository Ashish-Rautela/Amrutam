import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/index.js';
import { logger } from '../observability/logger.js';
import { config } from '../../config/index.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const correlationId = (req.headers['x-correlation-id'] as string) || (req.headers['x-request-id'] as string) || 'none';

  if (err instanceof AppError) {
    logger.warn({
      msg: 'Handled Domain Application Error',
      code: err.code,
      statusCode: err.statusCode,
      message: err.message,
      path: req.originalUrl,
      correlationId,
    });

    res.status(err.statusCode).json({
      type: `https://api.amrutam.co.in/errors/${err.code.toLowerCase()}`,
      title: err.code,
      status: err.statusCode,
      detail: err.message,
      instance: req.originalUrl,
      details: err.details,
      correlationId,
    });
    return;
  }

  // Handle syntax error (e.g., malformed JSON body)
  if ('type' in err && (err as any).type === 'entity.parse.failed') {
    res.status(400).json({
      type: 'https://api.amrutam.co.in/errors/bad-request',
      title: 'BAD_REQUEST',
      status: 400,
      detail: 'Malformed JSON payload provided',
      instance: req.originalUrl,
      correlationId,
    });
    return;
  }

  logger.error({
    msg: 'Unhandled Internal Error',
    error: err.message,
    stack: config.NODE_ENV !== 'production' ? err.stack : undefined,
    path: req.originalUrl,
    correlationId,
  });

  res.status(500).json({
    type: 'https://api.amrutam.co.in/errors/internal-server-error',
    title: 'INTERNAL_SERVER_ERROR',
    status: 500,
    detail: 'An unexpected internal error occurred. Please contact support.',
    instance: req.originalUrl,
    correlationId,
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  const correlationId = (req.headers['x-correlation-id'] as string) || 'none';
  res.status(404).json({
    type: 'https://api.amrutam.co.in/errors/not-found',
    title: 'NOT_FOUND',
    status: 404,
    detail: `Route ${req.method} ${req.originalUrl} not found`,
    instance: req.originalUrl,
    correlationId,
  });
}
