import { app } from './app.js';
import { config } from './config/index.js';
import { logger } from './common/observability/logger.js';
import { connectDatabase, disconnectDatabase } from './infrastructure/database/prisma.js';
import { connectRedis, disconnectRedis } from './infrastructure/cache/redis.js';

let isShuttingDown = false;

async function bootstrap() {
  try {
    logger.info({
      msg: `Starting ${config.APP_NAME} in [${config.NODE_ENV}] mode`,
      port: config.PORT,
      apiPrefix: config.API_PREFIX,
    });

    // 1. Establish database connection
    await connectDatabase();

    // 2. Establish Redis connection
    await connectRedis();

    // 3. Start HTTP Server
    const server = app.listen(config.PORT, () => {
      logger.info({
        msg: `HTTP server listening on port ${config.PORT}`,
        healthLiveness: `http://localhost:${config.PORT}/health/live`,
        healthReadiness: `http://localhost:${config.PORT}/health/ready`,
      });
    });

    // 4. Graceful Shutdown Management
    const shutdown = async (signal: string) => {
      if (isShuttingDown) return;
      isShuttingDown = true;

      logger.info({ msg: `Received ${signal}. Starting graceful shutdown sequence...` });

      // Set bounded timeout to force process termination if connections hang
      const forceExitTimer = setTimeout(() => {
        logger.error({ msg: 'Graceful shutdown timed out after 10s. Forcing exit.' });
        process.exit(1);
      }, 10000);
      forceExitTimer.unref();

      // Stop accepting new HTTP requests
      server.close(async () => {
        logger.info({ msg: 'HTTP server stopped accepting new connections' });

        // Disconnect infrastructure clients cleanly
        await disconnectRedis();
        await disconnectDatabase();

        logger.info({ msg: 'Shutdown completed cleanly. Exiting process.' });
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error: any) {
    logger.error({
      msg: 'Fatal error during server bootstrap',
      error: error.message,
    });
    process.exit(1);
  }
}

// Only bootstrap automatically if executed directly as entrypoint
if (process.argv[1]?.includes('server')) {
  bootstrap();
}

export { bootstrap };
