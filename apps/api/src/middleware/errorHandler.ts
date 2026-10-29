import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** The single error response shape used across the whole API. */
export function errorBody(err: AppError): ApiErrorBody {
  return { error: { code: err.code, message: err.message, details: err.details } };
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } } satisfies ApiErrorBody);
}

/** Central error handler: maps known failures, hides stack traces from clients. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'The uploaded file exceeds the allowed size.' } });
    return;
  }
  if (typeof err === 'object' && err !== null && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Request body is not valid JSON.' } });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json(errorBody(err));
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request data is invalid.',
        details: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      },
    });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({
        error: { code: 'CONFLICT', message: 'A record with this unique value already exists.', details: err.meta },
      });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Record not found.' } });
      return;
    }
    if (err.code === 'P2003') {
      res.status(409).json({
        error: { code: 'CONFLICT', message: 'The record references another record that does not exist.' },
      });
      return;
    }
  }
  if (err instanceof Prisma.PrismaClientInitializationError || err instanceof Prisma.PrismaClientRustPanicError) {
    logger.error('database error', err);
    res.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Database is not available.' } });
    return;
  }
  logger.error('unhandled error', err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' } });
}
