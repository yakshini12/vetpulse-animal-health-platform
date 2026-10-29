import request from 'supertest';
import { app, login, resetDb, seedCase } from './helpers.js';

const staff = { email: 'staff@vetpulse.test', password: 'VetPulseTest#2026' };
let cookie: string;

beforeEach(async () => {
  await resetDb();
  cookie = await login(staff);
});

describe('sample creation', () => {
  it('creates a sample in RECEIVED state with receivedAt stamped', async () => {
    const parent = await seedCase();
    const res = await request(app)
      .post('/api/samples')
      .set('Cookie', cookie)
      .send({ caseId: parent.id, sampleType: 'BLOOD', collectionDate: '2026-10-01', labLocation: 'Zone-1 diagnostics lab' });
    expect(res.status).toBe(201);
    expect(res.body.sample.status).toBe('RECEIVED');
    expect(res.body.sample.sampleCode).toMatch(/^SP-\d{4}-\d{4}$/);
    expect(res.body.sample.receivedAt).toBeTruthy();
    expect(res.body.sample.resultStatus).toBe('NOT_AVAILABLE');
  });

  it('rejects samples whose case does not exist', async () => {
    const res = await request(app)
      .post('/api/samples')
      .set('Cookie', cookie)
      .send({ caseId: 'cjld2cjuzhahwqsvoqsc9k6n0', sampleType: 'SWAB', collectionDate: '2026-10-01', labLocation: 'Zone-1' });
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/case/i);
  });

  it('rejects future collection dates', async () => {
    const parent = await seedCase();
    const res = await request(app)
      .post('/api/samples')
      .set('Cookie', cookie)
      .send({ caseId: parent.id, sampleType: 'BLOOD', collectionDate: '2099-01-01', labLocation: 'Zone-1 diagnostics lab' });
    expect(res.status).toBe(400);
  });

  it('validates enum fields server-side', async () => {
    const parent = await seedCase();
    const res = await request(app)
      .post('/api/samples')
      .set('Cookie', cookie)
      .send({ caseId: parent.id, sampleType: 'SALIVA', collectionDate: '2026-10-01', labLocation: 'Zone-1 diagnostics lab' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('sample status transitions (server-side rules)', () => {
  it('walks the happy path RECEIVED → IN_PROCESS → IN_REVIEW → COMPLETED and stamps timestamps', async () => {
    const parent = await seedCase();
    const created = await request(app)
      .post('/api/samples')
      .set('Cookie', cookie)
      .send({ caseId: parent.id, sampleType: 'URINE', collectionDate: '2026-10-01', labLocation: 'Zone-2 diagnostics lab' });
    const id = created.body.sample.id;

    const p1 = await request(app).post(`/api/samples/${id}/transition`).set('Cookie', cookie).send({ to: 'IN_PROCESS' });
    expect(p1.body.sample.processingStartedAt).toBeTruthy();

    const p2 = await request(app).post(`/api/samples/${id}/transition`).set('Cookie', cookie).send({ to: 'IN_REVIEW' });
    expect(p2.status).toBe(200);

    const p3 = await request(app).post(`/api/samples/${id}/transition`).set('Cookie', cookie).send({ to: 'REJECTED' });
    expect(p3.status).toBe(400); // rejection mid-flow requires a reason

    const p4 = await request(app).post(`/api/samples/${id}/transition`).set('Cookie', cookie).send({ to: 'COMPLETED' });
    expect(p4.body.sample.completedAt).toBeTruthy();
  });

  it('rejects skipping ahead (RECEIVED → COMPLETED) and shows allowed transitions', async () => {
    const parent = await seedCase();
    const created = await request(app)
      .post('/api/samples')
      .set('Cookie', cookie)
      .send({ caseId: parent.id, sampleType: 'MILK', collectionDate: '2026-10-01', labLocation: 'Zone-1 diagnostics lab' });
    const res = await request(app)
      .post(`/api/samples/${created.body.sample.id}/transition`)
      .set('Cookie', cookie)
      .send({ to: 'COMPLETED' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('Allowed transitions: IN_PROCESS');
  });

  it('accepts a rejection with a reason and locks the sample afterwards', async () => {
    const parent = await seedCase();
    const created = await request(app)
      .post('/api/samples')
      .set('Cookie', cookie)
      .send({ caseId: parent.id, sampleType: 'TISSUE', collectionDate: '2026-10-01', labLocation: 'Zone-1 diagnostics lab' });
    const id = created.body.sample.id;

    const processStart = await request(app).post(`/api/samples/${id}/transition`).set('Cookie', cookie).send({ to: 'IN_PROCESS' });
    expect(processStart.status).toBe(200);

    const rejected = await request(app)
      .post(`/api/samples/${id}/transition`)
      .set('Cookie', cookie)
      .send({ to: 'REJECTED', rejectionReason: 'Sample container damaged in transit.' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.sample.rejectedAt).toBeTruthy();

    // REJECTED is terminal.
    const revive = await request(app).post(`/api/samples/${id}/transition`).set('Cookie', cookie).send({ to: 'IN_PROCESS' });
    expect(revive.status).toBe(409);
  });

  it('locks metadata editing once processing has moved past IN_PROCESS', async () => {
    const parent = await seedCase();
    const created = await request(app)
      .post('/api/samples')
      .set('Cookie', cookie)
      .send({ caseId: parent.id, sampleType: 'FECAL', collectionDate: '2026-10-01', labLocation: 'Zone-1 diagnostics lab' });
    const id = created.body.sample.id;
    await request(app).post(`/api/samples/${id}/transition`).set('Cookie', cookie).send({ to: 'IN_PROCESS' });
    await request(app).post(`/api/samples/${id}/transition`).set('Cookie', cookie).send({ to: 'IN_REVIEW' });
    const edit = await request(app).patch(`/api/samples/${id}`).set('Cookie', cookie).send({ labLocation: 'Central reference lab' });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('RECORD_LOCKED');
  });

  it('requires IN_REVIEW or COMPLETED before a result can be gated', async () => {
    const parent = await seedCase();
    const created = await request(app)
      .post('/api/samples')
      .set('Cookie', cookie)
      .send({ caseId: parent.id, sampleType: 'SWAB', collectionDate: '2026-10-01', labLocation: 'Zone-1 diagnostics lab' });
    const id = created.body.sample.id;
    const early = await request(app)
      .post(`/api/samples/${id}/result`)
      .set('Cookie', cookie)
      .send({ resultStatus: 'PENDING' });
    expect(early.status).toBe(409);
  });
});

describe('result recording', () => {
  async function sampleAt(status: 'IN_REVIEW' | 'COMPLETED') {
    const parent = await seedCase();
    const created = await request(app)
      .post('/api/samples')
      .set('Cookie', cookie)
      .send({ caseId: parent.id, sampleType: 'BLOOD', collectionDate: '2026-10-01', labLocation: 'Zone-2 diagnostics lab' });
    const id = created.body.sample.id;
    await request(app).post(`/api/samples/${id}/transition`).set('Cookie', cookie).send({ to: 'IN_PROCESS' });
    await request(app).post(`/api/samples/${id}/transition`).set('Cookie', cookie).send({ to: 'IN_REVIEW' });
    if (status === 'COMPLETED') {
      await request(app).post(`/api/samples/${id}/transition`).set('Cookie', cookie).send({ to: 'COMPLETED' });
    }
    return id;
  }

  it('releases a result only for completed samples with a summary', async () => {
    const inReviewId = await sampleAt('IN_REVIEW');
    const blocked = await request(app)
      .post(`/api/samples/${inReviewId}/result`)
      .set('Cookie', cookie)
      .send({ resultStatus: 'RELEASED' });
    expect(blocked.status).toBe(409);

    const completedId = await sampleAt('COMPLETED');
    const noSummary = await request(app)
      .post(`/api/samples/${completedId}/result`)
      .set('Cookie', cookie)
      .send({ resultStatus: 'RELEASED' });
    expect(noSummary.status).toBe(400);

    const ok = await request(app)
      .post(`/api/samples/${completedId}/result`)
      .set('Cookie', cookie)
      .send({ resultStatus: 'RELEASED', resultSummary: 'Synthetic reference-range check; demo value only.' });
    expect(ok.status).toBe(200);
    expect(ok.body.sample.resultStatus).toBe('RELEASED');
  });
});

describe('sample listing', () => {
  it('filters by case and status with pagination', async () => {
    const parentA = await seedCase({ caseNumber: 'CASE-TEST-0001' });
    const parentB = await seedCase({ caseNumber: 'CASE-TEST-0002' });
    for (const parent of [parentA, parentB]) {
      await request(app)
        .post('/api/samples')
        .set('Cookie', cookie)
        .send({ caseId: parent.id, sampleType: 'BLOOD', collectionDate: '2026-10-01', labLocation: 'Zone-1 diagnostics lab' });
    }
    const byCase = await request(app).get(`/api/samples?caseId=${parentA.id}`).set('Cookie', cookie);
    expect(byCase.body.total).toBe(1);
    expect(byCase.body.items[0].case.caseNumber).toBe('CASE-TEST-0001');

    const byStatus = await request(app).get('/api/samples?status=RECEIVED&pageSize=1').set('Cookie', cookie);
    expect(byStatus.body.total).toBe(2);
    expect(byStatus.body.items).toHaveLength(1);
  });
});
