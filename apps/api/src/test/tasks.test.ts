import request from 'supertest';
import { app, login, resetDb, seedCase } from './helpers.js';


const staff = { email: 'staff@vetpulse.test', password: 'VetPulseTest#2026' };
const staff2 = { email: 'staff2@vetpulse.test', password: 'VetPulseTest#2026' };
let cookie: string;
let staff2Cookie: string;
let staffId: string;
let staff2Id: string;

beforeEach(async () => {
  await resetDb();
  cookie = await login(staff);
  staff2Cookie = await login(staff2);
  staffId = (await request(app).get('/api/auth/me').set('Cookie', cookie)).body.user.id;
  staff2Id = (await request(app).get('/api/auth/me').set('Cookie', staff2Cookie)).body.user.id;
});

describe('task creation', () => {
  it('creates a task linked to a case, sample and assignee', async () => {
    const parent = await seedCase();
    const res = await request(app)
      .post('/api/tasks')
      .set('Cookie', cookie)
      .send({ title: 'Call the contact about the pending sample', dueDate: '2026-11-01', caseId: parent.id, assigneeId: staffId, priority: 'HIGH' });
    expect(res.status).toBe(201);
    expect(res.body.task.priorityRank).toBe(3);
    expect(res.body.task.status).toBe('TODO');
  });

  it('rejects links to non-existent cases', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Cookie', cookie)
      .send({ title: 'Broken reference', dueDate: '2026-11-01', caseId: 'cjld2cjuzhahwqsvoqsc9k6n0' });
    expect(res.status).toBe(409);
  });

  it('validates required fields', async () => {
    const res = await request(app).post('/api/tasks').set('Cookie', cookie).send({ title: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('task lifecycle', () => {
  async function createTask(statusSeed: 'TODO' | 'IN_PROGRESS' = 'TODO') {
    const parent = await seedCase();
    const created = await request(app)
      .post('/api/tasks')
      .set('Cookie', cookie)
      .send({ title: `Synthetic follow-up ${Date.now()}-${Math.random()}`, dueDate: '2026-11-01', caseId: parent.id, assigneeId: staffId });
    if (statusSeed === 'IN_PROGRESS') {
      await request(app).patch(`/api/tasks/${created.body.task.id}`).set('Cookie', cookie).send({ status: 'IN_PROGRESS' });
    }
    return created.body.task.id as string;
  }

  it('completes a task and stamps completedAt', async () => {
    const id = await createTask('IN_PROGRESS');
    const done = await request(app).patch(`/api/tasks/${id}`).set('Cookie', cookie).send({ status: 'DONE' });
    expect(done.status).toBe(200);
    expect(done.body.task.completedAt).toBeTruthy();
  });

  it('reopens a completed task and clears completedAt', async () => {
    const id = await createTask('IN_PROGRESS');
    await request(app).patch(`/api/tasks/${id}`).set('Cookie', cookie).send({ status: 'DONE' });
    const reopened = await request(app).patch(`/api/tasks/${id}`).set('Cookie', cookie).send({ status: 'TODO' });
    expect(reopened.body.task.completedAt).toBeNull();
  });

  it('treats CANCELLED as terminal', async () => {
    const id = await createTask();
    await request(app).patch(`/api/tasks/${id}`).set('Cookie', cookie).send({ status: 'CANCELLED' });
    const res = await request(app).patch(`/api/tasks/${id}`).set('Cookie', cookie).send({ status: 'IN_PROGRESS' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('Allowed: none');
  });

  it('supports reassignment between staff members', async () => {
    const id = await createTask();
    const res = await request(app).patch(`/api/tasks/${id}`).set('Cookie', cookie).send({ assigneeId: staff2Id });
    expect(res.status).toBe(200);
    expect(res.body.task.assigneeId).toBe(staff2Id);
  });
});

describe('task listing and overdue filter', () => {
  it('flags only open tasks past their due date', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const parent = await seedCase();

    await request(app)
      .post('/api/tasks')
      .set('Cookie', cookie)
      .send({ title: 'Overdue follow-up', dueDate: yesterday, caseId: parent.id, assigneeId: staffId });
    const done = await request(app)
      .post('/api/tasks')
      .set('Cookie', cookie)
      .send({ title: 'Completed past-due task', dueDate: yesterday, caseId: parent.id, assigneeId: staffId });
    await request(app).patch(`/api/tasks/${done.body.task.id}`).set('Cookie', cookie).send({ status: 'DONE' });

    await request(app)
      .post('/api/tasks')
      .set('Cookie', cookie)
      .send({ title: 'Future task', dueDate: '2099-01-01', caseId: parent.id, assigneeId: staffId });

    const list = await request(app).get('/api/tasks?overdue=true').set('Cookie', cookie);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].isOverdue).toBe(true);
    expect(list.body.items[0].title).toBe('Overdue follow-up');

    const byAssignee = await request(app).get(`/api/tasks?assigneeId=${staff2Id}`).set('Cookie', cookie);
    expect(byAssignee.body.total).toBe(0);

    const filteredByCase = await request(app).get(`/api/tasks?overdue=true&assigneeId=${staffId}`).set('Cookie', cookie);
    expect(filteredByCase.body.total).toBe(1);
  });
});
