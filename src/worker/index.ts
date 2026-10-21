import { outboxWorker } from './outbox.worker.js';
import { disconnectDatabase } from '../infrastructure/database/prisma.js';
import { logger } from '../common/observability/logger.js';

logger.info('[Worker] Starting Amrutam background worker process...');

outboxWorker.start(2000);

async function handleShutdown(signal: string) {
  logger.info(`[Worker] Received ${signal}. Shutting down worker gracefully...`);
  try {
    await outboxWorker.stop();
    await disconnectDatabase();
    logger.info('[Worker] Shutdown complete.');
    process.exit(0);
  } catch (err: any) {
    logger.error({ error: err.message }, '[Worker] Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
