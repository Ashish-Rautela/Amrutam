import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import crypto from 'crypto';
import { config } from './config/index.js';
import { httpLogger } from './common/observability/logger.js';
import { metricsRouter } from './common/observability/metrics.js';
import { healthRouter } from './common/health/health.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { doctorsRouter } from './modules/doctors/doctors.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { availabilityRouter } from './modules/availability/availability.routes.js';
import { bookingsRouter } from './modules/bookings/bookings.routes.js';
import { consultationsRouter } from './modules/consultations/consultations.routes.js';
import { prescriptionsRouter } from './modules/prescriptions/prescriptions.routes.js';
import { paymentsRouter } from './modules/payments/payments.routes.js';
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

// 6. Health, Probe & Metrics Endpoints
// Mounted at both root and API prefix for container orchestrators and prometheus scrapers
app.use('/health', healthRouter);
if (config.API_PREFIX !== '') {
  app.use(`${config.API_PREFIX}/health`, healthRouter);
}
if (config.PROMETHEUS_METRICS_ENABLED) {
  app.use('/metrics', metricsRouter);
  if (config.API_PREFIX !== '') {
    app.use(`${config.API_PREFIX}/metrics`, metricsRouter);
  }
}

// 7. Domain Routes
app.use(`${config.API_PREFIX}/auth`, authRouter);
app.use(`${config.API_PREFIX}/doctors`, doctorsRouter);
app.use(`${config.API_PREFIX}/admin`, adminRouter);
app.use(`${config.API_PREFIX}/availability`, availabilityRouter);
app.use(`${config.API_PREFIX}/bookings`, bookingsRouter);
app.use(`${config.API_PREFIX}/consultations`, consultationsRouter);
app.use(`${config.API_PREFIX}/prescriptions`, prescriptionsRouter);
app.use(`${config.API_PREFIX}/payments`, paymentsRouter);

// 8. Route 404 Handler
app.use(notFoundHandler);

// 9. Centralized Global Error Handler
app.use(errorHandler);
