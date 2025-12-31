import { type MatrixConfig } from '../config/index.js';
import { matrixLogger } from '../utils/logger.js';

/**
 * ActivityPub actor information for ghost user creation
 */
export interface APActorInfo {
  username: string;
  instance: string;
  displayName?: string;
  avatarUrl?: string;
}

/**
 * Ghost user information
 */
export interface GhostUser {
  userId: string;
  localpart: string;
  displayName?: string;
  avatarMxc?: string;
}

/**
 * Cache entry for ghost users
 */
interface GhostCacheEntry {
  user: GhostUser;
  lastUpdated: number;
}

/**
 * Manages Matrix ghost users (puppets) for ActivityPub actors
 */
export class PuppetManager {
  private config: MatrixConfig;
  private ghostCache: Map<string, GhostCacheEntry> = new Map();
  private readonly cacheMaxAge = 5 * 60 * 1000; // 5 minutes
  private readonly cacheMaxSize = 10000;

  // Callbacks for Matrix operations (to be set by bridge)
  private createUserCallback: ((userId: string) => Promise<void>) | null = null;
  private setDisplayNameCallback:
    | ((userId: string, displayName: string) => Promise<void>)
    | null = null;
  private setAvatarCallback: ((userId: string, mxcUrl: string) => Promise<void>) | null = null;
  private uploadMediaCallback: ((url: string) => Promise<string>) | null = null;

  constructor(config: MatrixConfig) {
    this.config = config;
  }

  /**
   * Generate a Matrix user ID for an ActivityPub actor
   * Format: @_ap_username_instance:domain
   */
  generateGhostUserId(actor: APActorInfo): string {
    // Sanitize the username and instance for Matrix user ID
    const sanitizedUsername = this.sanitizeForLocalpart(actor.username);
    const sanitizedInstance = this.sanitizeForLocalpart(actor.instance);
    const localpart = `_ap_${sanitizedUsername}_${sanitizedInstance}`;

    return `@${localpart}:${this.config.domain}`;
  }

  /**
   * Generate just the localpart for a ghost user
   */
  generateGhostLocalpart(actor: APActorInfo): string {
    const sanitizedUsername = this.sanitizeForLocalpart(actor.username);
    const sanitizedInstance = this.sanitizeForLocalpart(actor.instance);
    return `_ap_${sanitizedUsername}_${sanitizedInstance}`;
  }

  /**
   * Parse an AP actor from a Matrix ghost user ID
   * Returns null if the user ID is not a valid ghost user
   */
  parseGhostUserId(userId: string): APActorInfo | null {
    const match = userId.match(/^@_ap_(.+)_([^:]+):(.+)$/);
    if (!match?.[1] || !match[2] || !match[3]) {
      return null;
    }

    // Verify the domain matches
    if (match[3] !== this.config.domain) {
      return null;
    }

    return {
      username: this.unsanitizeFromLocalpart(match[1]),
      instance: this.unsanitizeFromLocalpart(match[2]),
    };
  }

  /**
   * Check if a user ID is a ghost user managed by this bridge
   */
  isGhostUser(userId: string): boolean {
    const pattern = new RegExp(`^@_ap_.+:.+$`);
    return pattern.test(userId) && userId.endsWith(`:${this.config.domain}`);
  }

