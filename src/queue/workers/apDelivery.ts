import { Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import { type APDeliveryJobData, QUEUE_NAMES } from '../index.js';
import { SignatureManager, generateDigest } from '../../activitypub/signatures.js';
import { queueLogger } from '../../utils/logger.js';

/**
 * Delivery result
 */
export interface DeliveryResult {
  success: boolean;
  statusCode?: number;
  error?: string;
  retryable?: boolean;
}

/**
 * Worker context with callbacks
 */
export interface APDeliveryWorkerContext {
  getPrivateKey: (keyId: string) => Promise<string | null>;
  userAgent: string;
}

/**
 * HTTP status codes that indicate temporary failures (should retry)
 */
const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

/**
 * HTTP status codes that indicate permanent failures (should not retry)
 */
const PERMANENT_FAILURE_CODES = [400, 401, 403, 404, 405, 410, 422];

/**
 * Create the AP delivery worker
 */
export function createAPDeliveryWorker(
  connection: IORedis,
  context: APDeliveryWorkerContext
): Worker {
  const logger = queueLogger();
  const signatureManager = new SignatureManager();

  const worker = new Worker<APDeliveryJobData>(
    QUEUE_NAMES.AP_DELIVERY,
    async (job: Job<APDeliveryJobData>): Promise<DeliveryResult> => {
      const { activityId, activity, inboxUrl, senderKeyId, retryCount = 0 } = job.data;

      logger.info('Delivering activity', {
        jobId: job.id,
        activityId,
        inboxUrl,
        attempt: job.attemptsMade + 1,
      });

      try {
        // Get private key for signing
        const privateKey = await context.getPrivateKey(senderKeyId);
        if (privateKey === null) {
          logger.error('Private key not found', { keyId: senderKeyId });
          return {
            success: false,
            error: 'Private key not found',
            retryable: false,
          };
        }

        // Serialize activity
        const body = JSON.stringify(activity);

        // Sign request
        const signedHeaders = signatureManager.signRequest(
          'POST',
          inboxUrl,
          body,
          {
            keyId: senderKeyId,
            privateKey,
          }
        );

        // Make request
        const response = await fetch(inboxUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/activity+json',
            Accept: 'application/activity+json',
            'User-Agent': context.userAgent,
            Date: signedHeaders.Date,
            Digest: signedHeaders.Digest ?? generateDigest(body),
            Signature: signedHeaders.Signature,
            Host: signedHeaders.Host,
          },
          body,
        });

        const statusCode = response.status;

        // Check for success (2xx)
        if (statusCode >= 200 && statusCode < 300) {
          logger.info('Activity delivered successfully', {
            activityId,
            inboxUrl,
            statusCode,
          });
          return { success: true, statusCode };
        }

        // Check for permanent failure
        if (PERMANENT_FAILURE_CODES.includes(statusCode)) {
          const errorBody = await response.text().catch(() => 'Unable to read body');
          logger.warn('Permanent delivery failure', {
            activityId,
            inboxUrl,
            statusCode,
            error: errorBody.slice(0, 500),
          });
          return {
            success: false,
            statusCode,
            error: `HTTP ${statusCode}`,
            retryable: false,
          };
        }

        // Check for retryable failure
        if (RETRYABLE_STATUS_CODES.includes(statusCode)) {
          const errorBody = await response.text().catch(() => 'Unable to read body');
          logger.warn('Retryable delivery failure', {
            activityId,
            inboxUrl,
            statusCode,
            error: errorBody.slice(0, 500),
          });
          throw new Error(`HTTP ${statusCode}: ${errorBody.slice(0, 100)}`);
        }

        // Unknown status code - treat as retryable
        logger.warn('Unexpected status code', {
          activityId,
          inboxUrl,
          statusCode,
        });
        throw new Error(`Unexpected HTTP ${statusCode}`);
      } catch (error) {
        // Network errors are retryable
        if (error instanceof TypeError && error.message.includes('fetch')) {
          logger.warn('Network error during delivery', {
            activityId,
            inboxUrl,
            error: error.message,
          });
          throw error; // Will be retried by BullMQ
        }

        // Re-throw to trigger retry
        throw error;
      }
    },
    {
      connection,
      concurrency: 20, // Higher concurrency for delivery
      limiter: {
        max: 50,
        duration: 1000,
      },
    }
  );

  worker.on('completed', (job, result: DeliveryResult) => {
    if (result.success) {
      logger.debug('Delivery job completed', {
        jobId: job.id,
        statusCode: result.statusCode,
      });
    }
  });

  worker.on('failed', (job, error) => {
    logger.error('Delivery job failed', {
      jobId: job?.id,
      attempts: job?.attemptsMade,
      error: error.message,
    });
  });

  // Log when job moves to dead letter queue
  worker.on('error', (error) => {
    logger.error('Worker error', { error: error.message });
  });

  return worker;
}

/**
 * Check if an inbox URL should be skipped (e.g., blocked instance)
 */
export function shouldSkipInbox(
  inboxUrl: string,
  blockedInstances: Set<string>
): boolean {
  try {
    const url = new URL(inboxUrl);
    return blockedInstances.has(url.hostname.toLowerCase());
  } catch {
    return true; // Skip invalid URLs
  }
}

/**
 * Group deliveries by shared inbox to reduce requests
 */
export function groupBySharedInbox(
  deliveries: { inboxUrl: string; sharedInboxUrl?: string }[]
): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const delivery of deliveries) {
    const targetInbox = delivery.sharedInboxUrl ?? delivery.inboxUrl;
    const existing = groups.get(targetInbox) ?? [];
    existing.push(delivery.inboxUrl);
    groups.set(targetInbox, existing);
  }

  return groups;
}
