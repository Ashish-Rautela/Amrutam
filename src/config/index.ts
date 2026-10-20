import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env
dotenv.config();

const INSECURE_PLACEHOLDERS = [
  'default',
  'secret',
  '123456',
  'password',
  'replace_with',
  'sample',
  'test_secret',
  'amrutam_super_secure',
  'admin',
  'root',
];

export function isSecureSecret(val: string): boolean {
  if (!val || val.length < 32) return false;
  const lower = val.toLowerCase();
  for (const placeholder of INSECURE_PLACEHOLDERS) {
    if (lower.includes(placeholder)) return false;
  }
  return true;
}

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1, 'PORT must be >= 1').max(65535, 'PORT must be <= 65535').default(4000),
    APP_NAME: z.string().min(1).default('amrutam-telemedicine-backend'),
    API_PREFIX: z
      .string()
      .min(1)
      .regex(/^\//, 'API_PREFIX must start with a forward slash (/)')
      .default('/api/v1'),
    CORS_ORIGIN: z.string().default('http://localhost:3000'),
    ALLOW_INSECURE_WILDCARD_CORS: z
      .string()
      .optional()
      .transform((val) => val === 'true'),

    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL is required')
      .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a valid PostgreSQL connection string starting with postgresql:// or postgres://'),

    REDIS_HOST: z.string().min(1).default('localhost'),
    REDIS_PORT: z.coerce.number().int().min(1, 'REDIS_PORT must be >= 1').max(65535, 'REDIS_PORT must be <= 65535').default(6379),
    REDIS_PASSWORD: z.string().optional(),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters long'),
    JWT_ACCESS_EXPIRY: z.string().default('15m'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters long'),
    JWT_REFRESH_EXPIRY: z.string().default('7d'),
    JWT_ISSUER: z.string().default('amrutam-telemedicine'),
    JWT_AUDIENCE: z.string().default('amrutam-api'),

    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(15 * 60 * 1000),

    DATA_ENCRYPTION_KEY: z
      .string()
      .length(64, 'DATA_ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes AES-256 key)')
      .regex(/^[0-9a-fA-F]{64}$/, 'DATA_ENCRYPTION_KEY must contain only hexadecimal characters [0-9a-fA-F]'),

    PAYMENT_GATEWAY_PROVIDER: z.enum(['MOCK', 'RAZORPAY', 'STRIPE']).default('MOCK'),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

    TELEHEALTH_PROVIDER: z.enum(['MOCK', 'JITSI', 'DAILY']).default('MOCK'),
    TELEHEALTH_SECRET: z.string().default('mock_telehealth_signing_secret_min_32_chars'),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    PROMETHEUS_METRICS_ENABLED: z
      .string()
      .optional()
      .transform((val) => val !== 'false'),
  })
  .superRefine((data, ctx) => {
    // 1. Production secret checks: reject known placeholders
    if (data.NODE_ENV === 'production') {
      if (!isSecureSecret(data.JWT_ACCESS_SECRET)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_ACCESS_SECRET'],
          message: 'In production, JWT_ACCESS_SECRET must be a cryptographically random secret of at least 32 characters and cannot use known development placeholders',
        });
      }

      if (!isSecureSecret(data.JWT_REFRESH_SECRET)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_REFRESH_SECRET'],
          message: 'In production, JWT_REFRESH_SECRET must be a cryptographically random secret of at least 32 characters and cannot use known development placeholders',
        });
      }

      // 2. Production wildcard CORS check
      if (data.CORS_ORIGIN === '*' && !data.ALLOW_INSECURE_WILDCARD_CORS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGIN'],
          message: 'Wildcard CORS_ORIGIN (*) is strictly disallowed in production unless explicitly permitted by ALLOW_INSECURE_WILDCARD_CORS=true',
        });
      }
    }

    // 3. Payment provider credential validation when real provider is selected
    if (data.PAYMENT_GATEWAY_PROVIDER === 'RAZORPAY') {
      if (!data.RAZORPAY_KEY_ID || data.RAZORPAY_KEY_ID.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['RAZORPAY_KEY_ID'],
          message: 'RAZORPAY_KEY_ID is required when PAYMENT_GATEWAY_PROVIDER is RAZORPAY',
        });
      }
      if (!data.RAZORPAY_KEY_SECRET || data.RAZORPAY_KEY_SECRET.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['RAZORPAY_KEY_SECRET'],
          message: 'RAZORPAY_KEY_SECRET is required when PAYMENT_GATEWAY_PROVIDER is RAZORPAY',
        });
      }
      if (!data.RAZORPAY_WEBHOOK_SECRET || data.RAZORPAY_WEBHOOK_SECRET.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['RAZORPAY_WEBHOOK_SECRET'],
          message: 'RAZORPAY_WEBHOOK_SECRET is required when PAYMENT_GATEWAY_PROVIDER is RAZORPAY',
        });
      }
    }
  });

export type Config = z.infer<typeof envSchema>;

/**
 * Validates an environment variable record without process.exit, returning parsed config or throwing ZodError.
 */
export function validateConfig(rawEnv: Record<string, unknown>): Config {
  return envSchema.parse(rawEnv);
}

/**
 * Safe configuration loader for runtime startup.
 */
function loadApplicationConfig(): Config {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('FATAL: Configuration validation failed. Server cannot start with invalid or insecure settings:');
    for (const issue of result.error.issues) {
      // Intentionally do NOT print secret values to avoid credential leakage
      console.error(` - [${issue.path.join('.')}]: ${issue.message}`);
    }

    // Avoid exiting if running inside automated test runners (like Vitest)
    if (process.env.NODE_ENV !== 'test') {
      process.exit(1);
    } else {
      throw result.error;
    }
  }

  return result.data;
}

export const config = loadApplicationConfig();
