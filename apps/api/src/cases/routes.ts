import { z } from 'zod';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { CasePriority, CaseStatus, Prisma, type AnimalCase } from '@prisma/client';
import { prisma } from '../db.js';
import { currentUser, requireAuth } from '../auth/middleware.js';
import { parseWith } from '../middleware/validate.js';
import { AppError, notFound } from '../errors.js';
import { recordAudit } from '../audit/auditService.js';
import { caseNumberFor } from '../utils/codes.js';
import { containsLiteral, listQuerySchema, paginated } from '../utils/listing.js';

/**
 * Documented case status transitions (enforced server-side).
 * CLOSED is terminal; reopening a resolved case returns it to IN_PROGRESS.
 */
export const CASE_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  OPEN: ['IN_PROGRESS', 'CLOSED'],
  IN_PROGRESS: ['RESOLVED', 'OPEN', 'CLOSED'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'],
  CLOSED: [],
};

export const PRIORITY_RANK: Record<CasePriority, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

const caseCreateSchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(160),
  species: z.string().trim().min(2).max(60),
  breed: z.string().trim().max(80).optional().nullable(),
  ageMonths: z.number().int().min(0).max(600).optional().nullable(),
  ownerRef: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^ORG-[A-Z0-9-]{1,60}$/, 'Use a pseudonymous organisation code like ORG-117 (no personal names).'),
  concern: z.string().trim().min(5).max(2000),
  priority: z.nativeEnum(CasePriority).default('MEDIUM'),
  assignedToId: z.string().cuid().optional().nullable(),
});

const caseUpdateSchema = caseCreateSchema.partial().extend({
  status: z.nativeEnum(CaseStatus).optional(),
});

const caseListSchema = listQuerySchema(['createdAt', 'updatedAt', 'priorityRank', 'caseNumber', 'title', 'status'] as const).extend({
  status: z.nativeEnum(CaseStatus).optional(),
  priority: z.nativeEnum(CasePriority).optional(),
  species: z.string().trim().max(60).optional(),
  assignedToId: z.string().cuid().optional(),
  closed: z.enum(['true', 'false']).optional(),
});

export async function assertAssigneeExists(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) {
    throw new AppError(409, 'CONFLICT', 'The assigned staff member does not exist or is inactive.');
  }
}

async function nextCaseNumber(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `CASE-${year}-`;
  const count = await tx.animalCase.count({ where: { caseNumber: { startsWith: prefix } } });
  return caseNumberFor(year, count + 1);
}

