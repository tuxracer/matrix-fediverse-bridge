import { Worker, type Job } from 'bullmq';
import { type Redis } from 'ioredis';
import { type APToMatrixJobData, QUEUE_NAMES } from '../index.js';
import { apToMatrix, type TransformContext } from '../../bridge/transformer.js';
import { type APObject } from '../../activitypub/inbox.js';
import * as messagesRepo from '../../db/repositories/messages.js';
import { queueLogger } from '../../utils/logger.js';

/**
 * Worker context with callbacks
 */
export interface APToMatrixWorkerContext {
  baseUrl: string;
  domain: string;
  getOrCreateGhostUser: (actorId: string) => Promise<string>;
  sendMessage: (
    roomId: string,
    senderId: string,
    content: Record<string, unknown>
  ) => Promise<string>;
  uploadMedia: (url: string) => Promise<string>;
  findRoomForActor: (actorId: string) => Promise<string | null>;
}

/**
 * Create the AP to Matrix worker
 */
export function createAPToMatrixWorker(
  connection: Redis,
  context: APToMatrixWorkerContext
): Worker {
  const logger = queueLogger();

  const worker = new Worker<APToMatrixJobData>(
    QUEUE_NAMES.AP_TO_MATRIX,
    async (job: Job<APToMatrixJobData>) => {
      const { activityId, activityType } = job.data;

      logger.info('Processing AP to Matrix job', {
        jobId: job.id,
        activityId,
        activityType,
      });

      try {
        // Handle different activity types
        switch (activityType) {
          case 'Create':
            return await handleCreate(job.data, context);

          case 'Update':
            return await handleUpdate(job.data, context);

          case 'Delete':
            return await handleDelete(job.data, context);

          case 'Like':
            return await handleLike(job.data, context);

          case 'Announce':
            return await handleAnnounce(job.data, context);

          default:
            logger.debug('Unhandled activity type', { activityType });
            return { handled: false, reason: 'Unhandled activity type' };
        }
      } catch (error) {
        logger.error('AP to Matrix processing failed', {
          jobId: job.id,
          activityId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    {
      connection,
      concurrency: 10,
      limiter: {
        max: 100,
        duration: 1000,
      },
    }
  );

  worker.on('completed', (job) => {
    logger.debug('AP to Matrix job completed', { jobId: job.id });
  });

  worker.on('failed', (job, error) => {
    logger.error('AP to Matrix job failed', {
      jobId: job?.id,
      error: error.message,
    });
  });

  return worker;
}

/**
 * Handle Create activity (new post)
 */
async function handleCreate(
  data: APToMatrixJobData,
  context: APToMatrixWorkerContext
): Promise<{ eventId?: string; handled: boolean }> {
  const logger = queueLogger();
  const { activityId, actorId, object, targetRoomId } = data;

  // Get the object (Note)
  const note = object as unknown as APObject;
  if (note.type !== 'Note' && note.type !== 'Article') {
    return { handled: false, reason: 'Not a Note or Article' } as { handled: boolean };
  }

  // Find target room
  let roomId = targetRoomId;
  if (roomId === undefined) {
    roomId = await context.findRoomForActor(actorId) ?? undefined;
  }

  if (roomId === undefined) {
    logger.debug('No target room found for activity', { activityId, actorId });
    return { handled: false, reason: 'No target room' } as { handled: boolean };
  }

  // Get or create ghost user for the sender
  const ghostUserId = await context.getOrCreateGhostUser(actorId);

  // Build transform context
  const transformContext: TransformContext = {
    domain: context.domain,
    baseUrl: context.baseUrl,
    lookupMatrixEventId: async (apObjectId: string) => {
      const msg = await messagesRepo.findByAPObjectId(apObjectId);
      return msg?.matrix_event_id ?? null;
    },
    convertHttpsToMxc: context.uploadMedia,
  };

  // Transform to Matrix message
  const matrixContent = await apToMatrix(note, transformContext);

  // Send message to Matrix
  const eventId = await context.sendMessage(roomId, ghostUserId, matrixContent as unknown as Record<string, unknown>);

  // Store message mapping
  await messagesRepo.upsertMessage({
    matrixEventId: eventId,
    apObjectId: note.id,
  });

  logger.info('Created Matrix message from AP', {
    activityId,
    eventId,
    roomId,
  });

  return { eventId, handled: true };
}

/**
 * Handle Update activity (edited post)
 */
async function handleUpdate(
  data: APToMatrixJobData,
  _context: APToMatrixWorkerContext
): Promise<{ handled: boolean }> {
  const logger = queueLogger();
  const { activityId, object } = data;

  const note = object as unknown as APObject;

  // Find existing message mapping
  const existing = await messagesRepo.findByAPObjectId(note.id);
  if (existing === null || existing.matrix_event_id === null) {
    logger.debug('No existing message found for update', { apObjectId: note.id });
    return { handled: false };
  }

  // Matrix doesn't support editing in the same way, so we could:
  // 1. Send a new message referencing the old one
  // 2. Use m.replace relation (if supported)
  // For now, just log and return

  logger.debug('Update handling not yet implemented', { activityId });
  return { handled: false };
}

/**
 * Handle Delete activity
 */
async function handleDelete(
  data: APToMatrixJobData,
  _context: APToMatrixWorkerContext
): Promise<{ handled: boolean }> {
  const logger = queueLogger();
  const { activityId, object } = data;

  // Object could be the ID string or an object
  const objectId = typeof object === 'string' ? object : (object as unknown as APObject).id;

  // Find existing message mapping
  const existing = await messagesRepo.findByAPObjectId(objectId);
  if (existing === null || existing.matrix_event_id === null) {
    logger.debug('No existing message found for delete', { apObjectId: objectId });
    return { handled: false };
  }

  // Would need to redact the Matrix event
  // This requires the room ID and redaction capability
  logger.debug('Delete handling not yet fully implemented', { activityId });

  // Remove mapping
  await messagesRepo.deleteByAPObjectId(objectId);

  return { handled: true };
}

/**
 * Handle Like activity (reaction)
 */
async function handleLike(
  data: APToMatrixJobData,
  _context: APToMatrixWorkerContext
): Promise<{ handled: boolean }> {
  const logger = queueLogger();
  const { activityId, object } = data;

  // Object is the liked post
  const objectId = typeof object === 'string' ? object : (object as unknown as APObject).id;

  // Find the Matrix event
  const existing = await messagesRepo.findByAPObjectId(objectId);
  if (existing === null || existing.matrix_event_id === null) {
    logger.debug('No existing message found for like', { apObjectId: objectId });
    return { handled: false };
  }

  // Would need to send m.reaction event
  // This requires the room ID and reaction capability
  logger.debug('Like handling not yet fully implemented', { activityId });

  return { handled: false };
}

/**
 * Handle Announce activity (boost/reblog)
 */
async function handleAnnounce(
  data: APToMatrixJobData,
  _context: APToMatrixWorkerContext
): Promise<{ handled: boolean }> {
  const logger = queueLogger();
  const { activityId } = data;

  // Would need to fetch the original post and share it
  logger.debug('Announce handling not yet fully implemented', { activityId });

  return { handled: false };
}
