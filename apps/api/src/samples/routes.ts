import { z } from 'zod';
import { Router } from 'express';
import { Prisma, ResultStatus, SampleStatus, SampleType } from '@prisma/client';
import { prisma } from '../db.js';
import { currentUser, requireAuth } from '../auth/middleware.js';
import { parseWith } from '../middleware/validate.js';
import { AppError, notFound } from '../errors.js';
import { recordAudit } from '../audit/auditService.js';
import { containsLiteral, listQuerySchema, paginated } from '../utils/listing.js';

/**
 * Documented sample processing transitions (enforced server-side).
 * Each allowed transition sets the matching timestamp on arrival.
 * COMPLETED and REJECTED are terminal; a completed sample can never be rejected.
 */
export const SAMPLE_TRANSITIONS: Record<SampleStatus, SampleStatus[]> = {
  RECEIVED: ['IN_PROCESS'],
  IN_PROCESS: ['IN_REVIEW', 'REJECTED'],
  IN_REVIEW: ['COMPLETED', 'REJECTED'],
  COMPLETED: [],
  REJECTED: [],
};

export const SAMPLE_TYPE_VALUES = Object.values(SampleType);
export const RESULT_STATUS_VALUES = Object.values(ResultStatus);

const sampleCreateSchema = z.object({
  caseId: z.string().cuid(),
  sampleType: z.nativeEnum(SampleType),
  collectionDate: z.coerce.date(),
  labLocation: z.string().trim().min(2).max(80),
  resultStatus: z
    .nativeEnum(ResultStatus)
    .default('NOT_AVAILABLE')
    .refine((value) => value === 'NOT_AVAILABLE', 'New samples must start without a result.'),
  notes: z.string().trim().max(1000).optional(),
});

const sampleUpdateSchema = z.object({
  sampleType: z.nativeEnum(SampleType).optional(),
  collectionDate: z.coerce.date().optional(),
  labLocation: z.string().trim().min(2).max(80).optional(),
  notes: z.string().trim().max(1000).optional(),
  caseId: z.string().cuid().optional(),
});

const transitionSchema = z.object({
  to: z.nativeEnum(SampleStatus),
  rejectionReason: z.string().trim().min(5, 'A rejection requires a reason (min 5 characters).').max(500).optional(),
});

const resultSetSchema = z
  .object({
    resultStatus: z.nativeEnum(ResultStatus).optional(),
    resultSummary: z.string().trim().max(1000).optional(),
  });

const sampleListSchema = listQuerySchema(['createdAt', 'collectionDate', 'sampleCode', 'status'] as const).extend({
  status: z.nativeEnum(SampleStatus).optional(),
  sampleType: z.nativeEnum(SampleType).optional(),
  resultStatus: z.nativeEnum(ResultStatus).optional(),
  caseId: z.string().cuid().optional(),
});

