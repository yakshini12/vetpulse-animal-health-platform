import request from 'supertest';
import { app, loginAs, resetDb } from './helpers.js';

beforeAll(async () => {
  await resetDb();
});

describe('health and error contract', () => {
  it('reports health including database connectivity', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('ok');
  });

  it('returns a structured 404 for unknown API routes', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns JSON (not a stack trace) for malformed JSON bodies', async () => {
    const cookie = await loginAs('staff');
    const res = await request(app)
      .post('/api/cases')
      .set('Cookie', cookie)
      .set('Content-Type', 'application/json')
      .send('{"title": broken json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    // The app is still healthy after the parse error.
    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);
  });
});
