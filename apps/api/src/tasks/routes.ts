import { z } from 'zod';
import { Router } from 'express';
import { Prisma, TaskPriority, TaskStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { currentUser, requireAuth } from '../auth/middleware.js';
import { parseWith } from '../middleware/validate.js';
import { AppError, notFound } from '../errors.js';
import { recordAudit } from '../audit/auditService.js';
import { containsLiteral, listQuerySchema, paginated } from '../utils/listing.js';

export const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  TODO: ['IN_PROGRESS', 'DONE', 'CANCELLED'],
  IN_PROGRESS: ['DONE', 'CANCELLED', 'TODO'],
  DONE: ['TODO'],
  CANCELLED: [],
};

const TASK_PRIORITY_RANK: Record<TaskPriority, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

const taskCreateSchema = z.object({
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().max(2000).optional().nullable(),
  priority: z.nativeEnum(TaskPriority).default('MEDIUM'),
  dueDate: z.coerce.date(),
  caseId: z.string().cuid().optional().nullable(),
  sampleId: z.string().cuid().optional().nullable(),
  assigneeId: z.string().cuid().optional().nullable(),
});

const taskUpdateSchema = taskCreateSchema.partial().extend({
  status: z.nativeEnum(TaskStatus).optional(),
});

const taskListSchema = listQuerySchema(['dueDate', 'createdAt', 'priorityRank', 'title', 'status'] as const).extend({
  status: z.nativeEnum(TaskStatus).optional(),
  assigneeId: z.string().cuid().optional(),
  assignee: z.string().trim().max(64).optional(), // partial name match
  caseId: z.string().cuid().optional(),
  sampleId: z.string().cuid().optional(),
  overdue: z.enum(['true']).optional(),
  dueBefore: z.coerce.date().optional(),
  linked: z.enum(['case', 'sample', 'none']).optional(),
});

async function assertRef(value: string | null | undefined, kind: 'case' | 'sample' | 'user'): Promise<void> {
  if (!value) return;
  if (kind === 'case') {
    const found = await prisma.animalCase.findUnique({ where: { id: value }, select: { id: true } });
    if (!found) throw new AppError(409, 'CONFLICT', 'The referenced case does not exist.');
    return;
  }
  if (kind === 'sample') {
    const found = await prisma.sample.findUnique({ where: { id: value }, select: { id: true } });
    if (!found) throw new AppError(409, 'CONFLICT', 'The referenced sample does not exist.');
    return;
  }
  const found = await prisma.user.findUnique({ where: { id: value }, select: { id: true, isActive: true } });
  if (!found || !found.isActive) throw new AppError(409, 'CONFLICT', 'The assigned staff member does not exist or is inactive.');
}

