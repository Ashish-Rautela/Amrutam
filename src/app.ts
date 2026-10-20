import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import crypto from 'crypto';
import { config } from './config/index.js';
import { httpLogger } from './common/observability/logger.js';
import { healthRouter } from './common/health/health.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { errorHandler, notFoundHandler } from './common/middleware/error.middleware.js';

export const app = express();

// 1. HTTP Security Headers
app.use(helmet());

// 2. Explicit CORS Policy using validated configuration
const allowedOrigins = config.CORS_ORIGIN.includes(',')
  ? config.CORS_ORIGIN.split(',').map((origin) => origin.trim())
  : config.CORS_ORIGIN;

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID', 'Idempotency-Key'],
  })
);

// 3. Correlation ID Tracking Middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const correlationId =
    (req.headers['x-correlation-id'] as string) ||
    (req.headers['x-request-id'] as string) ||
    crypto.randomUUID();

  req.headers['x-correlation-id'] = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);
  next();
});

// 4. Structured HTTP Request Logging (using Pino-HTTP)
app.use(httpLogger);

// 5. JSON and URL-Encoded Body Parsers with 1MB size limit and raw body capture
app.use(
  express.json({
    limit: '1mb',
    verify: (req: any, _res, buf) => {
      // Retain rawBody for cryptographic signature verification (e.g. payment webhooks)
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// 6. Health & Probe Endpoints
// Mounted at both root /health and API prefix (e.g., /api/v1/health) for container orchestrators and API clients
app.use('/health', healthRouter);
if (config.API_PREFIX !== '') {
  app.use(`${config.API_PREFIX}/health`, healthRouter);
}

// 7. Domain Routes
app.use(`${config.API_PREFIX}/auth`, authRouter);

// 8. Route 404 Handler
app.use(notFoundHandler);

// 9. Centralized Global Error Handler
app.use(errorHandler);