/** Creates a case with a sequential unique case number; retries on race with the unique constraint. */
export async function createCaseWithNumber(
  data: Omit<Prisma.AnimalCaseUncheckedCreateInput, 'caseNumber' | 'id'>,
): Promise<AnimalCase> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    try {
      return await prisma.$transaction(async (tx) => {
        const caseNumber = await nextCaseNumber(tx);
        return tx.animalCase.create({ data: { ...data, caseNumber } });
      });
    } catch (err) {
      const isUniqueRace = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
      if (!isUniqueRace) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

export function caseRouter(): Router {
  const router = Router();
  router.use('/cases', requireAuth);

  router.get('/cases', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = parseWith(caseListSchema, req.query);
      const where: Prisma.AnimalCaseWhereInput = {
        status: query.status,
        priority: query.priority,
        species: query.species,
        assignedToId: query.assignedToId,
        ...(query.closed === 'true' && { NOT: [{ status: 'CLOSED' }, { status: 'RESOLVED' }] }),
        ...(query.closed === 'false' && { OR: [{ status: 'CLOSED' }, { status: 'RESOLVED' }] }),
      };
      if (query.search) {
        const needle = containsLiteral(query.search);
        where.OR = [
          { title: { contains: needle, mode: 'insensitive' } },
          { caseNumber: { contains: needle, mode: 'insensitive' } },
          { ownerRef: { contains: needle, mode: 'insensitive' } },
          { concern: { contains: needle, mode: 'insensitive' } },
        ];
      }
      const sortable = new Map<string, Prisma.AnimalCaseOrderByWithRelationInput>([
        ['createdAt', { createdAt: query.order }],
        ['updatedAt', { updatedAt: query.order }],
        ['caseNumber', { caseNumber: query.order }],
        ['title', { title: query.order }],
        ['status', { status: query.order }],
        ['priorityRank', { priorityRank: query.order }],
      ]);
      const [items, total] = await prisma.$transaction([
        prisma.animalCase.findMany({
          where,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          orderBy: sortable.get(query.sort ?? 'createdAt'),
          include: { assignedTo: { select: { id: true, name: true } } },
        }),
        prisma.animalCase.count({ where }),
      ]);
      res.json(paginated(items, total, query));
    } catch (err) {
      next(err);
    }
  });

  router.get('/cases/:id', async (req, res, next) => {
    try {
      const record = await prisma.animalCase.findUnique({
        where: { id: req.params.id },
        include: {
          assignedTo: { select: { id: true, name: true, email: true } },
          samples: { orderBy: { createdAt: 'desc' }, take: 50 },
          tasks: {
            orderBy: { dueDate: 'asc' },
            take: 50,
            include: { assignee: { select: { id: true, name: true } } },
          },
        },
      });
      if (!record) throw notFound('Case not found.');
      const audit = await prisma.auditEvent.findMany({
        where: { targetType: 'CASE', targetId: record.id },
        orderBy: { createdAt: 'desc' },
        take: 25,
      });
      res.json({ case: record, audit });
    } catch (err) {
      next(err);
    }
  });

  router.post('/cases', async (req, res, next) => {
    try {
      const body = parseWith(caseCreateSchema, req.body);
      await assertAssigneeExists(body.assignedToId);
      const created = await createCaseWithNumber({
        title: body.title,
        species: body.species,
        breed: body.breed ?? null,
        ageMonths: body.ageMonths ?? null,
        ownerRef: body.ownerRef,
        concern: body.concern,
        priority: body.priority,
        priorityRank: PRIORITY_RANK[body.priority],
        assignedToId: body.assignedToId ?? null,
        status: 'OPEN',
      });
      await recordAudit({
        actor: currentUser(req),
        eventType: 'CASE_CREATED',
        targetType: 'CASE',
        targetId: created.id,
        targetLabel: created.caseNumber,
        summary: `Created case ${created.caseNumber} (${created.species}, ${created.priority} priority).`,
        meta: { title: created.title, species: created.species, priority: created.priority },
      });
      res.status(201).json({ case: created });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/cases/:id', async (req, res, next) => {
    try {
      const existing = await prisma.animalCase.findUnique({ where: { id: req.params.id } });
      if (!existing) throw notFound('Case not found.');
      const body = parseWith(caseUpdateSchema, req.body);

      let closedAt: Date | null = null;
      if (body.status && body.status !== existing.status) {
        const allowed = CASE_TRANSITIONS[existing.status];
        if (!allowed.includes(body.status)) {
          throw new AppError(409, 'INVALID_TRANSITION', `Cannot move a case from ${existing.status} to ${body.status}. Allowed: ${allowed.join(', ') || 'none'}.`);
        }
        closedAt = body.status === 'CLOSED' ? new Date() : null;
      }
      await assertAssigneeExists(body.assignedToId);

      const updated = await prisma.$transaction(async (tx) => {
        const record = await tx.animalCase.update({
          where: { id: existing.id },
          data: {
            ...(body.title !== undefined && { title: body.title }),
            ...(body.species !== undefined && { species: body.species }),
            ...(body.breed !== undefined && { breed: body.breed }),
            ...(body.ageMonths !== undefined && { ageMonths: body.ageMonths }),
            ...(body.ownerRef !== undefined && { ownerRef: body.ownerRef }),
            ...(body.concern !== undefined && { concern: body.concern }),
            ...(body.priority !== undefined && { priority: body.priority, priorityRank: PRIORITY_RANK[body.priority] }),
            ...(body.assignedToId !== undefined && { assignedToId: body.assignedToId }),
            ...(body.status !== undefined && { status: body.status, closedAt }),
          },
        });
        const changedFields = Object.keys(body).filter((key) => key !== 'status');
        await recordAudit(
          body.status && body.status !== existing.status
            ? {
                actor: currentUser(req),
                eventType: 'CASE_STATUS_CHANGED',
                targetType: 'CASE',
                targetId: existing.id,
                targetLabel: existing.caseNumber,
                summary: `Case ${existing.caseNumber}: ${existing.status} → ${body.status}${body.status === 'CLOSED' ? ' (closed)' : ''}.`,
                meta: { from: existing.status, to: body.status },
              }
            : {
                actor: currentUser(req),
                eventType: 'CASE_UPDATED',
                targetType: 'CASE',
                targetId: existing.id,
                targetLabel: existing.caseNumber,
                summary: `Case ${existing.caseNumber} updated (fields: ${changedFields.join(', ') || 'none'}).`,
              },
          tx,
        );
        return record;
      });
      res.json({ case: updated });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
