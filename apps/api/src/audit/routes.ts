import { z } from 'zod';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { parseWith } from '../middleware/validate.js';
import { listQuerySchema, paginated } from '../utils/listing.js';

const auditListSchema = listQuerySchema(['createdAt'] as const).extend({
  eventType: z.string().trim().max(60).optional(),
  targetType: z.enum(['CASE', 'SAMPLE', 'TASK', 'IMPORT_BATCH', 'USER']).optional(),
  targetId: z.string().cuid().optional(),
  actorId: z.string().cuid().optional(),
});

export function auditRouter(): Router {
  const router = Router();
  router.get('/audit', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = parseWith(auditListSchema, req.query);
      const where = {
        eventType: query.eventType ? { contains: query.eventType, mode: 'insensitive' as const } : undefined,
        targetType: query.targetType,
        targetId: query.targetId,
        actorId: query.actorId,
      };
      const [items, total] = await prisma.$transaction([
        prisma.auditEvent.findMany({
          where,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          orderBy: { createdAt: query.order },
        }),
        prisma.auditEvent.count({ where }),
      ]);
      res.json(paginated(items, total, query));
    } catch (err) {
      next(err);
    }
  });
  return router;
}
