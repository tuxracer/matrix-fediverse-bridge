import { randomUUID } from 'crypto';
import { bridgeLogger } from '../utils/logger.js';
import * as usersRepo from '../db/repositories/users.js';
import * as followsRepo from '../db/repositories/follows.js';
import * as messagesRepo from '../db/repositories/messages.js';
import { type APActivity, type APObject } from '../activitypub/inbox.js';
import { type APActor } from '../activitypub/actor.js';

/**
 * WebFinger response structure
 */
interface WebFingerResponse {
  subject: string;
  aliases?: string[];
  links: Array<{
    rel: string;
    type?: string;
    href?: string;
  }>;
}

/**
 * Resolved actor info
 */
export interface ResolvedActor {
  actorId: string;
  actorUrl: string;
  inboxUrl: string;
  sharedInboxUrl?: string;
  preferredUsername: string;
  displayName?: string;
  avatarUrl?: string;
}

/**
 * Social features service configuration
 */
export interface SocialServiceConfig {
  domain: string;
  baseUrl: string;
  signAndDeliver: (activity: APActivity, targetInbox: string) => Promise<void>;
  getActorKeyPair: (username: string) => Promise<{ privateKeyPem: string; publicKeyPem: string } | null>;
}

/**
 * Social features service for handling follows, reactions, and boosts
 */
export class SocialService {
  private config: SocialServiceConfig;
  private logger = bridgeLogger();

  constructor(config: SocialServiceConfig) {
    this.config = config;
  }

  // ==================== WebFinger & Actor Resolution ====================

