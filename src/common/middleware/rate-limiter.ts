import rateLimit from 'express-rate-limit';
import { config } from '../../config/index.js';

/**
 * Rate limiter for sensitive authentication endpoints (login, register, MFA, refresh).
 */
export const authRateLimiter = rateLimit({
  windowMs: config.AUTH_RATE_LIMIT_WINDOW_MS,
  max: config.NODE_ENV === 'test' ? 1000 : config.AUTH_RATE_LIMIT_MAX, // Relax in test environment to avoid test interference
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const correlationId = (req.headers['x-correlation-id'] as string) || 'none';
    res.status(429).json({
      type: 'https://api.amrutam.co.in/errors/too-many-requests',
      title: 'TOO_MANY_REQUESTS',
      status: 429,
      detail: 'Too many authentication attempts. Please try again later.',
      instance: req.originalUrl,
      correlationId,
    });
  },
});
