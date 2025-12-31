import { bridgeLogger } from '../utils/logger.js';
import { type InboxProcessor, type APActivity } from '../activitypub/inbox.js';
import { type EventProcessor } from '../matrix/events.js';
import { type MatrixEvent } from '../matrix/appservice.js';
import { getModerationService, type ReportDetails } from './moderation.js';

/**
 * Context for Matrix moderation actions
 */
export interface MatrixModerationContext {
  redactEvent: (roomId: string, eventId: string, reason?: string) => Promise<void>;
  sendNotice: (roomId: string, message: string) => Promise<void>;
  getAdminRoomId: () => string | undefined;
}

/**
 * Register moderation activity handlers on the inbox processor
 */
export function registerInboxModerationHandlers(
  inboxProcessor: InboxProcessor,
  matrixContext: MatrixModerationContext
): void {
  const logger = bridgeLogger();

  // Handle Delete activities
  inboxProcessor.onDelete(async (activity: APActivity, actorId: string) => {
    const moderationService = getModerationService();
    if (moderationService === null) {
      logger.warn('Moderation service not initialized, cannot handle Delete');
      return;
    }

    // Check if actor is from a blocked instance
    if (await moderationService.isActorBlocked(actorId)) {
      logger.debug('Ignoring Delete from blocked instance', { actorId });
      return;
    }

    const result = await moderationService.handleIncomingDelete(activity, actorId);
    if (result === null) {
      return;
    }

    // Redact the Matrix event
    try {
      await matrixContext.redactEvent(result.roomId, result.matrixEventId, 'Deleted by author');
      logger.info('Redacted Matrix event from AP Delete', {
        eventId: result.matrixEventId,
        actorId,
      });
    } catch (error) {
      logger.error('Failed to redact Matrix event', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Handle Block activities
  inboxProcessor.onBlock(async (activity: APActivity, actorId: string) => {
    const moderationService = getModerationService();
    if (moderationService === null) {
      logger.warn('Moderation service not initialized, cannot handle Block');
      return;
    }

    await moderationService.handleIncomingBlock(activity, actorId);
  });

  // Handle Flag (report) activities
  // Note: Flag is not a standard activity type in the inbox processor,
  // so we'll handle it through a custom extension or Create wrapper
}

/**
 * Register a custom handler for Flag activities
 */
export function registerFlagHandler(
  processActivity: (type: string, handler: (activity: APActivity, actorId: string) => Promise<void>) => void,
  matrixContext: MatrixModerationContext
): void {
  const logger = bridgeLogger();

  processActivity('Flag', async (activity: APActivity, actorId: string) => {
    const moderationService = getModerationService();
    if (moderationService === null) {
      logger.warn('Moderation service not initialized, cannot handle Flag');
      return;
    }

    const report = await moderationService.handleIncomingReport(activity, actorId);
    if (report === null) {
      return;
    }

    // Forward report to admin room
    const adminRoomId = matrixContext.getAdminRoomId();
    if (adminRoomId !== undefined) {
      await forwardReportToAdminRoom(report, matrixContext, adminRoomId);
    }
  });
}

/**
 * Forward a report to the admin room
 */
async function forwardReportToAdminRoom(
  report: ReportDetails,
  matrixContext: MatrixModerationContext,
  adminRoomId: string
): Promise<void> {
  const logger = bridgeLogger();

  const message = [
    '🚨 **New Report Received**',
    '',
    `**Reporter:** ${report.reporter}`,
    `**Reported User:** ${report.reportedActor}`,
    report.reportedObject !== undefined ? `**Reported Content:** ${report.reportedObject}` : '',
    `**Reason:** ${report.reason}`,
    '',
    `_Received at ${new Date().toISOString()}_`,
  ].filter(Boolean).join('\n');

  try {
    await matrixContext.sendNotice(adminRoomId, message);
    logger.info('Forwarded report to admin room', { adminRoomId });
  } catch (error) {
    logger.error('Failed to forward report to admin room', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Register redaction handler on the Matrix event processor
 */
export function registerMatrixRedactionHandler(
  eventProcessor: EventProcessor,
  sendDeleteToAP: (redactorUserId: string, redactedEventId: string) => Promise<void>
): void {
  const logger = bridgeLogger();

  eventProcessor.onRedaction(async (event: MatrixEvent) => {
    const redactedEventId = event.content['redacts'] as string | undefined;
    if (redactedEventId === undefined) {
      return;
    }

    logger.debug('Processing Matrix redaction for AP', {
      sender: event.sender,
      redactedEventId,
    });

    try {
      await sendDeleteToAP(event.sender, redactedEventId);
      logger.info('Sent Delete activity for Matrix redaction', {
        from: event.sender,
        redactedEventId,
      });
    } catch (error) {
      logger.error('Failed to send Delete activity', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

/**
 * Create a function to send Delete activities to AP
 */
export function createDeleteSender(): (redactorUserId: string, redactedEventId: string) => Promise<void> {
  return async (redactorUserId: string, redactedEventId: string) => {
    const moderationService = getModerationService();
    if (moderationService === null) {
      throw new Error('Moderation service not initialized');
    }

    const result = await moderationService.handleMatrixRedaction(redactedEventId, redactorUserId);
    if (!result.success) {
      throw new Error(result.message);
    }
  };
}

/**
 * Filter incoming activities from blocked instances
 */
export async function shouldFilterActivity(actorId: string): Promise<boolean> {
  const moderationService = getModerationService();
  if (moderationService === null) {
    return false;
  }

  return moderationService.isActorBlocked(actorId);
}
