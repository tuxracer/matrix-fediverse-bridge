import { type Redis } from 'ioredis';
import { createHash } from 'crypto';
import { bridgeLogger } from '../utils/logger.js';
import * as mediaRepo from '../db/repositories/media.js';

/**
 * Cache entry metadata
 */
interface CacheEntry {
  mxcUrl?: string;
  apUrl?: string;
  mimeType: string;
  fileSize: number;
  width?: number;
  height?: number;
  blurhash?: string;
  cachedAt: number;
}

/**
 * Media cache configuration
 */
export interface MediaCacheConfig {
  /** Redis connection */
  redis: Redis;
  /** Cache TTL in seconds (default: 24 hours) */
  ttl?: number;
  /** Prefix for cache keys */
  keyPrefix?: string;
  /** Maximum in-memory cache size in bytes */
  maxMemoryCacheSize?: number;
  /** Whether to cache media content in Redis (for small files) */
  cacheContentInRedis?: boolean;
  /** Maximum size for Redis content caching */
  maxRedisContentSize?: number;
}

/**
 * Media cache for URL mappings and metadata
 */
export class MediaCache {
  private redis: Redis;
  private config: Required<MediaCacheConfig>;
  private logger = bridgeLogger();
  private memoryCache: Map<string, Buffer> = new Map();
  private memoryCacheSize = 0;

  constructor(config: MediaCacheConfig) {
    this.redis = config.redis;
    this.config = {
      redis: config.redis,
      ttl: config.ttl ?? 86400, // 24 hours
      keyPrefix: config.keyPrefix ?? 'media:',
      maxMemoryCacheSize: config.maxMemoryCacheSize ?? 100 * 1024 * 1024, // 100MB
      cacheContentInRedis: config.cacheContentInRedis ?? false,
      maxRedisContentSize: config.maxRedisContentSize ?? 1024 * 1024, // 1MB
    };
  }

  /**
   * Generate cache key for a URL
   */
  private cacheKey(prefix: string, url: string): string {
    const hash = createHash('sha256').update(url).digest('hex').slice(0, 16);
    return `${this.config.keyPrefix}${prefix}:${hash}`;
  }

