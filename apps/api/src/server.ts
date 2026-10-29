import { createApp } from './app.js';
import { config } from './config.js';
import { errorHandler } from './middleware/errorHandler.js';
import { logger } from './logger.js';

const app = createApp();
// A final error handler instance so middleware added after createApp (upload
// limits etc.) also resolves to JSON instead of crashing the connection.
app.use((err: unknown, req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  errorHandler(err, req, res, next);
});
app.listen(config.port, () => {
  logger.info(`API listening on http://localhost:${config.port}`);
});
