import request from 'supertest';
import { app, login, resetDb, seedCase } from './helpers.js';


const staff = { email: 'staff@vetpulse.test', password: 'VetPulseTest#2026' };
let cookie: string;

beforeEach(async () => {
  await resetDb();
  cookie = await login(staff);
});


describe('audit trail', () => {
  it('records case creation, updates, sample transitions, task completion and import events', async () => {
    const caseRes = await request(app)
      .post('/api/cases')
      .set('Cookie', cookie)
      .send({ title: 'Audited case', species: 'Sheep', ownerRef: 'ORG-108', concern: 'Synthetic concern for audit test' });
    const caseId = caseRes.body.case.id;

    await request(app).patch(`/api/cases/${caseId}`).set('Cookie', cookie).send({ status: 'IN_PROGRESS' });

    const sample = await request(app)
      .post('/api/samples')
      .set('Cookie', cookie)
      .send({ caseId, sampleType: 'BLOOD', collectionDate: '2026-10-01', labLocation: 'Zone-1 diagnostics lab' });
    await request(app).post(`/api/samples/${sample.body.sample.id}/transition`).set('Cookie', cookie).send({ to: 'IN_PROCESS' });

    const task = await request(app)
      .post('/api/tasks')
      .set('Cookie', cookie)
      .send({ title: 'Audited task', dueDate: '2026-11-01', caseId });
    await request(app).patch(`/api/tasks/${task.body.task.id}`).set('Cookie', cookie).send({ status: 'DONE' });

    const res = await request(app).get('/api/audit?pageSize=20').set('Cookie', cookie);
    const types = res.body.items.map((event: { eventType: string }) => event.eventType);
    expect(types).toEqual(expect.arrayContaining(['CASE_CREATED', 'CASE_STATUS_CHANGED', 'SAMPLE_CREATED', 'SAMPLE_TRANSITION', 'TASK_CREATED', 'TASK_COMPLETED']));
    const actor = res.body.items[0];
    expect(actor.actorName).toBe('Sam Staff');
  });

  it('filters by target type and supports pagination', async () => {
    const created = await seedCase({ caseNumber: 'CASE-AUDIT-0001' });

    const list = await request(app).get('/api/audit?targetType=SAMPLE&pageSize=5').set('Cookie', cookie);
    expect(list.body.total).toBe(0);

    await request(app)
      .patch(`/api/cases/${created.id}`)
      .set('Cookie', cookie)
      .send({ title: 'Renamed audited case' });

    const after = await request(app).get('/api/audit?targetType=CASE&pageSize=1&page=1').set('Cookie', cookie);
    expect(after.body.total).toBe(1);
    expect(after.body.items[0].eventType).toBe('CASE_UPDATED');
    expect(after.body.items[0].targetLabel).toContain('CASE-AUDIT-0001');
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/audit');
    expect(res.status).toBe(401);
  });
});
