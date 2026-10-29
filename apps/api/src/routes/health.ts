import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db.js';
import { logger } from '../logger.js';

/** Public health check: reports process liveness and database connectivity. */
export async function healthHandler(_req: Request, res: Response, _next: NextFunction): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      status: 'ok',
      db: 'ok',
      service: 'vetpulse-api',
      time: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('health check: database unreachable', err);
    res.status(503).json({
      status: 'degraded',
      db: 'unavailable',
      service: 'vetpulse-api',
      time: new Date().toISOString(),
    });
  }
}
