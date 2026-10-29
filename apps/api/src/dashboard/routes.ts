import { Router, type NextFunction, type Request, type Response } from 'express';
import { type CaseStatus, type SampleStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { buildInvalidQualityConditions } from '../samples/routes.js';

/**
 * All dashboard figures come from database aggregation on each request.
 * Empty datasets return zeros / null rather than invented values, and
 * the raw SQL rounds the turnaround average to one decimal.
 */
export function dashboardRouter(): Router {
  const router = Router();
  router.get('/dashboard/summary', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const now = new Date();
      const volumeSince = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const [caseCounts, sampleCounts, invalidSamples, openTasks, dueSoonTasks, recentActivity, workload, volumeRows, turnaroundRows] =
        await prisma.$transaction([
          prisma.animalCase.groupBy({
            by: ['status'],
            orderBy: [{ status: 'asc' }],
            _count: { _all: true },
          }),
          prisma.sample.groupBy({
            by: ['status'],
            orderBy: [{ status: 'asc' }],
            _count: { _all: true },
          }),
          prisma.sample.count({ where: { OR: buildInvalidQualityConditions(now) } }),
          prisma.task.count({ where: { status: { in: ['TODO', 'IN_PROGRESS'] } } }),
          prisma.task.findMany({
            where: {
              status: { in: ['TODO', 'IN_PROGRESS'] },
              dueDate: { gte: now, lte: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000) },
            },
            orderBy: { dueDate: 'asc' },
            take: 5,
            include: { assignee: { select: { name: true } }, case: { select: { caseNumber: true } } },
          }),
          prisma.auditEvent.findMany({
            orderBy: { createdAt: 'desc' },
            take: 10,
            include: { actor: { select: { name: true } } },
          }),
          prisma.$queryRaw<
            { id: string; name: string; role: string; open_tasks: bigint; open_cases: bigint; active_samples: bigint }[]
          >`
            SELECT u.id, u.name, u.role::text AS role,
              (SELECT COUNT(*) FROM "Task" t
                WHERE t."assigneeId" = u.id AND t.status IN ('TODO', 'IN_PROGRESS')) AS open_tasks,
              (SELECT COUNT(*) FROM "AnimalCase" c
                WHERE c."assignedToId" = u.id AND c.status IN ('OPEN', 'IN_PROGRESS')) AS open_cases,
              (SELECT COUNT(*) FROM "Sample" s
                JOIN "AnimalCase" c2 ON c2.id = s."caseId"
                WHERE c2."assignedToId" = u.id AND s.status IN ('RECEIVED', 'IN_PROCESS', 'IN_REVIEW')) AS active_samples
            FROM "User" u
            WHERE u."isActive" = true
            ORDER BY open_tasks DESC, open_cases DESC, u.name ASC
          `,
          prisma.$queryRaw<{ day: Date; count: bigint }[]>`
            SELECT date_trunc('day', "createdAt") AS day, COUNT(*) AS COUNT
            FROM "AnimalCase"
            WHERE "createdAt" >= ${volumeSince}
            GROUP BY day
            ORDER BY day ASC
          `,
          prisma.$queryRaw<{ avg_hours: number | null; completed: bigint }[]>`
            SELECT ROUND(AVG(EXTRACT(EPOCH FROM ("completedAt" - "receivedAt"))) / 3600.0, 1) AS avg_hours,
                   COUNT(*) AS completed
            FROM "Sample"
            WHERE status = 'COMPLETED' AND "completedAt" IS NOT NULL AND "receivedAt" IS NOT NULL
          `,
        ]);

      const caseStatuses = Object.fromEntries(
        (['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const).map((status) => [status, 0]),
      ) as Record<CaseStatus, number>;
      for (const row of caseCounts) {
        caseStatuses[row.status] = Number((row._count as { _all?: number })?._all ?? 0);
      }

      const sampleStatuses = Object.fromEntries(
        (['RECEIVED', 'IN_PROCESS', 'IN_REVIEW', 'COMPLETED', 'REJECTED'] as const).map((status) => [status, 0]),
      ) as Record<SampleStatus, number>;
      for (const row of sampleCounts) {
        sampleStatuses[row.status] = Number((row._count as { _all?: number })?._all ?? 0);
      }

      // Fill all 30 days so charts never contain artificial gaps.
      const volumeMap = new Map(volumeRows.map((row) => [row.day.toISOString().slice(0, 10), Number(row.count)]));
      const caseVolume: { day: string; count: number }[] = [];
      for (let offset = 29; offset >= 0; offset -= 1) {
        const day = new Date(now.getTime() - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        caseVolume.push({ day, count: volumeMap.get(day) ?? 0 });
      }

        const turnaroundRow = turnaroundRows[0];
        const avgHours = turnaroundRow?.avg_hours === null || turnaroundRow === undefined ? null : Number(turnaroundRow.avg_hours);
        res.json({
        cases: {
          total: Object.values(caseStatuses).reduce((a, b) => a + b, 0),
          byStatus: caseStatuses,
        },
        samples: {
          total: Object.values(sampleStatuses).reduce((a, b) => a + b, 0),
          byStatus: sampleStatuses,
          awaitingProcessing: sampleStatuses.RECEIVED,
          invalidMetadata: invalidSamples,
        },
        avgTurnaroundHours: avgHours,
        completedSamplesWithTurnaround: Number(turnaroundRow?.completed ?? 0),
        caseVolume,
        workload: workload.map((row) => ({
          id: row.id,
          name: row.name,
          role: row.role,
          openTasks: Number(row.open_tasks),
          openCases: Number(row.open_cases),
          activeSamples: Number(row.active_samples),
        })),
        dueSoonTasks: dueSoonTasks.map((task) => ({
          id: task.id,
          title: task.title,
          dueDate: task.dueDate,
          status: task.status,
          priorityRank: task.priorityRank,
          assignee: task.assignee?.name ?? null,
          caseNumber: task.case?.caseNumber ?? null,
        })),
        recentActivity: recentActivity.map((event) => ({
          id: event.id,
          eventType: event.eventType,
          targetType: event.targetType,
          targetLabel: event.targetLabel,
          summary: event.summary,
          actorName: event.actorName,
          createdAt: event.createdAt,
        })),
        openTasks,
      });
    } catch (err) {
      next(err);
    }
  });
  return router;
}
