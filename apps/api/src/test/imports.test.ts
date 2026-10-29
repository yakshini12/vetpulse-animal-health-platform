import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { prisma } from '../db.js';
import { app, login, resetDb, year } from './helpers.js';


const staff = { email: 'staff@vetpulse.test', password: 'VetPulseTest#2026' };
let cookie: string;
const caseYear = year();

function example(name: string): string {
  return path.resolve(process.cwd(), '../../examples/csv', name);
}

async function seedParentCases(count: number): Promise<void> {
  for (let index = 1; index <= count; index += 1) {
    await prisma.animalCase.create({
      data: {
        caseNumber: `CASE-${caseYear}-${String(index).padStart(4, '0')}`,
        title: `Synthetic parent case ${index}`,
        species: 'Cattle',
        ownerRef: 'ORG-101',
        concern: 'Synthetic screening concern for CSV import tests',
      },
    });
  }
}

async function preview(file: string) {
  return request(app)
    .post('/api/imports/preview')
    .set('Cookie', cookie)
    .attach('file', fs.readFileSync(file), { filename: path.basename(file), contentType: 'text/csv' });
}

async function commit(id: string, status = 200) {
  const res = await request(app).post(`/api/imports/${id}/commit`).set('Cookie', cookie);
  expect(res.status).toBe(status);
  return res;
}

beforeEach(async () => {
  await resetDb();
  cookie = await login(staff);
});


describe('CSV preview (row-level + database-level validation)', () => {
  it('reports every valid row as importable and preview-only writes no samples', async () => {
    await seedParentCases(8);
    const res = await preview(example('samples_valid.csv'));
    expect(res.status).toBe(201);
    expect(res.body.report.summary).toEqual({ totalRows: 8, valid: 8, rejected: 0, duplicates: 0 });
    expect(res.body.import.status).toBe('PREVIEWED');
    expect(await prisma.sample.count()).toBe(0); // preview never writes rows
  });

  it('reports row numbers and machine-readable reasons for each rejection', async () => {
    await seedParentCases(8);
    const res = await preview(example('samples_invalid.csv'));
    expect(res.status).toBe(201);
    expect(res.body.report.summary.valid).toBe(0);
    expect(res.body.report.summary.rejected).toBe(8);

    const rows = res.body.report.rows as Array<{ row: number; errors: Array<{ code: string; field: string }> }>;
    expect(rows[0]!.row).toBe(2);
    const codes = new Set(rows.flatMap((entry) => entry.errors.map((error) => error.code)));
    expect(codes.has('VALUE')).toBe(true); // unsupported sample_type
    expect(codes.has('DATE')).toBe(true); // unparseable date
    expect(codes.has('FUTURE_DATE')).toBe(true); // collection date in the future
    expect(codes.has('CHRONOLOGY')).toBe(true); // rejected before processing started
    expect(codes.has('RULE')).toBe(true); // completed status without completed_date
  });

  it('marks duplicate rows within the same file', async () => {
    await seedParentCases(8);
    const res = await preview(example('samples_duplicate.csv'));
    expect(res.body.import.counts).toEqual({ total: 5, valid: 3, rejected: 0, duplicates: 2, inserted: 0 });
  });

  it('rejects rows whose case_number does not exist (database check)', async () => {
    const res = await preview(example('samples_valid.csv')); // no parent cases seeded
    const rows = res.body.report.rows as Array<{ outcome: string; errors: Array<{ code: string }> }>;
    expect(rows.every((row) => row.outcome === 'REJECTED')).toBe(true);
    expect(rows[0]!.errors.some((error) => error.code === 'UNKNOWN_CASE')).toBe(true);
  });

  it('rejects missing or wrong uploads before validation', async () => {
    const noFile = await request(app).post('/api/imports/preview').set('Cookie', cookie);
    expect(noFile.status).toBe(400);
    const wrongType = await request(app)
      .post('/api/imports/preview')
      .set('Cookie', cookie)
      .attach('file', Buffer.from('hello'), { filename: 'notes.txt', contentType: 'text/plain' });
    expect(wrongType.status).toBe(400);
    expect(wrongType.body.error.message).toContain('.csv');
  });

  it('rejects a structurally broken CSV with a clear error', async () => {
    const broken = path.resolve(process.cwd(), 'src/test/fixtures/broken_header.csv');
    const res = await preview(broken);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CSV');
  });
});

