import { PrismaClient, Prisma } from '@prisma/client';
import { config } from '../../config/index.js';
import { logger } from '../../common/observability/logger.js';

const logOptions: Prisma.LogLevel[] =
  config.NODE_ENV === 'development' || config.LOG_LEVEL === 'debug' || config.LOG_LEVEL === 'trace'
    ? ['error', 'warn', 'info']
    : ['error', 'warn'];

/**
 * Centralized, shared Prisma Client singleton.
 */
export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: config.DATABASE_URL,
    },
  },
  log: logOptions,
});

let isConnected = false;

/**
 * Explicitly connects to PostgreSQL using the shared client.
 */
export async function connectDatabase(): Promise<void> {
  if (isConnected) return;

  try {
    await prisma.$connect();
    isConnected = true;
    logger.info({ msg: 'Successfully connected to PostgreSQL database' });
  } catch (error: any) {
    isConnected = false;
    // Log safe error message without credentials or database URL
    logger.error({
      msg: 'Failed to establish initial PostgreSQL connection',
      error: error.message,
    });
    throw error;
  }
}

/**
 * Cleanly disconnects the shared Prisma client.
 */
export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect();
    isConnected = false;
    logger.info({ msg: 'PostgreSQL database disconnected cleanly' });
  } catch (error: any) {
    logger.error({
      msg: 'Error during PostgreSQL disconnection',
      error: error.message,
    });
  }
}

/**
 * Checks PostgreSQL health using a bounded query timeout (default 2000ms).
 * Returns true if healthy, false if unreachable or timed out.
 */
export async function checkDatabaseHealth(timeoutMs = 2000): Promise<boolean> {
  try {
    const healthCheckPromise = prisma.$queryRawUnsafe('SELECT 1;');
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('PostgreSQL health check timed out')), timeoutMs)
    );

    await Promise.race([healthCheckPromise, timeoutPromise]);
    return true;
  } catch (error: any) {
    logger.warn({
      msg: 'PostgreSQL health check failed',
      error: error.message,
    });
    return false;
  }
}
