import request from 'supertest';
import { app, loginAs, resetDb, sessionCookie } from './helpers.js';

beforeAll(resetDb);

describe('authentication', () => {
  it('logs in with valid credentials and returns the session user', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'staff@vetpulse.test', password: 'VetPulseTest#2026' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'staff@vetpulse.test', role: 'STAFF' });
    // The token lives in an httpOnly cookie, never in the JSON body.
    expect(res.body.user).not.toHaveProperty('token');
    expect(res.headers['set-cookie']).toBeDefined();

    const me = await request(app).get('/api/auth/me').set('Cookie', sessionCookie(res));
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('staff@vetpulse.test');
  });

  it('rejects a wrong password with the same message as an unknown email', async () => {
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'staff@vetpulse.test', password: 'not-the-password' });
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@vetpulse.test', password: 'also-not-it' });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });

  it('rejects malformed login payloads before touching the database', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email', password: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('blocks deactivated accounts from logging in', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'inactive@vetpulse.test', password: 'VetPulseTest#2026' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_INACTIVE');
  });

  it('requires authentication for protected endpoints', async () => {
    const res = await request(app).get('/api/cases');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('enforces the ADMIN role server-side', async () => {
    const cookie = await loginAs('staff');
    const res = await request(app).get('/api/users').set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects an invalid session token', async () => {
    const res = await request(app).get('/api/cases').set('Cookie', 'vetpulse_token=not.a.token');
    expect(res.status).toBe(401);
  });
});
