import pino from 'pino';
import { pinoHttp } from 'pino-http';
import { config } from '../../config/index.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-razorpay-signature"]',
      'req.headers["x-signature"]',
      'res.headers["set-cookie"]',
      'password',
      'passwordHash',
      'password_hash',
      'mfaSecret',
      'mfa_secret',
      'mfaBackupCodes',
      'mfa_backup_codes',
      'encryptedTotpSecret',
      'encrypted_totp_secret',
      'token',
      'refreshToken',
      'refresh_token',
      'accessToken',
      'access_token',
      'clinicalNotes',
      'clinical_notes',
      'cardNumber',
      'card_number',
      'cvv',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.secret',
    ],
    censor: '[REDACTED]',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export const httpLogger = pinoHttp({
  logger,
  autoLogging: {
    ignore: (req) => {
      // Avoid excessive log noise for frequent Kubernetes liveness probes
      return req.url === '/health/live' || req.url === `${config.API_PREFIX}/health/live`;
    },
  },
  customProps: (req) => ({
    correlationId: req.headers['x-correlation-id'] || req.headers['x-request-id'],
  }),
});
