import crypto from 'crypto';
import { prisma } from '../../infrastructure/database/prisma.js';
import { BadRequestError, ConflictError } from '../errors/index.js';
import { IdempotencyStatus } from '@prisma/client';

export interface IdempotencyResult<T> {
  status: number;
  body: T;
  cached?: boolean;
}

export function computeRequestHash(body: unknown): string {
  const normalized = JSON.stringify(body ?? {});
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Executes a state-mutating operation with database-backed idempotency.
 * Enforces request payload fingerprinting, concurrent lock guards, and response caching.
 */
export async function withIdempotency<T>(
  scope: string,
  key: string | undefined,
  operation: string,
  payload: unknown,
  execute: () => Promise<{ status: number; body: T }>,
  ttlMinutes = 1440 // 24 hours
): Promise<IdempotencyResult<T>> {
  if (!key || key.trim() === '') {
    const res = await execute();
    return { status: res.status, body: res.body, cached: false };
  }

  const cleanKey = key.trim();
  const requestHash = computeRequestHash(payload);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

  // 1. Check for existing idempotency record
  const existing = await prisma.idempotencyRecord.findUnique({
    where: {
      scope_operation_key_unique: {
        scope,
        operation,
        key: cleanKey,
      },
    },
  });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new BadRequestError('Idempotency key reused with different request payload');
    }

    if (existing.status === IdempotencyStatus.COMPLETED && existing.responseStatus) {
      return {
        status: existing.responseStatus,
        body: existing.responseBody as T,
        cached: true,
      };
    }

    if (existing.status === IdempotencyStatus.PENDING_CLAIM) {
      // If claimed within 2 minutes, another request is in progress
      const claimAgeMs = now.getTime() - existing.claimedAt.getTime();
      if (claimAgeMs < 2 * 60 * 1000) {
        throw new ConflictError('Concurrent request with this idempotency key is currently processing');
      }
      // Stale claim - take over claim
      await prisma.idempotencyRecord.update({
        where: { id: existing.id },
        data: {
          claimedAt: now,
          expiresAt,
          status: IdempotencyStatus.PENDING_CLAIM,
        },
      });
    }
  } else {
    // Attempt to claim record
    try {
      await prisma.idempotencyRecord.create({
        data: {
          scope,
          key: cleanKey,
          operation,
          requestHash,
          status: IdempotencyStatus.PENDING_CLAIM,
          claimedAt: now,
          expiresAt,
        },
      });
    } catch (err: any) {
      // Handled race condition: unique constraint violation
      if (err.code === 'P2002') {
        throw new ConflictError('Concurrent request with this idempotency key is currently processing');
      }
      throw err;
    }
  }

  // 2. Execute business logic
  try {
    const result = await execute();

    // 3. Mark completed and store response
    await prisma.idempotencyRecord.update({
      where: {
        scope_operation_key_unique: {
          scope,
          operation,
          key: cleanKey,
        },
      },
      data: {
        status: IdempotencyStatus.COMPLETED,
        responseStatus: result.status,
        responseBody: result.body as any,
        completedAt: new Date(),
      },
    });

    return { status: result.status, body: result.body, cached: false };
  } catch (executionError) {
    // Release claim on failure to allow retry
    await prisma.idempotencyRecord.deleteMany({
      where: {
        scope,
        operation,
        key: cleanKey,
        status: IdempotencyStatus.PENDING_CLAIM,
      },
    });
    throw executionError;
  }
}
