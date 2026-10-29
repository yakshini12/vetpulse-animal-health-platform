import request from 'supertest';
import { prisma } from '../db.js';
import { app, login, resetDb, seedCase, year } from './helpers.js';


const staff = { email: 'staff@vetpulse.test', password: 'VetPulseTest#2026' };
let cookie: string;

beforeEach(async () => {
  await resetDb();
  cookie = await login(staff);
});


describe('dashboard aggregation (database-derived)', () => {
  it('returns zeros and null turnaround on an empty database', async () => {
    const res = await request(app).get('/api/dashboard/summary').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.cases).toEqual({ total: 0, byStatus: { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, CLOSED: 0 } });
    expect(res.body.samples.awaitingProcessing).toBe(0);
    expect(res.body.samples.invalidMetadata).toBe(0);
    expect(res.body.avgTurnaroundHours).toBeNull();
    expect(res.body.caseVolume).toHaveLength(30);
    expect(res.body.caseVolume.every((d: { count: number }) => d.count === 0)).toBe(true);
    expect(res.body.recentActivity).toHaveLength(0);
  });

  it('counts cases by status and fills the last 30 days of volume', async () => {
    await seedCase({ caseNumber: 'CASE-D-0001', status: 'OPEN' });
    await seedCase({ caseNumber: 'CASE-D-0002', status: 'IN_PROGRESS' });
    await seedCase({ caseNumber: 'CASE-D-0003', status: 'IN_PROGRESS' });
    await seedCase({ caseNumber: 'CASE-D-0004', status: 'CLOSED', closedAt: new Date() });

    const res = await request(app).get('/api/dashboard/summary').set('Cookie', cookie);
    expect(res.body.cases.byStatus.OPEN).toBe(1);
    expect(res.body.cases.byStatus.IN_PROGRESS).toBe(2);
    expect(res.body.cases.byStatus.CLOSED).toBe(1);
    expect(res.body.cases.total).toBe(4);
    expect(res.body.caseVolume.at(-1).count).toBeGreaterThanOrEqual(4);
  });

  it('computes average turnaround in hours from receivedAt/completedAt pairs', async () => {
    const parent = await seedCase({ caseNumber: 'CASE-D-0010' });
    const now = Date.now();
    // 24h and 50h turnarounds → average 37.0
    await prisma.sample.create({
      data: {
        sampleCode: `SP-${year()}-8001`,
        caseId: parent.id,
        sampleType: 'BLOOD',
        collectionDate: new Date(now - 60 * 60 * 1000 - 24 * 24 * 60 * 60 * 1000),
        status: 'COMPLETED',
        labLocation: 'Zone-1 diagnostics lab',
        receivedAt: new Date(now - 24 * 60 * 60 * 1000),
        processingStartedAt: new Date(now - 20 * 60 * 60 * 1000),
        completedAt: new Date(now),
      },
    });
    await prisma.sample.create({
      data: {
        sampleCode: `SP-${year()}-8002`,
        caseId: parent.id,
        sampleType: 'SWAB',
        collectionDate: new Date(now - 51 * 60 * 60 * 1000),
        status: 'COMPLETED',
        labLocation: 'Zone-2 diagnostics lab',
        receivedAt: new Date(now - 50 * 60 * 60 * 1000),
        completedAt: new Date(now),
      },
    });

    const res = await request(app).get('/api/dashboard/summary').set('Cookie', cookie);
    expect(res.body.avgTurnaroundHours).toBeCloseTo(37.0, 1);
    expect(res.body.samples.byStatus.COMPLETED).toBe(2);
    expect(res.body.completedSamplesWithTurnaround).toBe(2);
  });

  it('counts invalid metadata samples per the documented quality rules', async () => {
    const parent = await seedCase({ caseNumber: 'CASE-D-0020' });
    const base = {
      caseId: parent.id,
      sampleType: 'BLOOD' as const,
      collectionDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      labLocation: 'Zone-1 diagnostics lab',
    };
    // rule 1: future collection date; rule 3: COMPLETED without completedAt
    await prisma.sample.createMany({
      data: [
        { ...base, sampleCode: `SP-${year()}-8101`, status: 'RECEIVED', receivedAt: new Date(), collectionDate: new Date(Date.now() + 86_400_000) },
        { ...base, sampleCode: `SP-${year()}-8102`, status: 'COMPLETED', receivedAt: new Date() }, // missing completedAt
      ],
    });

    const res = await request(app).get('/api/dashboard/summary').set('Cookie', cookie);
    expect(res.body.samples.invalidMetadata).toBe(2);
  });

  it('lists workload per active staff member', async () => {
    const staffUser = await prisma.user.findUnique({ where: { email: 'staff@vetpulse.test' } });
    const parent = await seedCase({ caseNumber: 'CASE-D-0030' });
    await prisma.animalCase.update({ where: { id: parent.id }, data: { assignedToId: staffUser?.id } });
    await prisma.task.create({
      data: { title: 'Open workload task', dueDate: new Date(Date.now() + 86_400_000), assigneeId: staffUser?.id, status: 'TODO' },
    });

    const res = await request(app).get('/api/dashboard/summary').set('Cookie', cookie);
    const row = res.body.workload.find((entry: { name: string }) => entry.name === 'Sam Staff');
    expect(row.openTasks).toBe(1);
    expect(row.openCases).toBe(1);
  });
});
