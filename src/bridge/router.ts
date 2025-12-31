import { type MatrixEvent } from '../matrix/appservice.js';
import { type MessageContent } from '../matrix/events.js';
import { type APActivity, type APObject } from '../activitypub/inbox.js';
import { dbLogger } from '../utils/logger.js';

/**
 * Routing decision for a message
 */
export interface RoutingDecision {
  shouldBridge: boolean;
  reason?: string;
  targetInboxes?: string[];
  useSharedInbox?: boolean;
  isPublic?: boolean;
}

/**
 * Follower information for routing
 */
export interface FollowerInfo {
  actorId: string;
  inboxUrl: string;
  sharedInboxUrl?: string;
}

/**
 * User info lookup function
 */
export type UserInfoLookupFn = (matrixUserId: string) => Promise<{
  hasAPFollowers: boolean;
  followerCount: number;
  isDoublePuppet: boolean;
} | null>;

/**
 * Follower list lookup function
 */
export type FollowerListLookupFn = (matrixUserId: string) => Promise<FollowerInfo[]>;

/**
 * Room info lookup function
 */
export type RoomInfoLookupFn = (matrixRoomId: string) => Promise<{
  type: 'dm' | 'group' | 'public';
  memberCount: number;
  isEncrypted: boolean;
} | null>;

/**
 * Message router for determining bridge targets
 */
export class MessageRouter {
  private userInfoLookup: UserInfoLookupFn | null = null;
  private followerListLookup: FollowerListLookupFn | null = null;
  private roomInfoLookup: RoomInfoLookupFn | null = null;
  private blockedInstances: Set<string> = new Set();

  /**
   * Set the user info lookup function
   */
  onUserInfoLookup(fn: UserInfoLookupFn): void {
    this.userInfoLookup = fn;
  }

  /**
   * Set the follower list lookup function
   */
  onFollowerListLookup(fn: FollowerListLookupFn): void {
    this.followerListLookup = fn;
  }

  /**
   * Set the room info lookup function
   */
  onRoomInfoLookup(fn: RoomInfoLookupFn): void {
    this.roomInfoLookup = fn;
  }

  /**
   * Set blocked instances
   */
  setBlockedInstances(instances: string[]): void {
    this.blockedInstances = new Set(instances.map((i) => i.toLowerCase()));
  }

  /**
   * Check if an instance is blocked
   */
  isInstanceBlocked(instanceDomain: string): boolean {
    return this.blockedInstances.has(instanceDomain.toLowerCase());
  }

  /**
   * Determine if and where a Matrix message should be bridged
   */
  async routeMatrixMessage(
    event: MatrixEvent,
    content: MessageContent
  ): Promise<RoutingDecision> {
    const logger = dbLogger();

    // Skip certain message types
    if (content.msgtype === 'm.notice') {
      return { shouldBridge: false, reason: 'Notice messages are not bridged' };
    }

    // Get user info
    if (this.userInfoLookup === null) {
      return { shouldBridge: false, reason: 'User lookup not configured' };
    }

    const userInfo = await this.userInfoLookup(event.sender);
    if (userInfo === null) {
      return { shouldBridge: false, reason: 'User not found' };
    }

    // Check if user has followers
    if (!userInfo.hasAPFollowers && userInfo.followerCount === 0) {
      return { shouldBridge: false, reason: 'User has no AP followers' };
    }

    // Get room info
    if (this.roomInfoLookup === null) {
      return { shouldBridge: false, reason: 'Room lookup not configured' };
    }

    const roomInfo = await this.roomInfoLookup(event.room_id);
    if (roomInfo === null) {
      return { shouldBridge: false, reason: 'Room not found' };
    }

    // Route based on room type
    switch (roomInfo.type) {
      case 'dm':
        return this.routeDM(event);

      case 'group':
        return this.routeGroupMessage(event, userInfo.followerCount);

      case 'public':
        return this.routePublicMessage(event, userInfo.followerCount);

      default:
        return { shouldBridge: false, reason: 'Unknown room type' };
    }
  }

  /**
   * Route a DM to specific recipients
   */
  private async routeDM(event: MatrixEvent): Promise<RoutingDecision> {
    // For DMs, we need to identify the recipient and deliver directly to their inbox
    // This would require additional logic to get the other DM participant

    return {
      shouldBridge: true,
      isPublic: false,
      useSharedInbox: false,
      reason: 'DM to specific recipient',
      targetInboxes: [], // Would be populated with recipient's inbox
    };
  }