  /**
   * Resolve an AP handle (e.g., @user@instance.social) to actor info
   */
  async resolveHandle(handle: string): Promise<ResolvedActor | null> {
    // Normalize handle
    let normalized = handle;
    if (normalized.startsWith('@')) {
      normalized = normalized.slice(1);
    }

    const parts = normalized.split('@');
    if (parts.length !== 2) {
      this.logger.warn('Invalid handle format', { handle });
      return null;
    }

    const [username, domain] = parts;
    if (username === undefined || domain === undefined) {
      return null;
    }

    try {
      // Perform WebFinger lookup
      const webfingerUrl = `https://${domain}/.well-known/webfinger?resource=acct:${username}@${domain}`;
      const webfingerResponse = await fetch(webfingerUrl, {
        headers: {
          Accept: 'application/jrd+json, application/json',
        },
      });

      if (!webfingerResponse.ok) {
        this.logger.warn('WebFinger lookup failed', { handle, status: webfingerResponse.status });
        return null;
      }

      const webfinger = (await webfingerResponse.json()) as WebFingerResponse;

      // Find the self link with ActivityPub type
      const selfLink = webfinger.links.find(
        (link) =>
          link.rel === 'self' &&
          (link.type === 'application/activity+json' ||
            link.type === 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"')
      );

      if (selfLink?.href === undefined) {
        this.logger.warn('No ActivityPub self link in WebFinger response', { handle });
        return null;
      }

      // Fetch the actor
      return await this.fetchActor(selfLink.href);
    } catch (error) {
      this.logger.error('Failed to resolve handle', {
        handle,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Fetch an actor by URL
   */
  async fetchActor(actorUrl: string): Promise<ResolvedActor | null> {
    try {
      const response = await fetch(actorUrl, {
        headers: {
          Accept: 'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
        },
      });

      if (!response.ok) {
        this.logger.warn('Actor fetch failed', { actorUrl, status: response.status });
        return null;
      }

      const actor = (await response.json()) as APActor;

      return {
        actorId: actor.id,
        actorUrl: actor.id,
        inboxUrl: actor.inbox,
        sharedInboxUrl: actor.endpoints?.sharedInbox,
        preferredUsername: actor.preferredUsername,
        displayName: actor.name,
        avatarUrl: actor.icon?.url,
      };
    } catch (error) {
      this.logger.error('Failed to fetch actor', {
        actorUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  // ==================== Follow/Unfollow ====================

  /**
   * Send a follow request to a remote actor
   */
  async follow(matrixUserId: string, targetHandle: string): Promise<{
    success: boolean;
    message: string;
  }> {
    // Resolve target actor
    const targetActor = await this.resolveHandle(targetHandle);
    if (targetActor === null) {
      return { success: false, message: `Could not resolve ${targetHandle}` };
    }

    // Get or create local user
    const localUser = await usersRepo.getOrCreateByMatrixId(matrixUserId);

    // Get or create remote user record
    const remoteUser = await usersRepo.getOrCreateByAPActorId(targetActor.actorId, {
      apInboxUrl: targetActor.inboxUrl,
      apSharedInboxUrl: targetActor.sharedInboxUrl,
      displayName: targetActor.displayName,
      avatarUrl: targetActor.avatarUrl,
    });

    // Check if already following
    const existingFollow = await followsRepo.findByFollowerAndFollowing(localUser.id, remoteUser.id);
    if (existingFollow !== null) {
      if (existingFollow.status === 'accepted') {
        return { success: false, message: `Already following ${targetHandle}` };
      }
      if (existingFollow.status === 'pending') {
        return { success: false, message: `Follow request to ${targetHandle} is pending` };
      }
    }

    // Generate follow activity
    const localActorUrl = this.getLocalActorUrl(matrixUserId);
    const followId = `${this.config.baseUrl}/activities/${randomUUID()}`;

    const followActivity: APActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: followId,
      type: 'Follow',
      actor: localActorUrl,
      object: targetActor.actorId,
    };

    // Create follow record
    await followsRepo.createFollow({
      followerId: localUser.id,
      followingId: remoteUser.id,
      apFollowId: followId,
      status: 'pending',
    });

    // Deliver follow activity
    try {
      await this.config.signAndDeliver(followActivity, targetActor.inboxUrl);
      this.logger.info('Sent follow request', {
        from: matrixUserId,
        to: targetHandle,
        followId,
      });
      return { success: true, message: `Follow request sent to ${targetHandle}` };
    } catch (error) {
      this.logger.error('Failed to deliver follow activity', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, message: 'Failed to send follow request' };
    }
  }

  /**
   * Send an unfollow (Undo Follow) to a remote actor
   */
  async unfollow(matrixUserId: string, targetHandle: string): Promise<{
    success: boolean;
    message: string;
  }> {
    // Resolve target actor
    const targetActor = await this.resolveHandle(targetHandle);
    if (targetActor === null) {
      return { success: false, message: `Could not resolve ${targetHandle}` };
    }

    // Find local user
    const localUser = await usersRepo.findByMatrixId(matrixUserId);
    if (localUser === null) {
      return { success: false, message: 'You have not followed anyone yet' };
    }

    // Find remote user
    const remoteUser = await usersRepo.findByAPActorId(targetActor.actorId);
    if (remoteUser === null) {
      return { success: false, message: `Not following ${targetHandle}` };
    }

    // Find existing follow
    const existingFollow = await followsRepo.findByFollowerAndFollowing(localUser.id, remoteUser.id);
    if (existingFollow === null) {
      return { success: false, message: `Not following ${targetHandle}` };
    }

    // Generate undo activity
    const localActorUrl = this.getLocalActorUrl(matrixUserId);
    const undoId = `${this.config.baseUrl}/activities/${randomUUID()}`;

    const undoActivity: APActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: undoId,
      type: 'Undo',
      actor: localActorUrl,
      object: {
        id: existingFollow.ap_follow_id ?? `${this.config.baseUrl}/activities/unknown`,
        type: 'Follow',
        actor: localActorUrl,
        object: targetActor.actorId,
      } as APActivity,
    };

    // Delete follow record
    await followsRepo.deleteFollow(localUser.id, remoteUser.id);

    // Deliver undo activity
    try {
      await this.config.signAndDeliver(undoActivity, targetActor.inboxUrl);
      this.logger.info('Sent unfollow', {
        from: matrixUserId,
        to: targetHandle,
      });
      return { success: true, message: `Unfollowed ${targetHandle}` };
    } catch (error) {
      this.logger.error('Failed to deliver unfollow activity', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, message: 'Failed to send unfollow request' };
    }
  }

  /**
   * Handle incoming Follow activity
   */
  async handleIncomingFollow(activity: APActivity, actorId: string): Promise<void> {
    const targetActorId = typeof activity.object === 'string' ? activity.object : undefined;
    if (targetActorId === undefined) {
      this.logger.warn('Follow activity missing target', { activityId: activity.id });
      return;
    }

    // Extract username from target actor URL
    const username = this.extractUsernameFromActorUrl(targetActorId);
    if (username === null) {
      this.logger.warn('Could not extract username from actor URL', { actorUrl: targetActorId });
      return;
    }

    // Get or create follower user record
    const followerActor = await this.fetchActor(actorId);
    if (followerActor === null) {
      this.logger.warn('Could not fetch follower actor', { actorId });
      return;
    }

    const followerUser = await usersRepo.getOrCreateByAPActorId(actorId, {
      apInboxUrl: followerActor.inboxUrl,
      apSharedInboxUrl: followerActor.sharedInboxUrl,
      displayName: followerActor.displayName,
      avatarUrl: followerActor.avatarUrl,
    });

    // Get local user
    const localUser = await usersRepo.findByMatrixId(this.matrixUserIdFromUsername(username));
    if (localUser === null) {
      this.logger.warn('Local user not found for follow', { username });
      return;
    }

    // Create follow record
    await followsRepo.createFollow({
      followerId: followerUser.id,
      followingId: localUser.id,
      apFollowId: activity.id,
      status: 'accepted', // Auto-accept follows
    });

    // Send Accept activity
    const acceptId = `${this.config.baseUrl}/activities/${randomUUID()}`;
    const acceptActivity: APActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: acceptId,
      type: 'Accept',
      actor: targetActorId,
      object: activity,
    };

    try {
      await this.config.signAndDeliver(acceptActivity, followerActor.inboxUrl);
      this.logger.info('Accepted follow request', {
        follower: actorId,
        following: targetActorId,
      });
    } catch (error) {
      this.logger.error('Failed to send Accept activity', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle incoming Accept activity (follow accepted)
   */
  async handleIncomingAccept(activity: APActivity, _actorId: string): Promise<void> {
    const object = activity.object;
    if (typeof object !== 'object' || object === null) {
      return;
    }

    const innerActivity = object as APActivity;
    if (innerActivity.type !== 'Follow') {
      return;
    }

    // Update follow status
    const followId = innerActivity.id;
    if (followId !== undefined) {
      const updated = await followsRepo.updateStatusByAPFollowId(followId, 'accepted');
      if (updated !== null) {
        this.logger.info('Follow request accepted', { followId });
      }
    }
  }

  /**
   * Handle incoming Reject activity (follow rejected)
   */
  async handleIncomingReject(activity: APActivity, _actorId: string): Promise<void> {
    const object = activity.object;
    if (typeof object !== 'object' || object === null) {
      return;
    }

    const innerActivity = object as APActivity;
    if (innerActivity.type !== 'Follow') {
      return;
    }

    // Update follow status
    const followId = innerActivity.id;
    if (followId !== undefined) {
      const updated = await followsRepo.updateStatusByAPFollowId(followId, 'rejected');
      if (updated !== null) {
        this.logger.info('Follow request rejected', { followId });
      }
    }
  }

  /**
   * Handle incoming Undo activity
   */
  async handleIncomingUndo(activity: APActivity, actorId: string): Promise<void> {
    const object = activity.object;
    if (typeof object !== 'object' || object === null) {
      return;
    }

    const innerActivity = object as APActivity;

    switch (innerActivity.type) {
      case 'Follow':
        await this.handleUndoFollow(innerActivity, actorId);
        break;
      case 'Like':
        await this.handleUndoLike(innerActivity, actorId);
        break;
      case 'Announce':
        await this.handleUndoAnnounce(innerActivity, actorId);
        break;
    }
  }

  private async handleUndoFollow(followActivity: APActivity, actorId: string): Promise<void> {
    const followId = followActivity.id;
    if (followId !== undefined) {
      const deleted = await followsRepo.deleteByAPFollowId(followId);
      if (deleted) {
        this.logger.info('Follow undone', { followId, actor: actorId });
      }
    }
  }

  // ==================== Reactions ====================

  /**
   * Send a Like activity for a reaction
   */
  async sendReaction(
    matrixUserId: string,
    targetEventId: string,
    emoji: string
  ): Promise<{ success: boolean; message: string }> {
    // Look up the AP object ID for the Matrix event
    const message = await messagesRepo.findByMatrixEventId(targetEventId);
    if (message === null || message.ap_object_id === null) {
      return { success: false, message: 'Target message not found in bridge' };
    }

    // Fetch the target object to get the author's inbox
    const targetObjectUrl = message.ap_object_id;
    const targetObject = await this.fetchObject(targetObjectUrl);
    if (targetObject === null) {
      return { success: false, message: 'Could not fetch target object' };
    }

    const authorActorId = targetObject.attributedTo;
    if (authorActorId === undefined) {
      return { success: false, message: 'Target object has no author' };
    }

    const authorActor = await this.fetchActor(authorActorId);
    if (authorActor === null) {
      return { success: false, message: 'Could not fetch author actor' };
    }

    // Generate Like activity
    const localActorUrl = this.getLocalActorUrl(matrixUserId);
    const likeId = `${this.config.baseUrl}/activities/${randomUUID()}`;

    const likeActivity: APActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: likeId,
      type: 'Like',
      actor: localActorUrl,
      object: targetObjectUrl,
      // Include emoji as content (Mastodon extension)
      published: new Date().toISOString(),
    };

    // Add emoji to the activity (some implementations use this)
    (likeActivity as APActivity & { content?: string }).content = emoji;

    // Deliver to author
    try {
      await this.config.signAndDeliver(likeActivity, authorActor.inboxUrl);
      this.logger.info('Sent reaction', {
        from: matrixUserId,
        to: authorActorId,
        emoji,
      });
      return { success: true, message: 'Reaction sent' };
    } catch (error) {
      this.logger.error('Failed to send reaction', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, message: 'Failed to send reaction' };
    }
  }

  /**
   * Handle incoming Like activity
   */
  async handleIncomingLike(
    activity: APActivity,
    actorId: string
  ): Promise<{ matrixEventId: string; emoji: string } | null> {
    const objectId = typeof activity.object === 'string' ? activity.object : (activity.object as APObject)?.id;
    if (objectId === undefined) {
      return null;
    }

    // Look up the Matrix event ID
    const message = await messagesRepo.findByAPObjectId(objectId);
    if (message === null || message.matrix_event_id === null) {
      this.logger.debug('Like target not found in bridge', { objectId });
      return null;
    }

    // Extract emoji (default to thumbs up)
    const emoji = (activity as APActivity & { content?: string }).content ?? '👍';

    this.logger.info('Received like', {
      from: actorId,
      target: objectId,
      emoji,
    });

    return {
      matrixEventId: message.matrix_event_id,
      emoji,
    };
  }

  private async handleUndoLike(likeActivity: APActivity, actorId: string): Promise<void> {
    // For undo like, we need to find and redact the corresponding Matrix reaction
    this.logger.debug('Undo like received', { likeId: likeActivity.id, actor: actorId });
    // The actual redaction would be handled by the caller with the Matrix client
  }

  // ==================== Boosts/Announces ====================

  /**
   * Send an Announce (boost) activity
   */
  async sendBoost(
    matrixUserId: string,
    targetEventId: string
  ): Promise<{ success: boolean; message: string }> {
    // Look up the AP object ID
    const message = await messagesRepo.findByMatrixEventId(targetEventId);
    if (message === null || message.ap_object_id === null) {
      return { success: false, message: 'Target message not found in bridge' };
    }

    // Fetch the target object
    const targetObjectUrl = message.ap_object_id;
    const targetObject = await this.fetchObject(targetObjectUrl);
    if (targetObject === null) {
      return { success: false, message: 'Could not fetch target object' };
    }

    // Get author info
    const authorActorId = targetObject.attributedTo;
    if (authorActorId === undefined) {
      return { success: false, message: 'Target object has no author' };
    }

    const authorActor = await this.fetchActor(authorActorId);
    if (authorActor === null) {
      return { success: false, message: 'Could not fetch author actor' };
    }

    // Generate Announce activity
    const localActorUrl = this.getLocalActorUrl(matrixUserId);
    const announceId = `${this.config.baseUrl}/activities/${randomUUID()}`;

    const announceActivity: APActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: announceId,
      type: 'Announce',
      actor: localActorUrl,
      object: targetObjectUrl,
      published: new Date().toISOString(),
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [authorActorId, `${localActorUrl}/followers`],
    };

    // Deliver to author (and followers would be handled by fan-out)
    try {
      await this.config.signAndDeliver(announceActivity, authorActor.inboxUrl);
      this.logger.info('Sent boost', {
        from: matrixUserId,
        target: targetObjectUrl,
      });
      return { success: true, message: 'Boost sent' };
    } catch (error) {
      this.logger.error('Failed to send boost', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, message: 'Failed to send boost' };
    }
  }

  /**
   * Handle incoming Announce activity
   */
  async handleIncomingAnnounce(
    activity: APActivity,
    actorId: string
  ): Promise<{ originalObject: APObject; boosterActorId: string } | null> {
    const objectId = typeof activity.object === 'string' ? activity.object : (activity.object as APObject)?.id;
    if (objectId === undefined) {
      return null;
    }

    // Fetch the announced object
    const object = await this.fetchObject(objectId);
    if (object === null) {
      this.logger.debug('Could not fetch announced object', { objectId });
      return null;
    }

    this.logger.info('Received announce', {
      from: actorId,
      target: objectId,
    });

    return {
      originalObject: object,
      boosterActorId: actorId,
    };
  }

  private async handleUndoAnnounce(announceActivity: APActivity, actorId: string): Promise<void> {
    this.logger.debug('Undo announce received', { announceId: announceActivity.id, actor: actorId });
    // The actual handling would involve removing the boost message from Matrix
  }

  // ==================== Utility Methods ====================

  /**
   * Fetch an ActivityPub object
   */
  private async fetchObject(objectUrl: string): Promise<APObject | null> {
    try {
      const response = await fetch(objectUrl, {
        headers: {
          Accept: 'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
        },
      });

      if (!response.ok) {
        return null;
      }

      return (await response.json()) as APObject;
    } catch {
      return null;
    }
  }

  /**
   * Get the local actor URL for a Matrix user
   */
  private getLocalActorUrl(matrixUserId: string): string {
    // Convert @user:domain to a username
    const username = this.usernameFromMatrixUserId(matrixUserId);
    return `${this.config.baseUrl}/users/${username}`;
  }

  /**
   * Convert a Matrix user ID to a username
   */
  private usernameFromMatrixUserId(matrixUserId: string): string {
    // @user:domain -> user_domain
    const match = matrixUserId.match(/^@([^:]+):(.+)$/);
    if (match !== null && match[1] !== undefined && match[2] !== undefined) {
      return `${match[1]}_${match[2].replace(/\./g, '_')}`;
    }
    return matrixUserId.replace(/[@:]/g, '_');
  }

  /**
   * Convert a username back to a Matrix user ID
   */
  private matrixUserIdFromUsername(username: string): string {
    // This is a simplified reverse conversion - in practice, you'd need a lookup
    // user_domain_com -> @user:domain.com
    const parts = username.split('_');
    if (parts.length >= 2) {
      const user = parts[0];
      const domain = parts.slice(1).join('.');
      return `@${user}:${domain}`;
    }
    return `@${username}:${this.config.domain}`;
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

  /**
   * Get follower count for a user
   */
  async getFollowerCount(userId: string): Promise<number> {
    return followsRepo.countFollowers(userId, 'accepted');
  }

  /**
   * Get following count for a user
   */
  async getFollowingCount(userId: string): Promise<number> {
    return followsRepo.countFollowing(userId, 'accepted');
  }

  /**
   * Get list of followers
   */
  async getFollowers(userId: string, limit = 100, offset = 0): Promise<followsRepo.FollowRecord[]> {
    return followsRepo.findFollowers(userId, 'accepted', limit, offset);
  }

  /**
   * Get list of users being followed
   */
  async getFollowing(userId: string, limit = 100, offset = 0): Promise<followsRepo.FollowRecord[]> {
    return followsRepo.findFollowing(userId, 'accepted', limit, offset);
  }
}

/**
 * Shared social service instance
 */
let sharedSocialService: SocialService | null = null;

export function initSocialService(config: SocialServiceConfig): SocialService {
  sharedSocialService = new SocialService(config);
  return sharedSocialService;
}

export function getSocialService(): SocialService | null {
  return sharedSocialService;
}
