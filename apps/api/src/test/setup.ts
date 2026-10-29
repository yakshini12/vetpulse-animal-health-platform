/**
 * Vitest setup for integration tests.
 * Runs before any test module import, so process.env.DATABASE_URL points at
 * the dedicated test database before the app creates its Prisma client.
 */
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';

dotenv.config({ override: true });
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-secret-for-ci';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is not set. Run `npm run db:up` once, then `npm test`.');
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

// Apply the versioned migrations to the test database once per process.
if (!process.env.__VETPULSE_MIGRATED) {
  const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    shell: true, // npx is an .cmd shim on Windows; a bare spawn cannot execute it
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
  });
  if (result.status !== 0) {
    throw new Error('prisma migrate deploy failed for the test database.');
  }
  process.env.__VETPULSE_MIGRATED = '1';
}