describe('CSV commit (atomic database import)', () => {
  it('inserts exactly the valid rows and writes an audit trail', async () => {
    await seedParentCases(8);
    const previewRes = await preview(example('samples_valid.csv'));
    const id = previewRes.body.import.id;
    const res = await commit(id);
    expect(res.body.inserted).toBe(8);
    expect(res.body.import.status).toBe('COMMITTED');

    const samples = await prisma.sample.findMany({ where: { sampleCode: { startsWith: `SP-${caseYear}-1` } } });
    expect(samples).toHaveLength(8);
    const completed = samples.find((s) => s.sampleCode === `SP-${caseYear}-1001`);
    expect(completed?.status).toBe('COMPLETED');
    expect(completed?.resultStatus).toBe('RELEASED');

    const audit = await prisma.auditEvent.findFirst({ where: { eventType: 'IMPORT_COMMITTED' } });
    expect(audit?.targetLabel).toContain('samples_valid.csv');

    // Committing the same batch again is refused.
    const again = await commit(id, 409);
    expect(again.body.error.message).toContain('already committed');
  });

  it('never inserts anything when valid rows reference a case deleted after preview', async () => {
    await seedParentCases(8);
    const previewRes = await preview(example('samples_valid.csv'));
    // Simulate the reference disappearing between preview and commit.
    await prisma.animalCase.delete({ where: { caseNumber: `CASE-${caseYear}-0004` } });

    const res = await commit(previewRes.body.import.id, 409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(await prisma.sample.count()).toBe(0); // partial import prevented by the transaction

    const batch = await prisma.importBatch.findUnique({ where: { id: previewRes.body.import.id } });
    expect(batch?.status).toBe('COMMIT_FAILED');
    const failedAudit = await prisma.auditEvent.findFirst({ where: { eventType: 'IMPORT_COMMIT_FAILED' } });
    expect(failedAudit).toBeTruthy();
  });

  it('refuses to commit a batch with no valid rows', async () => {
    await seedParentCases(8);
    const previewRes = await preview(example('samples_invalid.csv'));
    const res = await commit(previewRes.body.import.id, 409);
    expect(res.body.error.message).toContain('no valid rows');
    expect(await prisma.importBatch.count({ where: { status: 'COMMITTED' } })).toBe(0);
  });

  it('is safe to re-import: rows whose sample codes already exist become duplicates', async () => {
    await seedParentCases(8);
    const first = await preview(example('samples_valid.csv'));
    await commit(first.body.import.id);

    const second = await preview(example('samples_valid.csv'));
    const rows = second.body.report.rows as Array<{ outcome: string; errors: Array<{ code: string }> }>;
    expect(second.body.report.summary.duplicates).toBe(8);
    expect(rows[0]!.errors.some((error) => error.code === 'SAMPLE_EXISTS')).toBe(true);
    expect(await prisma.sample.count()).toBe(8); // nothing was overwritten
  });

  it('lists import history with counts', async () => {
    await seedParentCases(8);
    const previewRes = await preview(example('samples_valid.csv'));
    await commit(previewRes.body.import.id);
    const history = await request(app).get('/api/imports?pageSize=10').set('Cookie', cookie);
    expect(history.body.items).toHaveLength(1);
    expect(history.body.items[0].counts.inserted).toBe(8);
    expect(history.body.items[0].createdByName).toBe('Sam Staff');
  });
});
