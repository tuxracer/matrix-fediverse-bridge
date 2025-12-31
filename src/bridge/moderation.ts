import { randomUUID } from 'crypto';
import { bridgeLogger } from '../utils/logger.js';
import * as usersRepo from '../db/repositories/users.js';
import * as messagesRepo from '../db/repositories/messages.js';
import * as blocksRepo from '../db/repositories/blocks.js';
import { type APActivity, type APObject } from '../activitypub/inbox.js';

/**
 * Moderation service configuration
 */
export interface ModerationServiceConfig {
  domain: string;
  baseUrl: string;
  adminUsers: string[];
  adminRoomId?: string;
  signAndDeliver: (activity: APActivity, targetInbox: string) => Promise<void>;
}

/**
 * Report details
 */
export interface ReportDetails {
  reporter: string;
  reportedActor: string;
  reportedObject?: string;
  content: string;
  reason: string;
}

/**
 * Moderation service for handling blocks, deletions, and reports
 */
export class ModerationService {
  private config: ModerationServiceConfig;
  private logger = bridgeLogger();

  constructor(config: ModerationServiceConfig) {
    this.config = config;
  }

  // ==================== Admin Checks ====================

  /**
   * Check if a Matrix user is an admin
   */
  isAdmin(matrixUserId: string): boolean {
    return this.config.adminUsers.includes(matrixUserId);
  }

  /**
   * Get admin room ID
   */
  getAdminRoomId(): string | undefined {
    return this.config.adminRoomId;
  }

  // ==================== Message Deletion ====================

  /**
   * Handle Matrix redaction and send Delete activity to AP
   */
  async handleMatrixRedaction(
    redactedEventId: string,
    redactorUserId: string
  ): Promise<{ success: boolean; message: string }> {
    // Look up the AP object ID for this event
    const message = await messagesRepo.findByMatrixEventId(redactedEventId);
    if (message === null || message.ap_object_id === null) {
      return { success: false, message: 'Message not found in bridge' };
    }

    // Create Delete activity
    const localActorUrl = this.getLocalActorUrl(redactorUserId);
    const deleteId = `${this.config.baseUrl}/activities/${randomUUID()}`;

    const deleteActivity: APActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: deleteId,
      type: 'Delete',
      actor: localActorUrl,
      object: message.ap_object_id,
      published: new Date().toISOString(),
    };

    // Get sender info to find their followers for delivery
    const senderUser = message.sender_id !== null
      ? await usersRepo.findById(message.sender_id)
      : null;

    // Deliver to followers (simplified - would need full fan-out in production)
    // For now, just log and remove local record
    this.logger.info('Created Delete activity for redacted message', {
      eventId: redactedEventId,
      apObjectId: message.ap_object_id,
      deleteId,
    });

    // Remove message mapping
    await messagesRepo.deleteByMatrixEventId(redactedEventId);

