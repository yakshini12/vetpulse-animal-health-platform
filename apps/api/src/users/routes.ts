import { z } from 'zod';
import { Router, type NextFunction } from 'express';
import { prisma } from '../db.js';
import { currentUser, requireAuth, requireRole } from '../auth/middleware.js';
import { parseWith } from '../middleware/validate.js';
import { AppError, notFound } from '../errors.js';
import { recordAudit } from '../audit/auditService.js';

const userUpdateSchema = z.object({
  role: z.enum(['ADMIN', 'STAFF']).optional(),
  isActive: z.boolean().optional(),
});

export function userRouter(): Router {
  const router = Router();
  router.use('/users', requireAuth, requireRole('ADMIN'));

  router.get('/users', async (_req, res, next: NextFunction) => {
    try {
      const users = await prisma.user.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
      });
      res.json({ items: users });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/users/:id', async (req, res, next: NextFunction) => {
    try {
      const body = parseWith(userUpdateSchema, req.body);
      if (!body.role && body.isActive === undefined) {
        throw new AppError(400, 'BAD_REQUEST', 'Provide a role or isActive change.');
      }
      const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (!existing) throw notFound('User not found.');
      // An admin cannot demote or deactivate themselves: it breaks the only
      // management path back and would otherwise need direct DB access.
      if (body.role !== undefined && existing.id === currentUser(req).id) {
        throw new AppError(409, 'CONFLICT', 'You cannot change your own role.');
      }
      if (body.isActive === false && existing.id === currentUser(req).id) {
        throw new AppError(409, 'CONFLICT', 'You cannot deactivate your own account.');
      }
      const updated = await prisma.$transaction(async (tx) => {
        const user = await tx.user.update({
          where: { id: existing.id },
          data: {
            ...(body.role !== undefined && { role: body.role }),
            ...(body.isActive !== undefined && { isActive: body.isActive }),
          },
          select: { id: true, email: true, name: true, role: true, isActive: true },
        });
        await recordAudit(
          {
            actor: currentUser(req),
            eventType: 'USER_UPDATED',
            targetType: 'USER',
            targetId: user.id,
            targetLabel: user.email,
            summary: `User ${user.email}: ${body.role !== undefined ? `role ${existing.role} → ${body.role}` : ''}${body.role !== undefined && body.isActive !== undefined ? '; ' : ''}${body.isActive !== undefined ? `active ${existing.isActive} → ${body.isActive}` : ''}.`,
            meta: { role: body.role, isActive: body.isActive },
          },
          tx,
        );
        return user;
      });
      res.json({ user: updated });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
