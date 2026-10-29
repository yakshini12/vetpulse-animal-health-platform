import request from 'supertest';
import { prisma } from '../db.js';
import { app, loginAs, resetDb, testUsers } from './helpers.js';

beforeEach(resetDb);

describe('admin user management', () => {
  it('lists users only for admins', async () => {
    const adminCookie = await loginAs('admin');
    const staffCookie = await loginAs('staff');

    const ok = await request(app).get('/api/users').set('Cookie', adminCookie);
    expect(ok.status).toBe(200);
    const emails = ok.body.items.map((user: { email: string }) => user.email);
    expect(emails).toEqual(expect.arrayContaining([testUsers.staff.email, testUsers.admin.email]));
    expect(Object.keys(ok.body.items[0])).not.toContain('passwordHash');

    const blocked = await request(app).get('/api/users').set('Cookie', staffCookie);
    expect(blocked.status).toBe(403);
  });

  it('promotes a staff user to admin and records the audit event', async () => {
    const adminCookie = await loginAs('admin');
    const staffUser = await prisma.user.findUnique({ where: { email: testUsers.staff.email } });

    const res = await request(app).patch(`/api/users/${staffUser?.id}`).set('Cookie', adminCookie).send({ role: 'ADMIN' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('ADMIN');

    const audit = await prisma.auditEvent.findFirst({ where: { eventType: 'USER_UPDATED' } });
    expect(audit?.summary).toContain('role STAFF → ADMIN');
  });

  it('prevents an admin from changing their own role or deactivating themselves', async () => {
    const adminCookie = await loginAs('admin');
    const adminUser = await prisma.user.findUnique({ where: { email: testUsers.admin.email } });

    const roleChange = await request(app).patch(`/api/users/${adminUser?.id}`).set('Cookie', adminCookie).send({ role: 'STAFF' });
    expect(roleChange.status).toBe(409);

    const selfDeactivate = await request(app).patch(`/api/users/${adminUser?.id}`).set('Cookie', adminCookie).send({ isActive: false });
    expect(selfDeactivate.status).toBe(409);
  });

  it('deactivating a user immediately blocks their sessions from new requests', async () => {
    const adminCookie = await loginAs('admin');
    const staffCookie = await loginAs('staff');
    const staffUser = await prisma.user.findUnique({ where: { email: testUsers.staff.email } });

    await request(app).patch(`/api/users/${staffUser?.id}`).set('Cookie', adminCookie).send({ isActive: false });

    const res = await request(app).get('/api/cases').set('Cookie', staffCookie);
    expect(res.status).toBe(401);
  });

  it('rejects requests from staff on user mutations', async () => {
    const staffCookie = await loginAs('staff');
    const adminUser = await prisma.user.findUnique({ where: { email: testUsers.admin.email } });
    const res = await request(app).patch(`/api/users/${adminUser?.id}`).set('Cookie', staffCookie).send({ role: 'STAFF' });
    expect(res.status).toBe(403);
  });
});
