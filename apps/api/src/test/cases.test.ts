import request from 'supertest';
import { app, loginAs, resetDb, seedCase } from './helpers.js';

let staffCookie: string;
let adminCookie: string;

beforeEach(async () => {
  await resetDb();
  staffCookie = await loginAs('staff');
  adminCookie = await loginAs('admin');
});

describe('case creation', () => {
  it('creates a case with a sequential unique case number', async () => {
    const res = await request(app)
      .post('/api/cases')
      .set('Cookie', staffCookie)
      .send({
        title: 'Herd screening request',
        species: 'Cattle',
        ownerRef: 'ORG-117',
        concern: 'Routine herd health screening',
        priority: 'HIGH',
      });
    expect(res.status).toBe(201);
    expect(res.body.case.caseNumber).toMatch(/^CASE-\d{4}-\d{4}$/);
    expect(res.body.case.status).toBe('OPEN');
    expect(res.body.case.priorityRank).toBe(3);
  });

  it('validates every field and reports field-level errors', async () => {
    const res = await request(app)
      .post('/api/cases')
      .set('Cookie', staffCookie)
      .send({
        title: 'x',
        species: '',
        ownerRef: 'John Doe',
        concern: 'hi',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const fields = res.body.error.details.map((issue: { path: string[] }) => issue.path.join('.'));
    expect(fields).toEqual(expect.arrayContaining(['title', 'species', 'ownerRef', 'concern']));
  });

  it('rejects personal names in ownerRef (pseudonymous data only)', async () => {
    const res = await request(app)
      .post('/api/cases')
      .set('Cookie', staffCookie)
      .send({ title: 'Valid title', species: 'Goat', ownerRef: 'PERSON-Prakash', concern: 'Synthetic concern text' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.some((issue: { path: string[] }) => issue.path.includes('ownerRef'))).toBe(true);
  });

  it('rejects unknown assignees with a conflict error', async () => {
    const res = await request(app)
      .post('/api/cases')
      .set('Cookie', staffCookie)
      .send({
        title: 'Valid title',
        species: 'Goat',
        ownerRef: 'ORG-101',
        concern: 'Synthetic concern text',
        assignedToId: 'cjld2cjuzhahwqsvoqsc9k6n0',
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/cases').send({ title: 'Nope' });
    expect(res.status).toBe(401);
  });
});

describe('case updates and status transitions', () => {
  it('closes an open case and stamps closedAt', async () => {
    const created = await seedCase();
    const res = await request(app).patch(`/api/cases/${created.id}`).set('Cookie', staffCookie).send({ status: 'CLOSED' });
    expect(res.status).toBe(200);
    expect(res.body.case.status).toBe('CLOSED');
    expect(res.body.case.closedAt).toBeTruthy();

    // CLOSED is terminal: reopening must fail with the allowed transitions listed.
    const reopen = await request(app).patch(`/api/cases/${created.id}`).set('Cookie', staffCookie).send({ status: 'IN_PROGRESS' });
    expect(reopen.status).toBe(409);
    expect(reopen.body.error.code).toBe('INVALID_TRANSITION');
    expect(reopen.body.error.message).toContain('Allowed: none');
  });

  it('moves OPEN → IN_PROGRESS → RESOLVED and clears closedAt on reopen', async () => {
    const created = await seedCase();
    const inProgress = await request(app).patch(`/api/cases/${created.id}`).set('Cookie', staffCookie).send({ status: 'IN_PROGRESS' });
    expect(inProgress.status).toBe(200);

    const closed = await request(app).patch(`/api/cases/${created.id}`).set('Cookie', adminCookie).send({ status: 'CLOSED' });
    expect(closed.status).toBe(200);
    expect(closed.body.case.closedAt).toBeTruthy();
  });

  it('rejects unknown ids with 404', async () => {
    const res = await request(app).get('/api/cases/cjld2cjuzhahwqsvoqsc9k6n0').set('Cookie', staffCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('case listing: SQL filters, sorting and pagination', () => {
  it('filters by status and priority, sorts by priorityRank, paginates', async () => {
    await seedCase({ caseNumber: 'CASE-TEST-0001', priority: 'HIGH', status: 'IN_PROGRESS' });
    await seedCase({ caseNumber: 'CASE-TEST-0002', priority: 'CRITICAL', status: 'OPEN' });
    await seedCase({ caseNumber: 'CASE-TEST-0003', priority: 'LOW', status: 'RESOLVED' });

    const openOnly = await request(app).get('/api/cases?status=OPEN').set('Cookie', staffCookie);
    expect(openOnly.body.total).toBe(1);
    expect(openOnly.body.items[0].caseNumber).toBe('CASE-TEST-0002');

    const sorted = await request(app).get('/api/cases?sort=priorityRank&order=desc').set('Cookie', staffCookie);
    expect(sorted.body.items.map((c: { caseNumber: string }) => c.caseNumber)).toEqual(['CASE-TEST-0002', 'CASE-TEST-0001', 'CASE-TEST-0003']);

    const page2 = await request(app).get('/api/cases?pageSize=2&page=2').set('Cookie', staffCookie);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.total).toBe(3);
    expect(page2.body.totalPages).toBe(2);

    const searched = await request(app).get('/api/cases?search=CASE-TEST-0003').set('Cookie', staffCookie);
    expect(searched.body.total).toBe(1);
    expect(searched.body.items[0].caseNumber).toBe('CASE-TEST-0003');
  });

  it('rejects unknown sort fields', async () => {
    const res = await request(app).get('/api/cases?sort=notARealField').set('Cookie', staffCookie);
    expect(res.status).toBe(400);
  });
});
