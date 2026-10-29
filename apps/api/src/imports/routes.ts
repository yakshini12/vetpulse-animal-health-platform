import { Router, type NextFunction, type Request } from 'express';
import type { Prisma, ResultStatus, SampleStatus, SampleType } from '@prisma/client';
import multer from 'multer';
import { prisma } from '../db.js';
import { currentUser, requireAuth } from '../auth/middleware.js';
import { AppError, badRequest, conflict, notFound } from '../errors.js';
import { config } from '../config.js';
import { recordAudit } from '../audit/auditService.js';
import { listQuerySchema, paginated } from '../utils/listing.js';
import { parseWith } from '../middleware/validate.js';
import {
  applyDatabaseChecks,
  runPythonValidator,
  type ReportRow,
  type ValidationReport,
} from './validator.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
});

function requireCsvFile(req: Request): Express.Multer.File {
  const file = (req.file ?? undefined) as Express.Multer.File | undefined;
  if (!file) throw badRequest('Attach a CSV file in the "file" form field.');
  if (!file.originalname.toLowerCase().endsWith('.csv')) {
    throw badRequest('Only .csv files are accepted.');
  }
  if (file.size === 0) throw badRequest('The uploaded CSV file is empty.');
  return file;
}

function dbLookups() {
  return {
    async sample(codes: string[]): Promise<Set<string>> {
      const found = await prisma.sample.findMany({ where: { sampleCode: { in: codes } }, select: { sampleCode: true } });
      return new Set(found.map((row) => row.sampleCode));
    },
    async cases(numbers: string[]): Promise<Set<string>> {
      const found = await prisma.animalCase.findMany({ where: { caseNumber: { in: numbers } }, select: { caseNumber: true } });
      return new Set(found.map((row) => row.caseNumber));
    },
  };
}

function publicBatch(batch: { id: string; fileName: string; status: string; createdAt: Date; committedAt: Date | null; validRows: number; rejectedRows: number; duplicateRows: number; insertedRows: number; totalRows: number }) {
  return {
    id: batch.id,
    fileName: batch.fileName,
    status: batch.status,
    createdAt: batch.createdAt,
    committedAt: batch.committedAt,
    counts: {
      total: batch.totalRows,
      valid: batch.validRows,
      rejected: batch.rejectedRows,
      duplicates: batch.duplicateRows,
      inserted: batch.insertedRows,
    },
  };
}

/** Maps a validated CSV row (snake_case python dict) to a Sample insert payload. */
function rowToSampleData(row: ReportRow, caseIdByNumber: Map<string, string>) {
  const read = (key: string): string => row.data[key] ?? '';
  const iso = (value: string): Date | null => (value ? new Date(`${value}T00:00:00.000Z`) : null);
  return {
    sampleCode: read('sample_code'),
    caseId: caseIdByNumber.get(read('case_number')) as string, // presence re-verified inside the transaction
    // Enum value and chronology were validated by the python service; the
    // casts satisfy the Prisma enum union types at the create boundary.
    sampleType: read('sample_type') as SampleType,
    collectionDate: iso(read('collection_date')) as Date, // python guarantees a parsed calendar date
    status: read('status') as SampleStatus,
    labLocation: read('lab_location'),
    receivedAt: iso(read('received_date')),
    processingStartedAt: iso(read('processing_started_date')),
    completedAt: iso(read('completed_date')),
    rejectedAt: iso(read('rejected_date')),
    rejectionReason: read('rejection_reason') || null,
    resultStatus: (read('result_status') || 'NOT_AVAILABLE') as ResultStatus,
    resultSummary: read('result_summary') || null,
    notes: read('notes') || null,
  };
}

