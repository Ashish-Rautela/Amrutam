import dotenv from 'dotenv';
import { z } from 'zod';

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
];

function isSecureSecret(val: string): boolean {
  if (val.length < 32) return false;
  const lower = val.toLowerCase();
  for (const placeholder of INSECURE_PLACEHOLDERS) {
    if (lower.includes(placeholder)) return false;
  }
  return true;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  APP_NAME: z.string().default('amrutam-telemedicine-backend'),
  API_PREFIX: z.string().default('/api/v1'),
  CORS_ORIGIN: z.string().default('*'),

  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL connection string'),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters long')
    .refine(
      (val) => process.env.NODE_ENV !== 'production' || isSecureSecret(val),
      'JWT_ACCESS_SECRET must be a cryptographically secure random string, not a known placeholder'
    ),

  JWT_ACCESS_EXPIRY: z.string().default('15m'),

  JWT_REFRESH_SECRET: z
    .string()
    .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters long')
    .refine(
      (val) => process.env.NODE_ENV !== 'production' || isSecureSecret(val),
      'JWT_REFRESH_SECRET must be a cryptographically secure random string, not a known placeholder'
    ),

  JWT_REFRESH_EXPIRY: z.string().default('7d'),

  DATA_ENCRYPTION_KEY: z
    .string()
    .length(64, 'DATA_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes AES-256 key)')
    .regex(/^[0-9a-fA-F]+$/, 'DATA_ENCRYPTION_KEY must be a valid hexadecimal string')
    .refine(
      (val) => process.env.NODE_ENV !== 'production' || isSecureSecret(val),
      'DATA_ENCRYPTION_KEY cannot use sequential or placeholder hex strings in production'
    ),

  PAYMENT_GATEWAY_PROVIDER: z.enum(['MOCK', 'RAZORPAY', 'STRIPE']).default('MOCK'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  TELEHEALTH_PROVIDER: z.enum(['MOCK', 'JITSI', 'DAILY']).default('MOCK'),
  TELEHEALTH_SECRET: z.string().default('mock_telehealth_signing_secret_min_32_chars'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PROMETHEUS_METRICS_ENABLED: z
    .string()
    .transform((val) => val !== 'false')
    .default('true'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('FATAL: Insecure or invalid environment configuration:');
  for (const issue of parsedEnv.error.issues) {
    console.error(` - [${issue.path.join('.')}]: ${issue.message}`);
  }
  console.error('\nApplication startup aborted due to configuration security check failure.');
  process.exit(1);
}

export const config = {
  env: parsedEnv.data.NODE_ENV,
  port: parsedEnv.data.PORT,
  appName: parsedEnv.data.APP_NAME,
  apiPrefix: parsedEnv.data.API_PREFIX,
  corsOrigin: parsedEnv.data.CORS_ORIGIN,

  databaseUrl: parsedEnv.data.DATABASE_URL,

  redis: {
    host: parsedEnv.data.REDIS_HOST,
    port: parsedEnv.data.REDIS_PORT,
    password: parsedEnv.data.REDIS_PASSWORD,
  },

  jwt: {
    accessSecret: parsedEnv.data.JWT_ACCESS_SECRET,
    accessExpiry: parsedEnv.data.JWT_ACCESS_EXPIRY,
    refreshSecret: parsedEnv.data.JWT_REFRESH_SECRET,
    refreshExpiry: parsedEnv.data.JWT_REFRESH_EXPIRY,
  },

  encryptionKey: parsedEnv.data.DATA_ENCRYPTION_KEY,

  payment: {
    provider: parsedEnv.data.PAYMENT_GATEWAY_PROVIDER,
    razorpayKeyId: parsedEnv.data.RAZORPAY_KEY_ID,
    razorpayKeySecret: parsedEnv.data.RAZORPAY_KEY_SECRET,
    razorpayWebhookSecret: parsedEnv.data.RAZORPAY_WEBHOOK_SECRET,
  },

  telehealth: {
    provider: parsedEnv.data.TELEHEALTH_PROVIDER,
    secret: parsedEnv.data.TELEHEALTH_SECRET,
  },

  logging: {
    level: parsedEnv.data.LOG_LEVEL,
  },

  metricsEnabled: parsedEnv.data.PROMETHEUS_METRICS_ENABLED,
};
