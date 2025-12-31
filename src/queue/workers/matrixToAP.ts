import { Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import { type MatrixToAPJobData, QUEUE_NAMES, getQueueManager } from '../index.js';
import { matrixToAP, generateAPActivityId, type TransformContext } from '../../bridge/transformer.js';
import { type MatrixEvent } from '../../matrix/appservice.js';
import { type MessageContent } from '../../matrix/events.js';
import * as messagesRepo from '../../db/repositories/messages.js';
import * as roomsRepo from '../../db/repositories/rooms.js';
import { queueLogger } from '../../utils/logger.js';

/**
 * Worker context with callbacks
 */
export interface MatrixToAPWorkerContext {
  baseUrl: string;
  domain: string;
  getActorUrl: (matrixUserId: string) => string;
  convertMxcToHttps: (mxcUrl: string) => string;
  getFollowerInboxes: (matrixUserId: string) => Promise<string[]>;
  signAndDeliver: (activity: Record<string, unknown>, inboxUrl: string, keyId: string) => Promise<void>;
}

/**
 * Create the Matrix to AP worker
 */
export function createMatrixToAPWorker(
  connection: IORedis,
  context: MatrixToAPWorkerContext
): Worker {
  const logger = queueLogger();

  const worker = new Worker<MatrixToAPJobData>(
    QUEUE_NAMES.MATRIX_TO_AP,
    async (job: Job<MatrixToAPJobData>) => {
      const { eventId, roomId, sender, eventType, content, timestamp } = job.data;

      logger.info('Processing Matrix to AP job', {
        jobId: job.id,
        eventId,
        eventType,
      });

      try {
        // Reconstruct Matrix event
        const event: MatrixEvent = {
          event_id: eventId,
          room_id: roomId,
          sender,
          type: eventType,
          content: content as Record<string, unknown>,
          origin_server_ts: timestamp,
        };

        // Get or create room mapping
        const room = await roomsRepo.getOrCreateRoom({
          matrixRoomId: roomId,
          apContextId: roomsRepo.generateAPContextId(context.baseUrl, roomId),
        });

        // Build transform context
        const transformContext: TransformContext = {
          domain: context.domain,
          baseUrl: context.baseUrl,
          getActorUrl: context.getActorUrl,
          convertMxcToHttps: context.convertMxcToHttps,
          lookupAPObjectId: async (matrixEventId: string) => {
            const msg = await messagesRepo.findByMatrixEventId(matrixEventId);
            return msg?.ap_object_id ?? null;
          },
        };

        // Transform to AP Note
        const note = await matrixToAP(event, content as MessageContent, transformContext);

        // Store message mapping
        await messagesRepo.upsertMessage({
          matrixEventId: eventId,
          apObjectId: note.id,
          roomId: room.id,
        });

        // Create activity
        const actorUrl = context.getActorUrl(sender);
        const activity = {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: generateAPActivityId(context.baseUrl, 'Create', note.id),
          type: 'Create',
          actor: actorUrl,
          published: note.published,
          to: note.to,
          cc: note.cc,
          object: note,
        };

        // Get follower inboxes
        const inboxes = await context.getFollowerInboxes(sender);

        if (inboxes.length === 0) {
          logger.debug('No inboxes to deliver to', { eventId });
          return { delivered: 0 };
        }

        // Queue delivery jobs
        const queueManager = getQueueManager();
        let queued = 0;

        for (const inboxUrl of inboxes) {
          await queueManager.addAPDeliveryJob({
            activityId: activity.id,
            activity,
            inboxUrl,
            senderKeyId: `${actorUrl}#main-key`,
          });
          queued++;
        }

        logger.info('Queued AP deliveries', {
          eventId,
          activityId: activity.id,
          deliveries: queued,
        });

        return { activityId: activity.id, queued };
      } catch (error) {
        logger.error('Matrix to AP processing failed', {
          jobId: job.id,
          eventId,
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
    logger.debug('Matrix to AP job completed', { jobId: job.id });
  });

  worker.on('failed', (job, error) => {
    logger.error('Matrix to AP job failed', {
      jobId: job?.id,
      error: error.message,
    });
  });

  return worker;
}