  /**
   * Route a group message
   */
  private async routeGroupMessage(
    event: MatrixEvent,
    followerCount: number
  ): Promise<RoutingDecision> {
    // For group messages, we fan out to followers
    if (this.followerListLookup === null) {
      return { shouldBridge: false, reason: 'Follower lookup not configured' };
    }

    const followers = await this.followerListLookup(event.sender);

    // Filter out blocked instances
    const validFollowers = followers.filter(
      (f) => !this.isInstanceBlocked(this.extractDomain(f.actorId))
    );

    // Deduplicate by shared inbox
    const { inboxes, useSharedInbox } = this.deduplicateInboxes(validFollowers);

    return {
      shouldBridge: true,
      isPublic: false,
      useSharedInbox,
      targetInboxes: inboxes,
      reason: `Group message to ${inboxes.length} inboxes`,
    };
  }

  /**
   * Route a public message
   */
  private async routePublicMessage(
    event: MatrixEvent,
    followerCount: number
  ): Promise<RoutingDecision> {
    // For public messages, we fan out to all followers
    if (this.followerListLookup === null) {
      return { shouldBridge: false, reason: 'Follower lookup not configured' };
    }

    const followers = await this.followerListLookup(event.sender);

    // Filter out blocked instances
    const validFollowers = followers.filter(
      (f) => !this.isInstanceBlocked(this.extractDomain(f.actorId))
    );

    // Deduplicate by shared inbox
    const { inboxes, useSharedInbox } = this.deduplicateInboxes(validFollowers);

    return {
      shouldBridge: true,
      isPublic: true,
      useSharedInbox,
      targetInboxes: inboxes,
      reason: `Public message to ${inboxes.length} inboxes`,
    };
  }

  /**
   * Deduplicate inboxes by using shared inboxes when available
   */
  private deduplicateInboxes(followers: FollowerInfo[]): {
    inboxes: string[];
    useSharedInbox: boolean;
  } {
    const sharedInboxes = new Set<string>();
    const directInboxes = new Set<string>();

    for (const follower of followers) {
      if (follower.sharedInboxUrl !== undefined) {
        sharedInboxes.add(follower.sharedInboxUrl);
      } else {
        directInboxes.add(follower.inboxUrl);
      }
    }

    // Use shared inboxes when possible
    const inboxes = [...sharedInboxes, ...directInboxes];
    const useSharedInbox = sharedInboxes.size > 0;

    return { inboxes, useSharedInbox };
  }

  /**
   * Extract domain from an actor ID URL
   */
  private extractDomain(actorId: string): string {
    try {
      const url = new URL(actorId);
      return url.hostname;
    } catch {
      return '';
    }
  }

  /**
   * Determine routing for an incoming AP activity
   */
  async routeAPActivity(activity: APActivity): Promise<RoutingDecision> {
    const logger = dbLogger();
    const actorId = typeof activity.actor === 'string' ? activity.actor : activity.actor.id;

    // Check if sender's instance is blocked
    const senderDomain = this.extractDomain(actorId);
    if (this.isInstanceBlocked(senderDomain)) {
      return { shouldBridge: false, reason: 'Sender instance is blocked' };
    }

    // Determine target based on activity addressing
    const to = Array.isArray(activity.to) ? activity.to : activity.to !== undefined ? [activity.to] : [];
    const cc = Array.isArray(activity.cc) ? activity.cc : activity.cc !== undefined ? [activity.cc] : [];
    const recipients = [...to, ...cc];

    // Check if addressed to public
    const isPublic = recipients.some(
      (r) =>
        r === 'https://www.w3.org/ns/activitystreams#Public' ||
        r === 'as:Public' ||
        r === 'Public'
    );

    return {
      shouldBridge: true,
      isPublic,
      reason: isPublic ? 'Public activity' : 'Direct activity',
    };
  }

  /**
   * Get delivery targets for an activity
   */
  async getDeliveryTargets(
    senderId: string,
    isPublic: boolean
  ): Promise<{ inboxUrl: string; priority: number }[]> {
    if (this.followerListLookup === null) {
      return [];
    }

    const followers = await this.followerListLookup(senderId);

    // Filter blocked instances
    const validFollowers = followers.filter(
      (f) => !this.isInstanceBlocked(this.extractDomain(f.actorId))
    );

    // Build delivery targets
    const targets: Map<string, { inboxUrl: string; priority: number }> = new Map();

    for (const follower of validFollowers) {
      const inboxUrl = follower.sharedInboxUrl ?? follower.inboxUrl;

      if (!targets.has(inboxUrl)) {
        targets.set(inboxUrl, {
          inboxUrl,
          // Higher priority for shared inboxes (more efficient)
          priority: follower.sharedInboxUrl !== undefined ? 1 : 0,
        });
      }
    }

    return Array.from(targets.values()).sort((a, b) => b.priority - a.priority);
  }
}