export function importRouter(): Router {
  const router = Router();
  router.use('/imports', requireAuth);

  router.get('/imports', async (req, res, next: NextFunction) => {
    try {
      const query = parseWith(listQuerySchema(['createdAt'] as const), req.query);
      const [items, total] = await prisma.$transaction([
        prisma.importBatch.findMany({
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          orderBy: { createdAt: query.order },
          include: { createdBy: { select: { id: true, name: true } } },
        }),
        prisma.importBatch.count({}),
      ]);
      res.json(
        paginated(
          items.map((batch) => ({ ...publicBatch(batch), createdByName: batch.createdBy.name })),
          total,
          query,
        ),
      );
    } catch (err) {
      next(err);
    }
  });

  router.get('/imports/:id', async (req, res, next) => {
    try {
      const batch = await prisma.importBatch.findUnique({
        where: { id: req.params.id },
        include: { createdBy: { select: { id: true, name: true } } },
      });
      if (!batch) throw notFound('Import batch not found.');
      res.json({
        import: { ...publicBatch(batch), createdByName: batch.createdBy.name },
        report: batch.report,
      });
    } catch (err) {
      next(err);
    }
  });

  // ---------- PREVIEW: validate only, no sample rows are written ----------
  router.post('/imports/preview', upload.single('file'), async (req, res, next) => {
    try {
      const file = requireCsvFile(req);
      const report = await runPythonValidator(file.buffer, file.originalname);
      await applyDatabaseChecks(report, dbLookups());

      const batch = await prisma.$transaction(async (tx) => {
        const created = await tx.importBatch.create({
          data: {
            fileName: file.originalname,
            status: 'PREVIEWED',
            totalRows: report.summary.totalRows,
            validRows: report.summary.valid,
            rejectedRows: report.summary.rejected,
            duplicateRows: report.summary.duplicates,
            report: report as unknown as Prisma.InputJsonObject,
            createdById: currentUser(req).id,
          },
        });
        await recordAudit(
          {
            actor: currentUser(req),
            eventType: 'IMPORT_PREVIEWED',
            targetType: 'IMPORT_BATCH',
            targetId: created.id,
            targetLabel: file.originalname,
            summary: `CSV preview of ${file.originalname}: ${report.summary.valid} valid, ${report.summary.rejected} rejected, ${report.summary.duplicates} duplicate of ${report.summary.totalRows} rows.`,
            meta: { summary: report.summary },
          },
          tx,
        );
        return created;
      });
      res.status(201).json({ import: publicBatch(batch), report });
    } catch (err) {
      next(err);
    }
  });

  // ---------- COMMIT: single transaction inserts the valid rows atomically ----------
  router.post('/imports/:id/commit', async (req, res, next) => {
    try {
      const batch = await prisma.importBatch.findUnique({ where: { id: req.params.id } });
      if (!batch) throw notFound('Import batch not found.');
      if (batch.status === 'COMMITTED') throw conflict('This import was already committed.');
      if (batch.status !== 'PREVIEWED') {
        throw conflict(`Only PREVIEWED imports can be committed (current status: ${batch.status}). Re-run the preview.`);
      }
      const report = batch.report as unknown as ValidationReport;
      const validRows = report.rows.filter((row) => row.outcome === 'VALID');
      if (validRows.length === 0) {
        throw conflict('This import has no valid rows to insert.');
      }

      try {
        const inserted = await prisma.$transaction(async (tx) => {
          // Re-resolve case references inside the transaction: a case deleted
          // between preview and commit would otherwise create orphan rows.
          const cases = await tx.animalCase.findMany({
            where: { caseNumber: { in: [...new Set(validRows.map((row) => row.data.case_number ?? ''))] } },
            select: { id: true, caseNumber: true },
          });
          const caseIdByNumber = new Map(cases.map((entry) => [entry.caseNumber, entry.id]));
          const missing = validRows.filter((row) => !caseIdByNumber.has(row.data.case_number ?? ''));
          if (missing.length > 0) {
            const firstMissing = missing[0];
            throw conflict(
              `The case referenced by ${missing.length} row(s) no longer exists (${firstMissing?.data.case_number ?? 'unknown'}${missing.length > 1 ? ', ...' : ''}).`,
            );
          }
          const result = await tx.sample.createMany({
            data: validRows.map((row) => rowToSampleData(row, caseIdByNumber)),
            skipDuplicates: false,
          });
          await tx.importBatch.update({
            where: { id: batch.id },
            data: {
              status: 'COMMITTED',
              insertedRows: result.count,
              committedAt: new Date(),
            },
          });
          await recordAudit(
            {
              actor: currentUser(req),
              eventType: 'IMPORT_COMMITTED',
              targetType: 'IMPORT_BATCH',
              targetId: batch.id,
              targetLabel: batch.fileName,
              summary: `Imported ${result.count} samples from ${batch.fileName} (${report.summary.rejected} rejected, ${report.summary.duplicates} duplicate).`,
              meta: { inserted: result.count, ...report.summary },
            },
            tx,
          );
          return result.count;
        });
        res.json({
          import: publicBatch(await prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } })),
          inserted,
        });
      } catch (txError) {
        // The sample inserts AND the batch status update rolled back together;
        // record the failure outside the failed transaction and surface a safe message.
        if (txError instanceof AppError) {
          await markFailed(batch.id, currentUser(req), batch.fileName, txError.message);
          throw txError;
        }
        await markFailed(batch.id, currentUser(req), batch.fileName, 'Database error during import commit.');
        throw new AppError(503, 'DATABASE_UNAVAILABLE', 'The import failed at the database level. Nothing was inserted. Data integrity preserved.');
      }
    } catch (err) {
      next(err);
    }
  });

  async function markFailed(batchId: string, actor: { id: string; name: string; email: string; role: 'ADMIN' | 'STAFF' }, fileName: string, reason: string): Promise<void> {
    await prisma.importBatch.update({
      where: { id: batchId },
      data: { status: 'COMMIT_FAILED', committedAt: null },
    });
    await recordAudit({
      actor,
      eventType: 'IMPORT_COMMIT_FAILED',
      targetType: 'IMPORT_BATCH',
      targetId: batchId,
      targetLabel: fileName,
      summary: `Commit failed for ${fileName}: ${reason}`,
    });
  }

  return router;
}

export type { ValidationReport };
