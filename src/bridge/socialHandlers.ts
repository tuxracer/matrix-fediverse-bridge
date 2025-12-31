import { bridgeLogger } from '../utils/logger.js';
import { type InboxProcessor, type APActivity } from '../activitypub/inbox.js';
import { type EventProcessor, type ReactionContent } from '../matrix/events.js';
import { type MatrixEvent } from '../matrix/appservice.js';
import { getSocialService } from './social.js';
import * as messagesRepo from '../db/repositories/messages.js';

/**
 * Context for sending Matrix messages
 */
export interface MatrixSendContext {
  sendReaction: (roomId: string, eventId: string, emoji: string, senderId: string) => Promise<string>;
  sendMessage: (roomId: string, content: Record<string, unknown>, senderId: string) => Promise<string>;
  redactEvent: (roomId: string, eventId: string, reason?: string) => Promise<void>;
  getGhostUserId: (apActorId: string) => Promise<string>;
  getRoomForActor: (apActorId: string) => Promise<string | null>;
}

/**
 * Register social activity handlers on the inbox processor
 */
export function registerInboxSocialHandlers(
  inboxProcessor: InboxProcessor,
  matrixContext: MatrixSendContext
): void {
  const logger = bridgeLogger();

  // Handle Follow activities
  inboxProcessor.onFollow(async (activity: APActivity, actorId: string) => {
    const socialService = getSocialService();
    if (socialService === null) {
      logger.warn('Social service not initialized, cannot handle Follow');
      return;
    }

    await socialService.handleIncomingFollow(activity, actorId);
  });

  // Handle Accept activities
  inboxProcessor.onAccept(async (activity: APActivity, actorId: string) => {
    const socialService = getSocialService();
    if (socialService === null) {
      logger.warn('Social service not initialized, cannot handle Accept');
      return;
    }

    await socialService.handleIncomingAccept(activity, actorId);
  });

  // Handle Reject activities
  inboxProcessor.onReject(async (activity: APActivity, actorId: string) => {
    const socialService = getSocialService();
    if (socialService === null) {
      logger.warn('Social service not initialized, cannot handle Reject');
      return;
    }

    await socialService.handleIncomingReject(activity, actorId);
  });

  // Handle Undo activities
  inboxProcessor.onUndo(async (activity: APActivity, actorId: string) => {
    const socialService = getSocialService();
    if (socialService === null) {
      logger.warn('Social service not initialized, cannot handle Undo');
      return;
    }

    await socialService.handleIncomingUndo(activity, actorId);
  });

  // Handle Like activities (reactions)
  inboxProcessor.onLike(async (activity: APActivity, actorId: string) => {
    const socialService = getSocialService();
    if (socialService === null) {
      logger.warn('Social service not initialized, cannot handle Like');
      return;
    }

    const likeResult = await socialService.handleIncomingLike(activity, actorId);
    if (likeResult === null) {
      return;
    }

    // Find the room for this message
    const message = await messagesRepo.findByMatrixEventId(likeResult.matrixEventId);
    if (message === null || message.room_id === null) {
      logger.debug('Cannot find room for liked message', { eventId: likeResult.matrixEventId });
      return;
    }

    // Get the ghost user for the reactor
    try {
      const ghostUserId = await matrixContext.getGhostUserId(actorId);

      // Get room ID from message record (need to look up)
      const roomId = await matrixContext.getRoomForActor(actorId);
      if (roomId === null) {
        // Use a default room or skip
        logger.debug('No room found for reaction', { actorId });
        return;
      }

      await matrixContext.sendReaction(roomId, likeResult.matrixEventId, likeResult.emoji, ghostUserId);
      logger.info('Bridged reaction from AP to Matrix', {
        from: actorId,
        eventId: likeResult.matrixEventId,
        emoji: likeResult.emoji,
      });
    } catch (error) {
      logger.error('Failed to bridge reaction to Matrix', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Handle Announce activities (boosts)
  inboxProcessor.onAnnounce(async (activity: APActivity, actorId: string) => {
    const socialService = getSocialService();
    if (socialService === null) {
      logger.warn('Social service not initialized, cannot handle Announce');
      return;
    }

    const announceResult = await socialService.handleIncomingAnnounce(activity, actorId);
    if (announceResult === null) {
      return;
    }

    // Get the ghost user for the booster
    try {
      const ghostUserId = await matrixContext.getGhostUserId(actorId);
      const roomId = await matrixContext.getRoomForActor(actorId);

      if (roomId === null) {
        logger.debug('No room found for boost', { actorId });
        return;
      }

      // Create a message representing the boost
      const boostContent: Record<string, unknown> = {
        msgtype: 'm.text',
        body: `🔁 Boosted: ${announceResult.originalObject.content ?? '[content unavailable]'}`,
        format: 'org.matrix.custom.html',
        formatted_body: `<p>🔁 <strong>Boosted:</strong></p>${announceResult.originalObject.content ?? '<em>[content unavailable]</em>'}`,
      };

      await matrixContext.sendMessage(roomId, boostContent, ghostUserId);
      logger.info('Bridged boost from AP to Matrix', {
        from: actorId,
        originalObjectId: announceResult.originalObject.id,
      });
    } catch (error) {
      logger.error('Failed to bridge boost to Matrix', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

/**
 * Register reaction handler on the Matrix event processor
 */
export function registerMatrixReactionHandler(
  eventProcessor: EventProcessor,
  sendReactionToAP: (matrixUserId: string, targetEventId: string, emoji: string) => Promise<void>
): void {
  const logger = bridgeLogger();

  eventProcessor.onReaction(async (event: MatrixEvent, content: ReactionContent) => {
    const targetEventId = content['m.relates_to'].event_id;
    const emoji = content['m.relates_to'].key;

    logger.debug('Processing Matrix reaction for AP', {
      sender: event.sender,
      targetEventId,
      emoji,
    });

    try {
      await sendReactionToAP(event.sender, targetEventId, emoji);
      logger.info('Bridged reaction from Matrix to AP', {
        from: event.sender,
        targetEventId,
        emoji,
      });
    } catch (error) {
      logger.error('Failed to bridge reaction to AP', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

/**
 * Create a function to send reactions to AP
 */
export function createReactionSender(): (matrixUserId: string, targetEventId: string, emoji: string) => Promise<void> {
  return async (matrixUserId: string, targetEventId: string, emoji: string) => {
    const socialService = getSocialService();
    if (socialService === null) {
      throw new Error('Social service not initialized');
    }

    const result = await socialService.sendReaction(matrixUserId, targetEventId, emoji);
    if (!result.success) {
      throw new Error(result.message);
    }
  };
}
