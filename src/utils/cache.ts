import { type Redis } from 'ioredis';
import { bridgeLogger } from './logger.js';
import { cacheHits, cacheMisses } from './metrics.js';

/**
 * Cache configuration
 */
export interface CacheConfig {
  redis: Redis;
  prefix?: string;
  defaultTtlSeconds?: number;
}

/**
 * Cache entry with metadata
 */
interface CacheEntry<T> {
  data: T;
  cachedAt: string;
  expiresAt: string;
}

/**
 * TTL configuration for different cache types
 */
export const CacheTTL = {
  ACTOR: 3600, // 1 hour for actor profiles
  PUBLIC_KEY: 3600, // 1 hour for public keys
  WEBFINGER: 86400, // 24 hours for WebFinger (rarely changes)
  ACTIVITY: 300, // 5 minutes for activity deduplication
  INSTANCE_BLOCK: 300, // 5 minutes for instance block list
  USER_MAPPING: 1800, // 30 minutes for user ID mappings
} as const;

/**
 * Cache key prefixes
 */
export const CachePrefix = {
  ACTOR: 'actor:',
  PUBLIC_KEY: 'pubkey:',
  WEBFINGER: 'webfinger:',
  ACTIVITY: 'activity:',
  INSTANCE_BLOCK: 'blocked:',
  USER_MAPPING: 'user:',
} as const;

/**
 * Generic caching service with Redis backend
 */
export class CacheService {
  private redis: Redis;
  private prefix: string;
  private defaultTtl: number;
  private logger = bridgeLogger();

  constructor(config: CacheConfig) {
    this.redis = config.redis;
    this.prefix = config.prefix ?? 'bridge:cache:';
    this.defaultTtl = config.defaultTtlSeconds ?? 3600;
  }

  /**
   * Get a value from cache
   */
  async get<T>(key: string, cacheType = 'default'): Promise<T | null> {
    const fullKey = this.prefix + key;

    try {
      const value = await this.redis.get(fullKey);
      if (value === null) {
        cacheMisses.inc({ cache: cacheType });
        return null;
      }

      const entry = JSON.parse(value) as CacheEntry<T>;
      cacheHits.inc({ cache: cacheType });
      return entry.data;
    } catch (error) {
      this.logger.error('Cache get error', {
        key: fullKey,
        error: error instanceof Error ? error.message : String(error),
      });
      cacheMisses.inc({ cache: cacheType });
      return null;
    }
  }

  /**
   * Set a value in cache
   */
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const fullKey = this.prefix + key;
    const ttl = ttlSeconds ?? this.defaultTtl;

    const entry: CacheEntry<T> = {
      data: value,
      cachedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };

