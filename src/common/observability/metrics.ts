import client from 'prom-client';
import { Router } from 'express';

// Collect default Node.js and system runtime metrics (CPU, Memory, Event Loop, GC)
client.collectDefaultMetrics({
  prefix: 'amrutam_',
  register: client.register,
});

export const metricsRouter = Router();

/**
 * Exposes Prometheus RED and process metrics for scrapers.
 */
metricsRouter.get('/', async (_req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});