  /**
   * Sanitize a string for use in Matrix localpart
   * Matrix localparts can only contain: a-z, 0-9, ., _, =, -, /
   */
  private sanitizeForLocalpart(input: string): string {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9._=-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  /**
   * Reverse sanitization (best effort - some information may be lost)
   */
  private unsanitizeFromLocalpart(input: string): string {
    // This is lossy - we can't perfectly reverse the sanitization
    return input;
  }

  /**
   * Get or create a ghost user for an ActivityPub actor
   */
  async getOrCreateGhostUser(actor: APActorInfo): Promise<GhostUser> {
    const logger = matrixLogger();
    const userId = this.generateGhostUserId(actor);

    // Check cache
    const cached = this.ghostCache.get(userId);
    if (cached !== undefined && Date.now() - cached.lastUpdated < this.cacheMaxAge) {
      logger.debug('Ghost user found in cache', { userId });
      return cached.user;
    }

    // Create the user if needed
    await this.ensureGhostUserExists(actor);

    // Create ghost user object
    const ghostUser: GhostUser = {
      userId,
      localpart: this.generateGhostLocalpart(actor),
      displayName: actor.displayName,
      avatarMxc: undefined, // Will be set by syncProfile if avatar is available
    };

    // Sync profile
    await this.syncGhostProfile(ghostUser, actor);

    // Update cache
    this.updateCache(userId, ghostUser);

    return ghostUser;
  }

  /**
   * Ensure a ghost user exists in Matrix
   */
  private async ensureGhostUserExists(actor: APActorInfo): Promise<void> {
    const logger = matrixLogger();
    const userId = this.generateGhostUserId(actor);

    if (this.createUserCallback === null) {
      logger.warn('No create user callback registered, skipping user creation');
      return;
    }

    try {
      await this.createUserCallback(userId);
      logger.debug('Ghost user created or already exists', { userId });
    } catch (error) {
      // User might already exist, that's fine
      logger.debug('Ghost user creation result', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Sync ghost user profile with ActivityPub actor
   */
  async syncGhostProfile(ghostUser: GhostUser, actor: APActorInfo): Promise<void> {
    const logger = matrixLogger();

    // Sync display name
    if (actor.displayName !== undefined && actor.displayName !== ghostUser.displayName) {
      if (this.setDisplayNameCallback !== null) {
        try {
          await this.setDisplayNameCallback(ghostUser.userId, actor.displayName);
          ghostUser.displayName = actor.displayName;
          logger.debug('Updated ghost user display name', {
            userId: ghostUser.userId,
            displayName: actor.displayName,
          });
        } catch (error) {
          logger.error('Failed to set display name', {
            userId: ghostUser.userId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // Sync avatar
    if (actor.avatarUrl !== undefined) {
      if (this.uploadMediaCallback !== null && this.setAvatarCallback !== null) {
        try {
          // Upload avatar to Matrix
          const mxcUrl = await this.uploadMediaCallback(actor.avatarUrl);
          await this.setAvatarCallback(ghostUser.userId, mxcUrl);
          ghostUser.avatarMxc = mxcUrl;
          logger.debug('Updated ghost user avatar', {
            userId: ghostUser.userId,
            avatarMxc: mxcUrl,
          });
        } catch (error) {
          logger.error('Failed to set avatar', {
            userId: ghostUser.userId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  /**
   * Update the ghost user cache
   */
  private updateCache(userId: string, user: GhostUser): void {
    // Enforce cache size limit
    if (this.ghostCache.size >= this.cacheMaxSize) {
      const oldestKey = this.ghostCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.ghostCache.delete(oldestKey);
      }
    }

    this.ghostCache.set(userId, {
      user,
      lastUpdated: Date.now(),
    });
  }

  /**
   * Clear the ghost user cache
   */
  clearCache(): void {
    this.ghostCache.clear();
  }

  /**
   * Remove a specific user from the cache
   */
  invalidateCache(userId: string): void {
    this.ghostCache.delete(userId);
  }

  /**
   * Set the callback for creating users
   */
  onCreateUser(callback: (userId: string) => Promise<void>): void {
    this.createUserCallback = callback;
  }

  /**
   * Set the callback for setting display names
   */
  onSetDisplayName(callback: (userId: string, displayName: string) => Promise<void>): void {
    this.setDisplayNameCallback = callback;
  }

  /**
   * Set the callback for setting avatars
   */
  onSetAvatar(callback: (userId: string, mxcUrl: string) => Promise<void>): void {
    this.setAvatarCallback = callback;
  }

  /**
   * Set the callback for uploading media
   */
  onUploadMedia(callback: (url: string) => Promise<string>): void {
    this.uploadMediaCallback = callback;
  }
}
