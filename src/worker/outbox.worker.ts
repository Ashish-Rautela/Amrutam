import { OutboxStatus } from '@prisma/client';
import { prisma } from '../infrastructure/database/prisma.js';
import { logger } from '../common/observability/logger.js';

export interface OutboxRecord {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: any;
  status: OutboxStatus;
  retry_count: number;
  max_retries: number;
  last_error: string | null;
  next_retry_at: Date;
  created_at: Date;
  updated_at: Date;
}

export type EventHandler = (event: {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: any;
}) => Promise<void>;

export class OutboxWorker {
  private isRunning = false;
  private isProcessing = false;
  private timer: NodeJS.Timeout | null = null;
  private customHandlers: Map<string, EventHandler> = new Map();

  /**
   * Registers a custom handler for a given event type.
   */
  public registerHandler(eventType: string, handler: EventHandler) {
    this.customHandlers.set(eventType, handler);
  }

  /**
   * Dispatches a single outbox event to its designated handler.
   */
  private async dispatchEvent(event: OutboxRecord): Promise<void> {
    const handler = this.customHandlers.get(event.event_type);
    if (handler) {
      await handler({
        id: event.id,
        eventType: event.event_type,
        aggregateType: event.aggregate_type,
        aggregateId: event.aggregate_id,
        payload: event.payload,
      });
      return;
    }

    // Default dispatcher: log structured event
    logger.info(
      {
        eventId: event.id,
        eventType: event.event_type,
        aggregateType: event.aggregate_type,
        aggregateId: event.aggregate_id,
      },
      `[Outbox] Event published successfully: ${event.event_type}`
    );
  }

  /**
   * Concurrency-safe single batch processing using PostgreSQL `FOR UPDATE SKIP LOCKED`.
   * Multiple worker instances will never process the same records.
   */
  public async processBatch(batchSize = 10): Promise<number> {
    if (this.isProcessing) return 0;
    this.isProcessing = true;

    try {
      // 1. Transactionally lock and claim pending records
      const claimedRecords = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<OutboxRecord[]>`
          SELECT * FROM "outbox_events"
          WHERE ("status" = 'PENDING' AND "next_retry_at" <= NOW())
             OR ("status" = 'PROCESSING' AND "updated_at" <= NOW() - INTERVAL '5 minutes')
          ORDER BY "created_at" ASC
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
        `;

        if (rows.length === 0) {
          return [];
        }

        const ids = rows.map((r) => r.id);
        await tx.$executeRaw`
          UPDATE "outbox_events"
          SET "status" = 'PROCESSING',
              "updated_at" = NOW()
          WHERE "id" = ANY(${ids}::text[])
        `;

        return rows;
      });

      if (claimedRecords.length === 0) {
        return 0;
      }

      // 2. Process each claimed record individually
      for (const record of claimedRecords) {
        try {
          await this.dispatchEvent(record);

          // Mark published
          await prisma.outboxEvent.update({
            where: { id: record.id },
            data: {
              status: OutboxStatus.PUBLISHED,
              lastError: null,
            },
          });
        } catch (error: any) {
          const newRetryCount = record.retry_count + 1;
          const isExhausted = newRetryCount >= record.max_retries;

          const backoffSeconds = Math.min(Math.pow(2, newRetryCount) * 2, 3600); // 4s, 8s, 16s... capped at 1hr
          const nextRetryAt = new Date(Date.now() + backoffSeconds * 1000);

          logger.error(
            {
              eventId: record.id,
              eventType: record.event_type,
              retryCount: newRetryCount,
              maxRetries: record.max_retries,
              error: error.message,
            },
            `[Outbox] Error delivering event ${record.event_type}`
          );

          await prisma.outboxEvent.update({
            where: { id: record.id },
            data: {
              status: isExhausted ? OutboxStatus.FAILED : OutboxStatus.PENDING,
              retryCount: newRetryCount,
              lastError: error.message || 'Unknown processing error',
              nextRetryAt: isExhausted ? record.next_retry_at : nextRetryAt,
            },
          });
        }
      }

      return claimedRecords.length;
    } catch (err: any) {
      logger.error({ error: err.message }, '[Outbox] Batch processing encountered an error');
      return 0;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Starts background polling loop.
   */
  public start(pollIntervalMs = 2000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info(`[Outbox] Background worker started with poll interval ${pollIntervalMs}ms`);

    const poll = async () => {
      if (!this.isRunning) return;
      try {
        await this.processBatch();
      } catch (e: any) {
        logger.error({ error: e.message }, '[Outbox] Worker poll error');
      }

      if (this.isRunning) {
        this.timer = setTimeout(poll, pollIntervalMs);
      }
    };

    poll();
  }

  /**
   * Gracefully stops the worker, waiting for active batch completion.
   */
  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    // Wait for in-flight batch to drain
    while (this.isProcessing) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    logger.info('[Outbox] Background worker stopped gracefully');
  }
}

export const outboxWorker = new OutboxWorker();