    return { success: true, message: 'Delete activity created' };
  }

  /**
   * Handle incoming Delete activity from AP
   */
  async handleIncomingDelete(
    activity: APActivity,
    actorId: string
  ): Promise<{ matrixEventId: string; roomId: string } | null> {
    const objectId = typeof activity.object === 'string'
      ? activity.object
      : (activity.object as APObject)?.id;

    if (objectId === undefined) {
      this.logger.warn('Delete activity missing object', { activityId: activity.id });
      return null;
    }

    // Check if this is a tombstone (deleted actor)
    if (typeof activity.object === 'object' && (activity.object as APObject).type === 'Tombstone') {
      this.logger.info('Received tombstone for deleted actor', { actorId });
      // Handle actor deletion if needed
      return null;
    }

    // Look up the Matrix event ID
    const message = await messagesRepo.findByAPObjectId(objectId);
    if (message === null || message.matrix_event_id === null) {
      this.logger.debug('Delete target not found in bridge', { objectId });
      return null;
    }

    // Remove message mapping
    await messagesRepo.deleteByAPObjectId(objectId);

    this.logger.info('Processing Delete activity', {
      actorId,
      objectId,
      matrixEventId: message.matrix_event_id,
    });

    // Return info for the caller to redact the Matrix event
    return {
      matrixEventId: message.matrix_event_id,
      roomId: message.room_id ?? '',
    };
  }

  // ==================== User Blocking ====================

  /**
   * Block an AP user
   */
  async blockUser(
    matrixUserId: string,
    targetActorId: string,
    reason?: string
  ): Promise<{ success: boolean; message: string }> {
    // Get or create local user
    const localUser = await usersRepo.getOrCreateByMatrixId(matrixUserId);

    // Get or create remote user record
    const remoteUser = await usersRepo.getOrCreateByAPActorId(targetActorId);

    // Create block record
    const apBlockId = `${this.config.baseUrl}/activities/${randomUUID()}`;
    await blocksRepo.createUserBlock({
      blockerId: localUser.id,
      blockedUserId: remoteUser.id,
      reason,
      apBlockId,
    });

    // Create Block activity
    const localActorUrl = this.getLocalActorUrl(matrixUserId);
    const blockActivity: APActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: apBlockId,
      type: 'Block',
      actor: localActorUrl,
      object: targetActorId,
    };

    // Deliver to blocked user (optional, some implementations skip this)
    try {
      if (remoteUser.ap_inbox_url !== null) {
        await this.config.signAndDeliver(blockActivity, remoteUser.ap_inbox_url);
      }
    } catch (error) {
      // Block delivery failure is not critical
      this.logger.debug('Block activity delivery failed (non-critical)', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    this.logger.info('Blocked user', {
      blocker: matrixUserId,
      blocked: targetActorId,
    });

    return { success: true, message: `Blocked ${targetActorId}` };
  }

  /**
   * Unblock an AP user
   */
  async unblockUser(
    matrixUserId: string,
    targetActorId: string
  ): Promise<{ success: boolean; message: string }> {
    const localUser = await usersRepo.findByMatrixId(matrixUserId);
    if (localUser === null) {
      return { success: false, message: 'User not found' };
    }

    const remoteUser = await usersRepo.findByAPActorId(targetActorId);
    if (remoteUser === null) {
      return { success: false, message: 'Target user not found' };
    }

    const deleted = await blocksRepo.deleteUserBlock(localUser.id, remoteUser.id);
    if (!deleted) {
      return { success: false, message: 'User was not blocked' };
    }

    // Send Undo Block activity
    const localActorUrl = this.getLocalActorUrl(matrixUserId);
    const undoId = `${this.config.baseUrl}/activities/${randomUUID()}`;

    const undoActivity: APActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: undoId,
      type: 'Undo',
      actor: localActorUrl,
      object: {
        id: `${this.config.baseUrl}/activities/block-${localUser.id}-${remoteUser.id}`,
        type: 'Block',
        actor: localActorUrl,
        object: targetActorId,
      } as APActivity,
    };

    try {
      if (remoteUser.ap_inbox_url !== null) {
        await this.config.signAndDeliver(undoActivity, remoteUser.ap_inbox_url);
      }
    } catch {
      // Non-critical
    }

    this.logger.info('Unblocked user', {
      blocker: matrixUserId,
      unblocked: targetActorId,
    });

    return { success: true, message: `Unblocked ${targetActorId}` };
  }

  /**
   * Handle incoming Block activity
   */
  async handleIncomingBlock(activity: APActivity, actorId: string): Promise<void> {
    const blockedActorId = typeof activity.object === 'string'
      ? activity.object
      : (activity.object as APObject)?.id;

    if (blockedActorId === undefined) {
      return;
    }

    // Check if the blocked actor is one of our users
    const username = this.extractUsernameFromActorUrl(blockedActorId);
    if (username === null) {
      return;
    }

    this.logger.info('Received block from remote user', {
      blocker: actorId,
      blocked: blockedActorId,
    });

    // We could store this block to prevent sending messages to users who blocked us
  }

  /**
   * Check if a user is blocked
   */
  async isUserBlocked(blockerId: string, blockedUserId: string): Promise<boolean> {
    return blocksRepo.isUserBlocked(blockerId, blockedUserId);
  }

  // ==================== Instance Blocking ====================

  /**
   * Block an instance (admin only)
   */
  async blockInstance(
    adminUserId: string,
    instance: string,
    reason?: string
  ): Promise<{ success: boolean; message: string }> {
    if (!this.isAdmin(adminUserId)) {
      return { success: false, message: 'Admin privileges required' };
    }

    // Normalize instance domain
    const normalizedInstance = instance.toLowerCase().trim();

    await blocksRepo.createInstanceBlock({
      blockedInstance: normalizedInstance,
      reason,
    });

    this.logger.info('Blocked instance', {
      admin: adminUserId,
      instance: normalizedInstance,
      reason,
    });

    return { success: true, message: `Blocked instance: ${normalizedInstance}` };
  }

  /**
   * Unblock an instance (admin only)
   */
  async unblockInstance(
    adminUserId: string,
    instance: string
  ): Promise<{ success: boolean; message: string }> {
    if (!this.isAdmin(adminUserId)) {
      return { success: false, message: 'Admin privileges required' };
    }

    const deleted = await blocksRepo.deleteInstanceBlock(instance);
    if (!deleted) {
      return { success: false, message: 'Instance was not blocked' };
    }

    this.logger.info('Unblocked instance', {
      admin: adminUserId,
      instance,
    });

    return { success: true, message: `Unblocked instance: ${instance}` };
  }

  /**
   * Check if an instance is blocked
   */
  async isInstanceBlocked(instance: string): Promise<boolean> {
    return blocksRepo.isInstanceBlocked(instance);
  }

  /**
   * Check if an actor URL is from a blocked instance
   */
  async isActorBlocked(actorUrl: string): Promise<boolean> {
    return blocksRepo.isActorFromBlockedInstance(actorUrl);
  }

  /**
   * Get list of blocked instances
   */
  async getBlockedInstances(): Promise<string[]> {
    return blocksRepo.getBlockedInstanceDomains();
  }

  // ==================== Reporting ====================

  /**
   * Send a report (Flag activity)
   */
  async sendReport(
    reporterUserId: string,
    targetActorId: string,
    reason: string
  ): Promise<{ success: boolean; message: string }> {
    const localActorUrl = this.getLocalActorUrl(reporterUserId);
    const flagId = `${this.config.baseUrl}/activities/${randomUUID()}`;

    // Build the Flag activity
    // Note: Flag activities can have an array of objects, but we simplify to a single target
    const flagActivity: APActivity & { content?: string } = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: flagId,
      type: 'Flag',
      actor: localActorUrl,
      object: targetActorId,
      content: reason,
    };

    // Try to fetch actor to get inbox
    try {
      const response = await fetch(targetActorId, {
        headers: {
          Accept: 'application/activity+json',
        },
      });

      if (response.ok) {
        const actor = (await response.json()) as { inbox: string };
        await this.config.signAndDeliver(flagActivity, actor.inbox);

        this.logger.info('Sent report', {
          reporter: reporterUserId,
          target: targetActorId,
          reason,
        });

        return { success: true, message: 'Report sent' };
      }
    } catch (error) {
      this.logger.error('Failed to send report', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { success: false, message: 'Failed to send report' };
  }

  /**
   * Handle incoming Flag (report) activity
   */
  async handleIncomingReport(
    activity: APActivity,
    actorId: string
  ): Promise<ReportDetails | null> {
    const object = activity.object;
    const reason = (activity as APActivity & { content?: string }).content ?? 'No reason provided';

    let reportedActor: string | undefined;
    let reportedObjects: string[] = [];

    if (typeof object === 'string') {
      reportedActor = object;
    } else if (Array.isArray(object)) {
      for (const item of object) {
        const itemId = typeof item === 'string' ? item : (item as APObject).id;
        // First item is usually the actor, rest are objects
        if (reportedActor === undefined) {
          reportedActor = itemId;
        } else {
          reportedObjects.push(itemId);
        }
      }
    }

    if (reportedActor === undefined) {
      return null;
    }

    this.logger.info('Received report', {
      reporter: actorId,
      reportedActor,
      objectCount: reportedObjects.length,
    });

    return {
      reporter: actorId,
      reportedActor,
      reportedObject: reportedObjects[0],
      content: reason,
      reason,
    };
  }

  // ==================== Admin Statistics ====================

  /**
   * Get bridge statistics
   */
  async getStats(): Promise<{
    users: { total: number; puppets: number; doublePuppets: number };
    messages: number;
    rooms: number;
    blocks: { users: number; instances: number };
  }> {
    const [
      totalUsers,
      puppetCount,
      doublePuppetCount,
      messageCount,
      roomCount,
      instanceBlockCount,
    ] = await Promise.all([
      usersRepo.countAll(),
      usersRepo.countPuppets(),
      usersRepo.countDoublePuppets(),
      messagesRepo.countAll(),
      this.getRoomCount(),
      blocksRepo.countInstanceBlocks(),
    ]);

    return {
      users: {
        total: totalUsers,
        puppets: puppetCount,
        doublePuppets: doublePuppetCount,
      },
      messages: messageCount,
      rooms: roomCount,
      blocks: {
        users: 0, // Would need to aggregate user blocks
        instances: instanceBlockCount,
      },
    };
  }

  private async getRoomCount(): Promise<number> {
    // Import dynamically to avoid circular dependency
    const roomsRepo = await import('../db/repositories/rooms.js');
    return roomsRepo.countAll();
  }

  // ==================== User Purge ====================

  /**
   * Purge all data for a remote ActivityPub user
   * This removes the user record and all associated data
   */
  async purgeRemoteUser(handle: string): Promise<{ success: boolean; message: string }> {
    // Parse the handle (e.g., @user@instance or user@instance)
    const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;
    const atIndex = cleanHandle.indexOf('@');

    if (atIndex === -1) {
      return { success: false, message: 'Invalid handle format. Use @user@instance' };
    }

    const username = cleanHandle.slice(0, atIndex);
    const instance = cleanHandle.slice(atIndex + 1);

    // Construct the likely actor ID
    const actorId = `https://${instance}/users/${username}`;

    // Look up the user
    const user = await usersRepo.findByAPActorId(actorId);
    if (user === null) {
      return { success: false, message: `User ${handle} not found in bridge database` };
    }

    // Delete related data
    try {
      // Delete messages from this user
      await messagesRepo.deleteBySenderId(user.id);

      // Delete blocks involving this user
      await blocksRepo.deleteBlocksForUser(user.id);

      // Delete follows involving this user
      const followsRepo = await import('../db/repositories/follows.js');
      await followsRepo.deleteFollowsForUser(user.id);

      // Delete the user record
      await usersRepo.deleteById(user.id);

      this.logger.info('Purged remote user', {
        handle,
        userId: user.id,
      });

      return { success: true, message: `Purged all data for ${handle}` };
    } catch (error) {
      this.logger.error('Failed to purge remote user', {
        handle,
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, message: 'Failed to purge user data' };
    }
  }

  // ==================== Utility Methods ====================

  /**
   * Get the local actor URL for a Matrix user
   */
  private getLocalActorUrl(matrixUserId: string): string {
    const username = this.usernameFromMatrixUserId(matrixUserId);
    return `${this.config.baseUrl}/users/${username}`;
  }

  /**
   * Convert a Matrix user ID to a username
   */
  private usernameFromMatrixUserId(matrixUserId: string): string {
    const match = matrixUserId.match(/^@([^:]+):(.+)$/);
    if (match !== null && match[1] !== undefined && match[2] !== undefined) {
      return `${match[1]}_${match[2].replace(/\./g, '_')}`;
    }
    return matrixUserId.replace(/[@:]/g, '_');
  }

  /**
   * Extract username from a local actor URL
   */
  private extractUsernameFromActorUrl(actorUrl: string): string | null {
    const prefix = `${this.config.baseUrl}/users/`;
    if (actorUrl.startsWith(prefix)) {
      return actorUrl.slice(prefix.length);
    }
    return null;
  }
}

/**
 * Shared moderation service instance
 */
let sharedModerationService: ModerationService | null = null;

export function initModerationService(config: ModerationServiceConfig): ModerationService {
  sharedModerationService = new ModerationService(config);
  return sharedModerationService;
}

export function getModerationService(): ModerationService | null {
  return sharedModerationService;
}