    try {
      await this.redis.setex(fullKey, ttl, JSON.stringify(entry));
    } catch (error) {
      this.logger.error('Cache set error', {
        key: fullKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Delete a value from cache
   */
  async delete(key: string): Promise<boolean> {
    const fullKey = this.prefix + key;

    try {
      const deleted = await this.redis.del(fullKey);
      return deleted > 0;
    } catch (error) {
      this.logger.error('Cache delete error', {
        key: fullKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Check if a key exists in cache
   */
  async exists(key: string): Promise<boolean> {
    const fullKey = this.prefix + key;

    try {
      const exists = await this.redis.exists(fullKey);
      return exists > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get or compute a value (cache-aside pattern)
   */
  async getOrSet<T>(
    key: string,
    compute: () => Promise<T>,
    ttlSeconds?: number,
    cacheType = 'default'
  ): Promise<T> {
    const cached = await this.get<T>(key, cacheType);
    if (cached !== null) {
      return cached;
    }

    const value = await compute();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  /**
   * Invalidate all keys matching a pattern
   */
  async invalidatePattern(pattern: string): Promise<number> {
    const fullPattern = this.prefix + pattern;

    try {
      const keys = await this.redis.keys(fullPattern);
      if (keys.length === 0) {
        return 0;
      }

      const deleted = await this.redis.del(...keys);
      this.logger.debug('Invalidated cache keys', {
        pattern: fullPattern,
        count: deleted,
      });
      return deleted;
    } catch (error) {
      this.logger.error('Cache invalidate pattern error', {
        pattern: fullPattern,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    keyCount: number;
    memoryUsage: string;
  }> {
    try {
      const keys = await this.redis.keys(this.prefix + '*');
      const info = await this.redis.info('memory');
      const memMatch = info.match(/used_memory_human:(\S+)/);

      return {
        keyCount: keys.length,
        memoryUsage: memMatch?.[1] ?? 'unknown',
      };
    } catch {
      return {
        keyCount: 0,
        memoryUsage: 'unknown',
      };
    }
  }
}

/**
 * ActivityPub Actor cache
 */
export interface CachedActor {
  id: string;
  type: string;
  preferredUsername: string;
  name?: string;
  summary?: string;
  inbox: string;
  outbox: string;
  sharedInbox?: string;
  followers?: string;
  following?: string;
  icon?: { url: string };
  publicKey?: {
    id: string;
    publicKeyPem: string;
  };
}

/**
 * Specialized actor cache
 */
export class ActorCache {
  private cache: CacheService;
  private logger = bridgeLogger();

  constructor(cache: CacheService) {
    this.cache = cache;
  }

  /**
   * Get cached actor
   */
  async get(actorId: string): Promise<CachedActor | null> {
    const key = CachePrefix.ACTOR + this.normalizeActorId(actorId);
    return this.cache.get<CachedActor>(key, 'actor');
  }

  /**
   * Cache an actor
   */
  async set(actor: CachedActor): Promise<void> {
    const key = CachePrefix.ACTOR + this.normalizeActorId(actor.id);
    await this.cache.set(key, actor, CacheTTL.ACTOR);
  }

  /**
   * Get or fetch an actor
   */
  async getOrFetch(
    actorId: string,
    fetch: () => Promise<CachedActor | null>
  ): Promise<CachedActor | null> {
    const cached = await this.get(actorId);
    if (cached !== null) {
      return cached;
    }

    const actor = await fetch();
    if (actor !== null) {
      await this.set(actor);
    }
    return actor;
  }

  /**
   * Invalidate actor cache
   */
  async invalidate(actorId: string): Promise<void> {
    const key = CachePrefix.ACTOR + this.normalizeActorId(actorId);
    await this.cache.delete(key);
  }

  private normalizeActorId(actorId: string): string {
    // Remove protocol and normalize
    return actorId.replace(/^https?:\/\//, '').toLowerCase();
  }
}

/**
 * Public key cache for HTTP signature verification
 */
export interface CachedPublicKey {
  keyId: string;
  owner: string;
  publicKeyPem: string;
  fetchedAt: string;
}

/**
 * Specialized public key cache
 */
export class PublicKeyCache {
  private cache: CacheService;

  constructor(cache: CacheService) {
    this.cache = cache;
  }

  /**
   * Get cached public key
   */
  async get(keyId: string): Promise<CachedPublicKey | null> {
    const key = CachePrefix.PUBLIC_KEY + this.normalizeKeyId(keyId);
    return this.cache.get<CachedPublicKey>(key, 'public_key');
  }

  /**
   * Cache a public key
   */
  async set(publicKey: CachedPublicKey): Promise<void> {
    const key = CachePrefix.PUBLIC_KEY + this.normalizeKeyId(publicKey.keyId);
    await this.cache.set(key, publicKey, CacheTTL.PUBLIC_KEY);
  }

  /**
   * Invalidate a public key (e.g., on verification failure for key rotation)
   */
  async invalidate(keyId: string): Promise<void> {
    const key = CachePrefix.PUBLIC_KEY + this.normalizeKeyId(keyId);
    await this.cache.delete(key);
  }

  /**
   * Invalidate all keys for an actor
   */
  async invalidateForActor(actorId: string): Promise<void> {
    const pattern = CachePrefix.PUBLIC_KEY + this.normalizeKeyId(actorId) + '*';
    await this.cache.invalidatePattern(pattern);
  }

  private normalizeKeyId(keyId: string): string {
    return keyId.replace(/^https?:\/\//, '').toLowerCase();
  }
}

/**
 * WebFinger result cache
 */
export interface CachedWebFinger {
  subject: string;
  actorId: string;
  aliases?: string[];
  profileUrl?: string;
}

/**
 * Specialized WebFinger cache
 */
export class WebFingerCache {
  private cache: CacheService;

  constructor(cache: CacheService) {
    this.cache = cache;
  }

  /**
   * Get cached WebFinger result
   */
  async get(handle: string): Promise<CachedWebFinger | null> {
    const key = CachePrefix.WEBFINGER + this.normalizeHandle(handle);
    return this.cache.get<CachedWebFinger>(key, 'webfinger');
  }

  /**
   * Cache a WebFinger result
   */
  async set(handle: string, result: CachedWebFinger): Promise<void> {
    const key = CachePrefix.WEBFINGER + this.normalizeHandle(handle);
    await this.cache.set(key, result, CacheTTL.WEBFINGER);
  }

  /**
   * Invalidate WebFinger cache for a handle
   */
  async invalidate(handle: string): Promise<void> {
    const key = CachePrefix.WEBFINGER + this.normalizeHandle(handle);
    await this.cache.delete(key);
  }

  private normalizeHandle(handle: string): string {
    // Remove leading @ and normalize to lowercase
    return handle.replace(/^@/, '').toLowerCase();
  }
}

/**
 * Activity deduplication cache
 */
export class ActivityDeduplicationCache {
  private cache: CacheService;

  constructor(cache: CacheService) {
    this.cache = cache;
  }

  /**
   * Check if an activity has been processed
   */
  async hasProcessed(activityId: string): Promise<boolean> {
    const key = CachePrefix.ACTIVITY + this.normalizeId(activityId);
    return this.cache.exists(key);
  }

  /**
   * Mark an activity as processed
   */
  async markProcessed(activityId: string): Promise<void> {
    const key = CachePrefix.ACTIVITY + this.normalizeId(activityId);
    await this.cache.set(key, { processedAt: new Date().toISOString() }, CacheTTL.ACTIVITY);
  }

  private normalizeId(id: string): string {
    return id.replace(/^https?:\/\//, '').toLowerCase();
  }
}

/**
 * Shared cache instances
 */
let sharedCacheService: CacheService | null = null;
let sharedActorCache: ActorCache | null = null;
let sharedPublicKeyCache: PublicKeyCache | null = null;
let sharedWebFingerCache: WebFingerCache | null = null;
let sharedActivityDeduplicationCache: ActivityDeduplicationCache | null = null;

export function initCaches(config: CacheConfig): {
  cacheService: CacheService;
  actorCache: ActorCache;
  publicKeyCache: PublicKeyCache;
  webFingerCache: WebFingerCache;
  activityDeduplicationCache: ActivityDeduplicationCache;
} {
  sharedCacheService = new CacheService(config);
  sharedActorCache = new ActorCache(sharedCacheService);
  sharedPublicKeyCache = new PublicKeyCache(sharedCacheService);
  sharedWebFingerCache = new WebFingerCache(sharedCacheService);
  sharedActivityDeduplicationCache = new ActivityDeduplicationCache(sharedCacheService);

  return {
    cacheService: sharedCacheService,
    actorCache: sharedActorCache,
    publicKeyCache: sharedPublicKeyCache,
    webFingerCache: sharedWebFingerCache,
    activityDeduplicationCache: sharedActivityDeduplicationCache,
  };
}

export function getCacheService(): CacheService | null {
  return sharedCacheService;
}

export function getActorCache(): ActorCache | null {
  return sharedActorCache;
}

export function getPublicKeyCache(): PublicKeyCache | null {
  return sharedPublicKeyCache;
}

export function getWebFingerCache(): WebFingerCache | null {
  return sharedWebFingerCache;
}

export function getActivityDeduplicationCache(): ActivityDeduplicationCache | null {
  return sharedActivityDeduplicationCache;
}
