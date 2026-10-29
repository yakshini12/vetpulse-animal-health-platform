import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { authRouter } from './auth/routes.js';import { caseRouter } from './cases/routes.js';
import { sampleRouter } from './samples/routes.js';
import { taskRouter } from './tasks/routes.js';
import { dashboardRouter } from './dashboard/routes.js';
import { auditRouter } from './audit/routes.js';
import { importRouter } from './imports/routes.js';
import { userRouter } from './users/routes.js';
import { healthHandler } from './routes/health.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');

  // The browser client is the only intended caller; JSON only, credentials for the session cookie.
  app.use(
    cors({
      origin: config.clientOrigin.split(',').map((value) => value.trim()),
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', (req, res, next) => void healthHandler(req, res, next));

  app.use('/api', authRouter());
  app.use('/api', caseRouter());
  app.use('/api', sampleRouter());
  app.use('/api', taskRouter());
  app.use('/api', dashboardRouter());
  app.use('/api', auditRouter());
  app.use('/api', importRouter());
  app.use('/api', userRouter());

  app.use('/api', notFoundHandler);

  // When a production web build exists next to the API (apps/web/dist),
  // serve it — single-origin deploys do not need the CORS fallback.
  const webDist = path.resolve(import.meta.dirname, '../../web/dist');
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
