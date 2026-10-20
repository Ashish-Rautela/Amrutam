import { Router, Request, Response } from 'express';
import { checkDatabaseHealth } from '../../infrastructure/database/prisma.js';
import { checkRedisHealth } from '../../infrastructure/cache/redis.js';

export const healthRouter = Router();

/**
 * Liveness Probe: Returns HTTP 200 if the process event loop is responsive.
 * Does NOT query external databases or caches.
 */
healthRouter.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Readiness Probe: Checks connectivity to essential infrastructure (PostgreSQL & Redis).
 * Returns HTTP 200 if all dependencies are healthy.
 * Returns HTTP 503 if any dependency is degraded or unreachable.
 * Never exposes credentials, connection strings, or stack traces.
 */
healthRouter.get('/ready', async (_req: Request, res: Response) => {
  const [dbHealthy, redisHealthy] = await Promise.all([
    checkDatabaseHealth(2000),
    checkRedisHealth(2000),
  ]);

  const isReady = dbHealthy && redisHealthy;
  const statusCode = isReady ? 200 : 503;

  res.status(statusCode).json({
    status: isReady ? 'ready' : 'unhealthy',
    components: {
      database: dbHealthy ? 'up' : 'down',
      cache: redisHealthy ? 'up' : 'down',
    },
    timestamp: new Date().toISOString(),
  });
});
