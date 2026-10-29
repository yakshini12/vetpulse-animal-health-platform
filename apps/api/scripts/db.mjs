// VetPulse database helper for local development without Docker.
// Uses embedded PostgreSQL 17 binaries (an npm dependency; no admin rights, no service install).
// If Docker is available, prefer docker-compose.yml in the repository root.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const PORT = 54329;
const API_ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = path.join(API_ROOT, '.pgdata');
const DATABASES = ['vetpulse', 'vetpulse_test'];

function psqlBin(name) {
  // The optional platform package may be hoisted or nested; its exports map
  // blocks require.resolve of "package.json", so search the file system.
  const roots = [
    path.join(API_ROOT, 'node_modules', '@embedded-postgres'),
    path.join(API_ROOT, 'node_modules', 'embedded-postgres', 'node_modules', '@embedded-postgres'),
  ];
  const platformDir = { win32: 'windows-x64', darwin: 'darwin-x64', linux: 'linux-x64' }[process.platform] ?? 'linux-alpine-x64';
  for (const root of roots) {
    const bin = path.join(root, platformDir, 'native', 'bin', process.platform === 'win32' ? `${name}.exe` : name);
    if (existsSync(bin)) return bin;
  }
  throw new Error(`embedded-postgres binaries not found. Run "npm install" in apps/api first.`);
}

function pgCtl(args, opts = {}) {
  return spawnSync(psqlBin('pg_ctl'), args, { stdio: 'inherit', encoding: 'utf8', ...opts });
}

function serverUrl(database) {
  return `postgresql://postgres@127.0.0.1:${PORT}/${database}`;
}

export function envLines() {
  return [
    `DATABASE_URL="${serverUrl('vetpulse')}"`,
    `TEST_DATABASE_URL="${serverUrl('vetpulse_test')}"`,
  ];
}

export function isRunning() {
  return pgCtl(['status', '-D', DATA_DIR], { stdio: null }).status === 0;
}

async function adminClient() {
  const client = new pg.Client({ connectionString: serverUrl('postgres'), connectionTimeoutMillis: 1500 });
  await client.connect();
  return client;
}

export async function up() {
  if (!fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'))) {
    console.log(`Initialising PostgreSQL data directory at ${DATA_DIR} ...`);
    execFileSync(
      psqlBin('initdb'),
      ['-D', DATA_DIR, '-U', 'postgres', '--auth=trust', '--encoding=UTF8'],
      { stdio: 'inherit' },
    );
  }
  if (!isRunning()) {
    pgCtl(['start', '-D', DATA_DIR, '-o', `-p ${PORT}`, '-l', path.join(DATA_DIR, 'logfile.log')]);
  } else {
    console.log('Postgres is already running.');
  }

  // Wait until the server accepts connections (max ~30s).
  let admin = null;
  for (let attempt = 0; attempt < 60 && admin === null; attempt += 1) {
    try {
      admin = await adminClient();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!admin) throw new Error('Postgres did not become ready. See ' + path.join(DATA_DIR, 'logfile.log'));

  for (const db of DATABASES) {
    const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [db]);
    if (exists.rowCount === 0) {
      // CREATE DATABASE cannot be parameterised, but the names here are fixed constants.
      await admin.query(`CREATE DATABASE "${db}"`);
      console.log(`Created database ${db}`);
    }
  }
  await admin.end();

  const envPath = path.join(API_ROOT, '.env');
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, [...envLines(), `JWT_SECRET="${randomBytes(48).toString('base64url')}"`, `PORT=4000`, ''].join('\n'));
    console.log(`Wrote ${envPath}`);
  }
  console.log(`Postgres up on port ${PORT} (databases: ${DATABASES.join(', ')}).`);
}

export function down() {
  pgCtl(['stop', '-D', DATA_DIR]);
}

const command = process.argv[2];
if (command === 'up') await up();
else if (command === 'down') { down(); console.log('Postgres stopped.'); }
else if (command === 'env') console.log(envLines().join('\n'));
else console.log('Usage: node scripts/db.mjs [up|down|env]');
