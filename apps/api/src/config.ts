import dotenv from 'dotenv';

// Never override variables the test harness already set (e.g. TEST_DATABASE_URL
// copied into DATABASE_URL by the test setup file).
dotenv.config({ override: false });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? (process.env.NODE_ENV === 'test' ? 'test-secret' : undefined),
  databaseUrl: process.env.DATABASE_URL ?? '',
  pythonBin: process.env.PYTHON_BIN ?? 'python',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? Number.MAX_SAFE_INTEGER),
  maxCsvRows: 5000,
  tokenCookie: 'vetpulse_token',
  tokenTtlSeconds: 60 * 60 * 8,
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  isTest: process.env.NODE_ENV === 'test',
};

if (!config.isTest) {
  if (!process.env.JWT_SECRET) config.jwtSecret = required('JWT_SECRET');
  if (!config.databaseUrl) config.databaseUrl = required('DATABASE_URL');
}
