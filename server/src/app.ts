import 'express-async-errors';

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { errorHandler } from './middleware/error-handler.js';
import { setTenantContext } from './middleware/tenant-context.js';
import { apiLimiter } from './middleware/rate-limit.js';
import { logger } from './lib/logger.js';
import { router } from './routes/index.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', true);

  app.use(helmet());
  app.use(
    cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id']
    })
  );
  app.use(
    express.json({
      limit: '2mb',
      verify: (req: express.Request & { rawBody?: string }, _res, buf) => {
        req.rawBody = buf.toString();
      }
    })
  );
  app.use(express.urlencoded({ extended: true }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Apply rate limiting to all API routes
  app.use('/v1', apiLimiter);

  // NOTE: setTenantContext is applied per-route AFTER requireAuth middleware
  // See routes/index.ts for route-specific middleware ordering
  app.use('/v1', router);

  app.use((req, res) => {
    res.status(404).json({
      message: `Route ${req.method} ${req.originalUrl} not found`,
      code: 'NOT_FOUND'
    });
  });

  app.use(errorHandler);

  // Express doesn't have an 'error' event - errors are handled through middleware
  // app.on('error', (err) => {
  //   logger.error({ err }, 'Express app fatal error');
  // });

  return app;
}
