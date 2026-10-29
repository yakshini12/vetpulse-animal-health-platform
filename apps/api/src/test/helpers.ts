import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../db.js';
import type { CasePriority, CaseStatus } from '@prisma/client';

export const app = createApp();

// One password for every test account; hashed once to keep resets fast.
export const TEST_PASSWORD = 'VetPulseTest#2026';
const SHARED_HASH = bcrypt.hashSync(TEST_PASSWORD, 10);

export const testUsers = {
  admin: { name: 'Amelia Admin', email: 'admin@vetpulse.test', role: 'ADMIN' as const, password: TEST_PASSWORD, hash: SHARED_HASH },
  staff: { name: 'Sam Staff', email: 'staff@vetpulse.test', role: 'STAFF' as const, password: TEST_PASSWORD, hash: SHARED_HASH },
  staff2: { name: 'Sana Staff', email: 'staff2@vetpulse.test', role: 'STAFF' as const, password: TEST_PASSWORD, hash: SHARED_HASH },
  inactive: { name: 'Ines Inactive', email: 'inactive@vetpulse.test', role: 'STAFF' as const, password: TEST_PASSWORD, hash: SHARED_HASH },
};

/** Wipes all tables and recreates the standard test users. */
export async function resetDb(): Promise<void> {
  await prisma.auditEvent.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.task.deleteMany();
  await prisma.sample.deleteMany();
  await prisma.animalCase.deleteMany();
  await prisma.user.deleteMany();

  for (const user of Object.values(testUsers)) {
    await prisma.user.create({
      data: {
        email: user.email,
        name: user.name,
        role: user.role,
        passwordHash: user.hash,
        isActive: user !== testUsers.inactive,
      },
    });
  }
}

/** Extracts the raw session cookie from a supertest response. */
export function sessionCookie(res: { headers: Record<string, unknown> }): string {
  const cookie = res.headers['set-cookie'] as unknown as string[] | string | undefined;
  const first = Array.isArray(cookie) ? cookie[0] : cookie;
  if (!first) throw new Error('Login response did not include a session cookie.');
  return first.split(';')[0] ?? '';
}

export async function login(user: { email: string; password: string }): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email: user.email, password: user.password });
  if (res.status !== 200) throw new Error(`Login failed for ${user.email}: ${JSON.stringify(res.body)}`);
  return sessionCookie(res);
}

export async function loginAs(user: keyof typeof testUsers): Promise<string> {
  return login(testUsers[user]);
}

let caseSeq = 0;

const PRIORITY_RANK: Record<CasePriority, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

export async function seedCase(
  overrides: {
    caseNumber?: string;
    title?: string;
    species?: string;
    ownerRef?: string;
    concern?: string;
    priority?: CasePriority;
    status?: CaseStatus;
    assignedToId?: string | null;
    createdAt?: Date;
    closedAt?: Date | null;
  } = {},
) {
  caseSeq += 1;
  const priority = overrides.priority ?? 'MEDIUM';
  const fields = {
    caseNumber: overrides.caseNumber ?? `CASE-TEST-${String(caseSeq).padStart(4, '0')}`,
    title: overrides.title ?? `Synthetic case ${caseSeq}`,
    species: overrides.species ?? 'Cattle',
    ownerRef: overrides.ownerRef ?? 'ORG-101',
    concern: overrides.concern ?? 'Routine screening (synthetic)',
    priority,
    priorityRank: PRIORITY_RANK[priority],
    status: overrides.status ?? 'OPEN',
    assignedToId: overrides.assignedToId ?? null,
    createdAt: overrides.createdAt,
    closedAt: overrides.closedAt,
  };
  return prisma.animalCase.create({ data: { ...fields, createdAt: overrides.createdAt ?? new Date(), updatedAt: new Date() } });
}

export function year(): number {
  return new Date().getUTCFullYear();
}