export function sampleRouter(): Router {
  const router = Router();
  router.use('/samples', requireAuth);

  router.get('/samples', async (req, res, next) => {
    try {
      const query = parseWith(sampleListSchema, req.query);
      const where: Prisma.SampleWhereInput = {
        status: query.status,
        sampleType: query.sampleType,
        resultStatus: query.resultStatus,
        caseId: query.caseId,
      };
      if (query.search) {
        const needle = containsLiteral(query.search);
        where.OR = [
          { sampleCode: { contains: needle, mode: 'insensitive' } },
          { labLocation: { contains: needle, mode: 'insensitive' } },
          { case: { caseNumber: { contains: needle, mode: 'insensitive' } } },
          { notes: { contains: needle, mode: 'insensitive' } },
        ];
      }
      const sortable = new Map<string, Prisma.SampleOrderByWithRelationInput>([
        ['createdAt', { createdAt: query.order }],
        ['collectionDate', { collectionDate: query.order }],
        ['sampleCode', { sampleCode: query.order }],
        ['status', { status: query.order }],
      ]);
      const [items, total] = await prisma.$transaction([
        prisma.sample.findMany({
          where,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          orderBy: sortable.get(query.sort ?? 'createdAt'),
          include: { case: { select: { id: true, caseNumber: true, title: true, species: true } } },
        }),
        prisma.sample.count({ where }),
      ]);
      res.json(paginated(items, total, query));
    } catch (err) {
      next(err);
    }
  });

  router.get('/samples/:id', async (req, res, next) => {
    try {
      const sample = await prisma.sample.findUnique({
        where: { id: req.params.id },
        include: {
          case: { select: { id: true, caseNumber: true, title: true, species: true, priority: true, status: true } },
          tasks: { orderBy: { dueDate: 'asc' }, include: { assignee: { select: { id: true, name: true } } } },
        },
      });
      if (!sample) throw notFound('Sample not found.');
      const audit = await prisma.auditEvent.findMany({
        where: { targetType: 'SAMPLE', targetId: sample.id },
        orderBy: { createdAt: 'desc' },
        take: 25,
      });
      res.json({ sample, audit });
    } catch (err) {
      next(err);
    }
  });

  router.post('/samples', async (req, res, next) => {
    try {
      const body = parseWith(sampleCreateSchema, req.body);
      const parent = await prisma.animalCase.findUnique({ where: { id: body.caseId } });
      if (!parent) throw notFound('Case not found — samples must reference an existing case.');
      if (body.collectionDate > new Date()) {
        throw new AppError(400, 'BAD_REQUEST', 'Collection date cannot be in the future.');
      }

      const created = await prisma.$transaction(async (tx) => {
        const year = new Date().getUTCFullYear();
        const prefix = `SP-${year}-`;
        const count = await tx.sample.count({ where: { sampleCode: { startsWith: prefix } } });
        const sampleCode = `SP-${year}-${String(count + 1).padStart(4, '0')}`;
        const sample = await tx.sample.create({
          data: {
            sampleCode,
            caseId: parent.id,
            sampleType: body.sampleType,
            collectionDate: body.collectionDate,
            status: 'RECEIVED',
            receivedAt: new Date(),
            labLocation: body.labLocation,
            resultStatus: 'NOT_AVAILABLE',
            notes: body.notes ?? null,
          },
        });
        await recordAudit(
          {
            actor: currentUser(req),
            eventType: 'SAMPLE_CREATED',
            targetType: 'SAMPLE',
            targetId: sample.id,
            targetLabel: sample.sampleCode,
            summary: `Sample ${sample.sampleCode} (${body.sampleType}) registered against case ${parent.caseNumber}.`,
            meta: { caseNumber: parent.caseNumber, sampleType: body.sampleType, source: 'MANUAL' },
          },
          tx,
        );
        return sample;
      });
      res.status(201).json({ sample: created });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/samples/:id', async (req, res, next) => {
    try {
      const existing = await prisma.sample.findUnique({ where: { id: req.params.id } });
      if (!existing) throw notFound('Sample not found.');
      const body = parseWith(sampleUpdateSchema, req.body);
      const locked = existing.status !== 'RECEIVED' && existing.status !== 'IN_PROCESS';
      if (locked && Object.keys(body).length > 0) {
        throw new AppError(
          409,
          'RECORD_LOCKED',
          `Sample metadata is locked once processing has reached ${existing.status}. Only RECEIVED and IN_PROCESS samples can be edited.`,
        );
      }
      if (body.caseId !== undefined) {
        const parent = await prisma.animalCase.findUnique({ where: { id: body.caseId } });
        if (!parent) throw notFound('Case not found — the new case must exist.');
      }
      if (body.collectionDate && body.collectionDate > new Date()) {
        throw new AppError(400, 'BAD_REQUEST', 'Collection date cannot be in the future.');
      }

      const updated = await prisma.$transaction(async (tx) => {
        const record = await tx.sample.update({
          where: { id: existing.id },
          data: {
            ...(body.sampleType !== undefined && { sampleType: body.sampleType }),
            ...(body.collectionDate !== undefined && { collectionDate: body.collectionDate }),
            ...(body.labLocation !== undefined && { labLocation: body.labLocation }),
            ...(body.notes !== undefined && { notes: body.notes }),
            ...(body.caseId !== undefined && { caseId: body.caseId }),
          },
        });
        const changed = Object.keys(body).join(', ') || 'none';
        await recordAudit(
          {
            actor: currentUser(req),
            eventType: 'SAMPLE_UPDATED',
            targetType: 'SAMPLE',
            targetId: existing.id,
            targetLabel: existing.sampleCode,
            summary: `Sample ${existing.sampleCode} updated (fields: ${changed}).`,
            meta: { fields: Object.keys(body) },
          },
          tx,
        );
        return record;
      });
      res.json({ sample: updated });
    } catch (err) {
      next(err);
    }
  });

  router.post('/samples/:id/transition', async (req, res, next) => {
    try {
      const existing = await prisma.sample.findUnique({
        where: { id: req.params.id },
        include: { case: { select: { caseNumber: true } } },
      });
      if (!existing) throw notFound('Sample not found.');
      const body = parseWith(transitionSchema, req.body);

      const allowed = SAMPLE_TRANSITIONS[existing.status];
      if (!allowed.includes(body.to)) {
        throw new AppError(
          409,
          'INVALID_TRANSITION',
          `Cannot move a sample from ${existing.status} to ${body.to}. Allowed transitions: ${allowed.join(', ') || 'none'}.`,
        );
      }
      if (body.to === 'REJECTED' && !body.rejectionReason) {
        throw new AppError(400, 'BAD_REQUEST', 'A rejection requires a rejection reason.');
      }
      const now = new Date();
      const updated = await prisma.$transaction(async (tx) => {
        const record = await tx.sample.update({
          where: { id: existing.id },
          data: {
            status: body.to,
            ...(body.to === 'IN_PROCESS' && { processingStartedAt: now }),
            ...(body.to === 'COMPLETED' && { completedAt: now }),
            ...(body.to === 'REJECTED' && { rejectedAt: now, rejectionReason: body.rejectionReason }),
          },
        });
        await recordAudit(
          {
            actor: currentUser(req),
            eventType: 'SAMPLE_TRANSITION',
            targetType: 'SAMPLE',
            targetId: existing.id,
            targetLabel: existing.sampleCode,
            summary: `Sample ${existing.sampleCode}: ${existing.status} → ${body.to}.`,
            meta: { from: existing.status, to: body.to, caseNumber: existing.case.caseNumber },
          },
          tx,
        );
        return record;
      });
      res.json({ sample: updated });
    } catch (err) {
      next(err);
    }
  });

  router.post('/samples/:id/result', async (req, res, next) => {
    try {
      const existing = await prisma.sample.findUnique({ where: { id: req.params.id } });
      if (!existing) throw notFound('Sample not found.');
      const body = parseWith(resultSetSchema, req.body);
      const resultStatus = body.resultStatus === undefined ? existing.resultStatus : body.resultStatus;
      const resultSummary = body.resultSummary === undefined ? existing.resultSummary : body.resultSummary;

      if (!['IN_REVIEW', 'COMPLETED'].includes(existing.status)) {
        throw new AppError(409, 'CONFLICT', `Results can only be recorded for IN_REVIEW or COMPLETED samples (current: ${existing.status}).`);
      }
      if (resultStatus === 'RELEASED') {
        if (existing.status !== 'COMPLETED') {
          throw new AppError(409, 'CONFLICT', 'Results can only be released after the sample is COMPLETED.');
        }
        if (!resultSummary?.trim()) {
          throw new AppError(400, 'BAD_REQUEST', 'Releasing a result requires a result summary.');
        }
      }
      const updated = await prisma.$transaction(async (tx) => {
        const record = await tx.sample.update({
          where: { id: existing.id },
          data: {
            resultStatus,
            resultSummary: resultStatus === 'NOT_AVAILABLE' ? null : resultSummary,
          },
        });
        await recordAudit(
          {
            actor: currentUser(req),
            eventType: 'SAMPLE_RESULT_SET',
            targetType: 'SAMPLE',
            targetId: existing.id,
            targetLabel: existing.sampleCode,
            summary: `Sample ${existing.sampleCode}: result status ${existing.resultStatus} → ${resultStatus}.`,
            meta: { from: existing.resultStatus, to: resultStatus },
          },
          tx,
        );
        return record;
      });
      res.json({ sample: updated });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/**
 * The data-quality definition used by both the dashboard metric and the
 * "includeInvalid" filter. A sample is flagged when any of these match:
 * 1. collectionDate is in the future
 * 2. receivedAt is missing
 * 3. status is COMPLETED but completedAt is missing
 * 4. status is REJECTED but rejectedAt or rejectionReason is missing
 * 5. resultStatus is RELEASED while the sample is not COMPLETED
 * 6. resultStatus is RELEASED but resultSummary is missing
 */
export function buildInvalidQualityConditions(now: Date): Prisma.SampleWhereInput[] {
  return [
    { collectionDate: { gt: now } },
    { receivedAt: null },
    { status: 'COMPLETED', completedAt: null },
    { status: 'REJECTED', OR: [{ rejectedAt: null }, { rejectionReason: null }] },
    { resultStatus: 'RELEASED', status: { not: 'COMPLETED' } },
    { resultStatus: 'RELEASED', resultSummary: null },
  ];
}