  /**
   * Get cached MXC URL for an AP URL
   */
  async getMxcForApUrl(apUrl: string): Promise<string | null> {
    const key = this.cacheKey('ap2mxc', apUrl);

    try {
      const cached = await this.redis.get(key);
      if (cached !== null) {
        this.logger.debug('Cache hit: AP to MXC', { apUrl });
        return cached;
      }
    } catch (error) {
      this.logger.warn('Redis cache read failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Fall back to database
    const record = await mediaRepo.findByAPUrl(apUrl);
    if (record?.matrix_mxc_url !== null && record?.matrix_mxc_url !== undefined) {
      // Update cache
      await this.setMxcForApUrl(apUrl, record.matrix_mxc_url);
      return record.matrix_mxc_url;
    }

    return null;
  }

  /**
   * Cache MXC URL for an AP URL
   */
  async setMxcForApUrl(apUrl: string, mxcUrl: string): Promise<void> {
    const key = this.cacheKey('ap2mxc', apUrl);

    try {
      await this.redis.setex(key, this.config.ttl, mxcUrl);
    } catch (error) {
      this.logger.warn('Redis cache write failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get cached AP URL for an MXC URL
   */
  async getApUrlForMxc(mxcUrl: string): Promise<string | null> {
    const key = this.cacheKey('mxc2ap', mxcUrl);

    try {
      const cached = await this.redis.get(key);
      if (cached !== null) {
        this.logger.debug('Cache hit: MXC to AP', { mxcUrl });
        return cached;
      }
    } catch (error) {
      this.logger.warn('Redis cache read failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Fall back to database
    const record = await mediaRepo.findByMxcUrl(mxcUrl);
    if (record?.ap_media_url !== null && record?.ap_media_url !== undefined) {
      await this.setApUrlForMxc(mxcUrl, record.ap_media_url);
      return record.ap_media_url;
    }

    return null;
  }

  /**
   * Cache AP URL for an MXC URL
   */
  async setApUrlForMxc(mxcUrl: string, apUrl: string): Promise<void> {
    const key = this.cacheKey('mxc2ap', mxcUrl);

    try {
      await this.redis.setex(key, this.config.ttl, apUrl);
    } catch (error) {
      this.logger.warn('Redis cache write failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get cached metadata for a URL
   */
  async getMetadata(url: string): Promise<CacheEntry | null> {
    const key = this.cacheKey('meta', url);

    try {
      const cached = await this.redis.get(key);
      if (cached !== null) {
        return JSON.parse(cached) as CacheEntry;
      }
    } catch (error) {
      this.logger.warn('Redis cache read failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return null;
  }

  /**
   * Cache metadata for a URL
   */
  async setMetadata(url: string, entry: CacheEntry): Promise<void> {
    const key = this.cacheKey('meta', url);

    try {
      await this.redis.setex(key, this.config.ttl, JSON.stringify(entry));
    } catch (error) {
      this.logger.warn('Redis cache write failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get cached content from memory or Redis
   */
  async getContent(url: string): Promise<Buffer | null> {
    const memKey = `content:${url}`;

    // Check memory cache first
    const memCached = this.memoryCache.get(memKey);
    if (memCached !== undefined) {
      this.logger.debug('Memory cache hit', { url });
      return memCached;
    }

    // Check Redis if enabled
    if (this.config.cacheContentInRedis) {
      const key = this.cacheKey('content', url);
      try {
        const cached = await this.redis.getBuffer(key);
        if (cached !== null) {
          this.logger.debug('Redis content cache hit', { url });
          // Add to memory cache
          this.addToMemoryCache(memKey, cached);
          return cached;
        }
      } catch (error) {
        this.logger.warn('Redis content cache read failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return null;
  }

  /**
   * Cache content in memory and optionally Redis
   */
  async setContent(url: string, content: Buffer): Promise<void> {
    const memKey = `content:${url}`;

    // Add to memory cache
    this.addToMemoryCache(memKey, content);

    // Cache in Redis if enabled and small enough
    if (
      this.config.cacheContentInRedis &&
      content.length <= this.config.maxRedisContentSize
    ) {
      const key = this.cacheKey('content', url);
      try {
        await this.redis.setex(key, this.config.ttl, content);
      } catch (error) {
        this.logger.warn('Redis content cache write failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Add buffer to memory cache with LRU eviction
   */
  private addToMemoryCache(key: string, buffer: Buffer): void {
    // Evict if needed
    while (
      this.memoryCacheSize + buffer.length > this.config.maxMemoryCacheSize &&
      this.memoryCache.size > 0
    ) {
      const firstKey = this.memoryCache.keys().next().value;
      if (firstKey !== undefined) {
        const evicted = this.memoryCache.get(firstKey);
        if (evicted !== undefined) {
          this.memoryCacheSize -= evicted.length;
        }
        this.memoryCache.delete(firstKey);
      }
    }

    this.memoryCache.set(key, buffer);
    this.memoryCacheSize += buffer.length;
  }

  /**
   * Invalidate cache entry
   */
  async invalidate(url: string): Promise<void> {
    const keys = [
      this.cacheKey('ap2mxc', url),
      this.cacheKey('mxc2ap', url),
      this.cacheKey('meta', url),
      this.cacheKey('content', url),
    ];

    try {
      await this.redis.del(...keys);
    } catch (error) {
      this.logger.warn('Cache invalidation failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Clear from memory cache
    const memKey = `content:${url}`;
    const cached = this.memoryCache.get(memKey);
    if (cached !== undefined) {
      this.memoryCacheSize -= cached.length;
      this.memoryCache.delete(memKey);
    }
  }

  /**
   * Clear all caches
   */
  async clearAll(): Promise<void> {
    try {
      // Clear Redis keys with prefix
      const pattern = `${this.config.keyPrefix}*`;
      let cursor = '0';

      do {
        const [newCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = newCursor;

        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch (error) {
      this.logger.warn('Redis cache clear failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Clear memory cache
    this.memoryCache.clear();
    this.memoryCacheSize = 0;
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    memoryCacheEntries: number;
    memoryCacheSize: number;
    redisCacheKeys: number;
  }> {
    let redisCacheKeys = 0;

    try {
      const pattern = `${this.config.keyPrefix}*`;
      let cursor = '0';

      do {
        const [newCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
        cursor = newCursor;
        redisCacheKeys += keys.length;
      } while (cursor !== '0');
    } catch {
      // Ignore errors for stats
    }

    return {
      memoryCacheEntries: this.memoryCache.size,
      memoryCacheSize: this.memoryCacheSize,
      redisCacheKeys,
    };
  }

  /**
   * Clean up old entries
   */
  async cleanup(olderThanDays: number = 30): Promise<number> {
    // Clean up database entries
    const deleted = await mediaRepo.deleteOlderThan(olderThanDays);

    this.logger.info('Media cache cleanup completed', {
      deletedFromDb: deleted,
    });

    return deleted;
  }
}

/**
 * Shared cache instance
 */
let sharedCache: MediaCache | null = null;

export function initMediaCache(config: MediaCacheConfig): MediaCache {
  sharedCache = new MediaCache(config);
  return sharedCache;
}

export function getMediaCache(): MediaCache | null {
  return sharedCache;
}
