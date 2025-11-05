import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { logger } from '../lib/logger.js';

type HttpError = Error & { status?: number; code?: string; details?: unknown };

export function errorHandler(
  err: HttpError,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const status = err.status ?? 500;
  const code = err.code ?? (status === 500 ? 'INTERNAL_SERVER_ERROR' : undefined);

  if (status >= 500) {
    logger.error({ err }, 'Unhandled server error');
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      message: 'Invalid request payload',
      code: 'VALIDATION_ERROR',
      details: err.issues
    });
  }

  return res.status(status).json({
    message: err.message,
    code,
    details: err.details
  });
}