export function taskRouter(): Router {
  const router = Router();
  router.use('/tasks', requireAuth);

  router.get('/tasks', async (req, res, next) => {
    try {
      const query = parseWith(taskListSchema, req.query);
      const where: Prisma.TaskWhereInput = {
        status: query.status,
        assigneeId: query.assigneeId,
        caseId: query.caseId,
        sampleId: query.sampleId,
        ...(query.dueBefore !== undefined && { dueDate: { lt: query.dueBefore } }),
        ...(query.linked === 'case' && { caseId: { not: null } }),
        ...(query.linked === 'sample' && { sampleId: { not: null } }),
        ...(query.linked === 'none' && { caseId: null, sampleId: null }),
      };
      if (query.assignee !== undefined) {
        where.assignee = { name: { contains: query.assignee, mode: 'insensitive' } };
      }
      if (query.overdue === 'true') {
        where.dueDate = { lt: new Date() };
        where.status = { in: ['TODO', 'IN_PROGRESS'] };
      }
      if (query.search) {
        const needle = containsLiteral(query.search);
        where.OR = [
          { title: { contains: needle, mode: 'insensitive' } },
          { description: { contains: needle, mode: 'insensitive' } },
        ];
      }
      const sortable = new Map<string, Prisma.TaskOrderByWithRelationInput>([
        ['dueDate', { dueDate: query.order }],
        ['createdAt', { createdAt: query.order }],
        ['title', { title: query.order }],
        ['status', { status: query.order }],
        ['priorityRank', { priorityRank: query.order }],
      ]);
      const [items, total] = await prisma.$transaction([
        prisma.task.findMany({
          where,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          orderBy: sortable.get(query.sort ?? 'dueDate'),
          include: {
            assignee: { select: { id: true, name: true } },
            case: { select: { id: true, caseNumber: true, title: true } },
            sample: { select: { id: true, sampleCode: true } },
          },
        }),
        prisma.task.count({ where }),
      ]);
      res.json(paginated(addOverdueFlag(items), total, query));
    } catch (err) {
      next(err);
    }
  });

  router.post('/tasks', async (req, res, next) => {
    try {
      const body = parseWith(taskCreateSchema, req.body);
      await assertRef(body.caseId, 'case');
      await assertRef(body.sampleId, 'sample');
      await assertRef(body.assigneeId, 'user');
      const created = await prisma.task.create({
        data: {
          title: body.title,
          description: body.description ?? null,
          priority: body.priority,
          priorityRank: TASK_PRIORITY_RANK[body.priority],
          dueDate: body.dueDate,
          caseId: body.caseId ?? null,
          sampleId: body.sampleId ?? null,
          assigneeId: body.assigneeId ?? null,
        },
      });
      await recordAudit({
        actor: currentUser(req),
        eventType: 'TASK_CREATED',
        targetType: 'TASK',
        targetId: created.id,
        targetLabel: created.title,
        summary: `Task "${created.title}" created (due ${created.dueDate.toISOString().slice(0, 10)}).`,
        meta: { priority: created.priority, assigneeId: created.assigneeId, caseId: created.caseId, sampleId: created.sampleId },
      });
      res.status(201).json({ task: created });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/tasks/:id', async (req, res, next) => {
    try {
      const existing = await prisma.task.findUnique({ where: { id: req.params.id } });
      if (!existing) throw notFound('Task not found.');
      const body = parseWith(taskUpdateSchema, req.body);
      await assertRef(body.assigneeId, 'user');
      if (body.caseId !== undefined && body.caseId !== null) await assertRef(body.caseId, 'case');
      if (body.sampleId !== undefined && body.sampleId !== null) await assertRef(body.sampleId, 'sample');

      let completedAt: Date | null = null;
      if (body.status && body.status !== existing.status) {
        const allowed = TASK_TRANSITIONS[existing.status];
        if (!allowed.includes(body.status)) {
          throw new AppError(409, 'INVALID_TRANSITION', `Cannot move a task from ${existing.status} to ${body.status}. Allowed: ${allowed.join(', ') || 'none'}.`);
        }
        completedAt = body.status === 'DONE' ? new Date() : null;
      }
      const updated = await prisma.$transaction(async (tx) => {
        const record = await tx.task.update({
          where: { id: existing.id },
          data: {
            ...(body.title !== undefined && { title: body.title }),
            ...(body.description !== undefined && { description: body.description }),
            ...(body.priority !== undefined && { priority: body.priority, priorityRank: TASK_PRIORITY_RANK[body.priority] }),
            ...(body.dueDate !== undefined && { dueDate: body.dueDate }),
            ...(body.caseId !== undefined && { caseId: body.caseId }),
            ...(body.sampleId !== undefined && { sampleId: body.sampleId }),
            ...(body.assigneeId !== undefined && { assigneeId: body.assigneeId }),
            ...(body.status !== undefined && { status: body.status, completedAt }),
          },
        });
        if (body.assigneeId !== undefined && body.assigneeId !== existing.assigneeId) {
          await recordAudit(
            {
              actor: currentUser(req),
              eventType: 'TASK_REASSIGNED',
              targetType: 'TASK',
              targetId: existing.id,
              targetLabel: existing.title,
              summary: `Task "${existing.title}" assigned to ${body.assigneeId ? 'a staff member' : 'nobody'}.`,
              meta: { from: existing.assigneeId, to: body.assigneeId ?? null },
            },
            tx,
          );
        }
        await recordAudit(
          body.status && body.status !== existing.status
            ? {
                actor: currentUser(req),
                eventType: body.status === 'DONE' ? 'TASK_COMPLETED' : 'TASK_STATUS_CHANGED',
                targetType: 'TASK',
                targetId: existing.id,
                targetLabel: existing.title,
                summary:
                  body.status === 'DONE'
                    ? `Task "${existing.title}" completed.`
                    : `Task "${existing.title}": ${existing.status} → ${body.status}.`,
                meta: { from: existing.status, to: body.status },
              }
            : {
                actor: currentUser(req),
                eventType: 'TASK_UPDATED',
                targetType: 'TASK',
                targetId: existing.id,
                targetLabel: existing.title,
                summary: `Task "${existing.title}" updated (fields: ${Object.keys(body).filter((k) => k !== 'assigneeId' && k !== 'status').join(', ') || 'none'}).`,
              },
          tx,
        );
        return record;
      });
      res.json({ task: updated });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

type TaskWithRelations = Prisma.TaskGetPayload<{
  include: { assignee: { select: { id: true; name: true } }; case: { select: { id: true; caseNumber: true; title: true } }; sample: { select: { id: true; sampleCode: true } } };
}>;

/** Overdue = due date in the past while still TODO or IN_PROGRESS. */
export function addOverdueFlag(tasks: TaskWithRelations[]): (TaskWithRelations & { isOverdue: boolean })[] {
  const now = Date.now();
  return tasks.map((task) => ({
    ...task,
    isOverdue:
      (task.status === 'TODO' || task.status === 'IN_PROGRESS') && task.dueDate.getTime() < now,
  }));
}
