import { Redis, RedisOptions } from 'ioredis';
import { config } from '../../config/index.js';
import { logger } from '../../common/observability/logger.js';

let redisInstance: Redis | null = null;
let isConnecting = false;

function createRedisOptions(): RedisOptions {
  return {
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD || undefined,
    lazyConnect: true,
    // Bounded retries: reject command if not connected after 3 attempts instead of hanging
    maxRetriesPerRequest: 3,
    // Avoid unbounded memory accumulation if Redis is offline
    enableOfflineQueue: false,
    // Bounded exponential backoff reconnection strategy
    retryStrategy: (times: number) => {
      if (times > 10) {
        logger.warn({
          msg: 'Redis reconnection attempts exhausted (10 attempts). Pausing retry.',
          attempts: times,
        });
        return 5000;
      }
      const delay = Math.min(times * 200, 3000);
      return delay;
    },
  };
}

/**
 * Returns the singleton Redis client instance.
 */
export function getRedisClient(): Redis {
  if (!redisInstance) {
    redisInstance = new Redis(createRedisOptions());

    redisInstance.on('connect', () => {
      logger.info({ msg: 'Redis client connected' });
    });

    redisInstance.on('ready', () => {
      logger.info({ msg: 'Redis client ready to accept commands' });
    });

    redisInstance.on('error', (err: Error) => {
      // Safe logging without credential leakage
      logger.warn({
        msg: 'Redis connection error',
        error: err.message,
      });
    });

    redisInstance.on('close', () => {
      logger.debug({ msg: 'Redis connection closed' });
    });
  }

  return redisInstance;
}

/**
 * Explicit startup connection lifecycle.
 */
export async function connectRedis(): Promise<void> {
  const client = getRedisClient();

  if (client.status === 'ready' || client.status === 'connecting' || isConnecting) {
    return;
  }

  isConnecting = true;
  try {
    await client.connect();
    isConnecting = false;
    logger.info({ msg: 'Explicit Redis connection established' });
  } catch (error: any) {
    isConnecting = false;
    logger.warn({
      msg: 'Initial Redis connection could not be established; operating in degraded mode',
      error: error.message,
    });
    // In production, whether Redis is mandatory for startup depends on deployment setup.
    // We catch and log without crashing so health checks can report the status safely.
  }
}

/**
 * Clean shutdown procedure for Redis.
 */
export async function disconnectRedis(): Promise<void> {
  if (!redisInstance) return;

  try {
    // Attempt graceful quit (waiting for pending commands)
    const quitPromise = redisInstance.quit();
    const timeoutPromise = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), 2000)
    );

    const result = await Promise.race([quitPromise, timeoutPromise]);
    if (result === 'timeout') {
      logger.warn({ msg: 'Redis quit timed out, forcing disconnect' });
      redisInstance.disconnect();
    } else {
      logger.info({ msg: 'Redis disconnected cleanly' });
    }
  } catch (err: any) {
    logger.warn({ msg: 'Error during Redis disconnect, forcing disconnect', error: err.message });
    redisInstance.disconnect();
  } finally {
    redisInstance = null;
  }
}

/**
 * Checks Redis health with a lightweight PING and bounded timeout (default 2000ms).
 */
export async function checkRedisHealth(timeoutMs = 2000): Promise<boolean> {
  if (!redisInstance || redisInstance.status !== 'ready') {
    return false;
  }

  try {
    const pingPromise = redisInstance.ping();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Redis ping timed out')), timeoutMs)
    );

    const response = await Promise.race([pingPromise, timeoutPromise]);
    return response === 'PONG';
  } catch (error: any) {
    logger.warn({
      msg: 'Redis health check ping failed',
      error: error.message,
    });
    return false;
  }
}
