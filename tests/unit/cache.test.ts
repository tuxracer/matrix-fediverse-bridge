/**
 * Unit tests for cache utilities
 */
import { type Redis } from 'ioredis';
import {
  CacheService,
  ActorCache,
  PublicKeyCache,
  WebFingerCache,
  ActivityDeduplicationCache,
  CacheTTL,
  CachePrefix,
  type CachedActor,
  type CachedPublicKey,
  type CachedWebFinger,
} from '../../src/utils/cache.js';

// Mock Redis client
function createMockRedis(): jest.Mocked<Redis> {
  const store = new Map<string, { value: string; expiry?: number }>();

  return {
    get: jest.fn(async (key: string) => {
      const item = store.get(key);
      if (item === undefined) return null;
      if (item.expiry !== undefined && item.expiry < Date.now()) {
        store.delete(key);
        return null;
      }
      return item.value;
    }),
    setex: jest.fn(async (key: string, ttl: number, value: string) => {
      store.set(key, { value, expiry: Date.now() + ttl * 1000 });
      return 'OK';
    }),
    del: jest.fn(async (...keys: string[]) => {
      let count = 0;
      for (const key of keys) {
        if (store.delete(key)) count++;
      }
      return count;
    }),
    exists: jest.fn(async (key: string) => {
      return store.has(key) ? 1 : 0;
    }),
    keys: jest.fn(async (pattern: string) => {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return Array.from(store.keys()).filter((k) => regex.test(k));
    }),
    info: jest.fn(async () => 'used_memory_human:1.5M'),
    // Add minimal methods to satisfy type
  } as unknown as jest.Mocked<Redis>;
}

describe('CacheService', () => {
  let redis: jest.Mocked<Redis>;
  let cache: CacheService;

  beforeEach(() => {
    redis = createMockRedis();
    cache = new CacheService({ redis, prefix: 'test:' });
  });

  describe('get', () => {
    it('should return null for missing keys', async () => {
      const result = await cache.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should return cached value', async () => {
      await cache.set('mykey', { foo: 'bar' });
      const result = await cache.get<{ foo: string }>('mykey');
      expect(result).toEqual({ foo: 'bar' });
    });

    it('should use prefix in key', async () => {
      await cache.get('mykey');
      expect(redis.get).toHaveBeenCalledWith('test:mykey');
    });
  });

  describe('set', () => {
    it('should store value with default TTL', async () => {
      await cache.set('mykey', { data: 'value' });
      expect(redis.setex).toHaveBeenCalledWith(
        'test:mykey',
        3600, // default TTL
        expect.any(String)
      );
    });

    it('should store value with custom TTL', async () => {
      await cache.set('mykey', { data: 'value' }, 300);
      expect(redis.setex).toHaveBeenCalledWith(
        'test:mykey',
        300,
        expect.any(String)
      );
    });

    it('should store entry with metadata', async () => {
      await cache.set('mykey', { data: 'value' });
      const storedValue = JSON.parse((redis.setex as jest.Mock).mock.calls[0][2]);
      expect(storedValue).toHaveProperty('data', { data: 'value' });
      expect(storedValue).toHaveProperty('cachedAt');
      expect(storedValue).toHaveProperty('expiresAt');
    });
  });

  describe('delete', () => {
    it('should delete key and return true if existed', async () => {
      await cache.set('mykey', 'value');
      const result = await cache.delete('mykey');
      expect(result).toBe(true);
    });

    it('should return false if key did not exist', async () => {
      const result = await cache.delete('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('exists', () => {
    it('should return true for existing keys', async () => {
      await cache.set('mykey', 'value');
      const result = await cache.exists('mykey');
      expect(result).toBe(true);
    });

    it('should return false for missing keys', async () => {
      const result = await cache.exists('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('getOrSet', () => {
    it('should return cached value if exists', async () => {
      await cache.set('mykey', 'cached');
      const compute = jest.fn(async () => 'computed');

      const result = await cache.getOrSet('mykey', compute);

      expect(result).toBe('cached');
      expect(compute).not.toHaveBeenCalled();
    });

    it('should compute and cache value if not exists', async () => {
      const compute = jest.fn(async () => 'computed');

      const result = await cache.getOrSet('newkey', compute, 600);

      expect(result).toBe('computed');
      expect(compute).toHaveBeenCalled();
      expect(redis.setex).toHaveBeenCalled();
    });
  });

  describe('invalidatePattern', () => {
    it('should delete matching keys', async () => {
      await cache.set('user:1', 'a');
      await cache.set('user:2', 'b');
      await cache.set('other', 'c');

      const count = await cache.invalidatePattern('user:*');

      expect(count).toBeGreaterThanOrEqual(0);
      expect(redis.keys).toHaveBeenCalledWith('test:user:*');
    });
  });

  describe('getStats', () => {
    it('should return cache statistics', async () => {
      const stats = await cache.getStats();

      expect(stats).toHaveProperty('keyCount');
      expect(stats).toHaveProperty('memoryUsage');
      expect(typeof stats.keyCount).toBe('number');
    });
  });
});

describe('ActorCache', () => {
  let redis: jest.Mocked<Redis>;
  let cacheService: CacheService;
  let actorCache: ActorCache;

  const testActor: CachedActor = {
    id: 'https://mastodon.social/users/testuser',
    type: 'Person',
    preferredUsername: 'testuser',
    name: 'Test User',
    inbox: 'https://mastodon.social/users/testuser/inbox',
    outbox: 'https://mastodon.social/users/testuser/outbox',
  };

  beforeEach(() => {
    redis = createMockRedis();
    cacheService = new CacheService({ redis });
    actorCache = new ActorCache(cacheService);
  });

  it('should cache and retrieve actors', async () => {
    await actorCache.set(testActor);
    const result = await actorCache.get(testActor.id);

    expect(result).toEqual(testActor);
  });

  it('should return null for uncached actors', async () => {
    const result = await actorCache.get('https://example.com/users/unknown');
    expect(result).toBeNull();
  });

  it('should use actor TTL', async () => {
    await actorCache.set(testActor);

    expect(redis.setex).toHaveBeenCalledWith(
      expect.stringContaining(CachePrefix.ACTOR),
      CacheTTL.ACTOR,
      expect.any(String)
    );
  });

  it('should normalize actor IDs', async () => {
    await actorCache.set(testActor);

    // Should be able to get with or without protocol
    const result = await actorCache.get('https://mastodon.social/users/testuser');
    expect(result).toEqual(testActor);
  });

  it('should fetch and cache with getOrFetch', async () => {
    const fetchFn = jest.fn(async () => testActor);

    // First call should fetch
    const result1 = await actorCache.getOrFetch(testActor.id, fetchFn);
    expect(result1).toEqual(testActor);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Second call should use cache
    const result2 = await actorCache.getOrFetch(testActor.id, fetchFn);
    expect(result2).toEqual(testActor);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('should invalidate actor cache', async () => {
    await actorCache.set(testActor);
    await actorCache.invalidate(testActor.id);

    const result = await actorCache.get(testActor.id);
    expect(result).toBeNull();
  });
});

describe('PublicKeyCache', () => {
  let redis: jest.Mocked<Redis>;
  let cacheService: CacheService;
  let keyCache: PublicKeyCache;

  const testKey: CachedPublicKey = {
    keyId: 'https://mastodon.social/users/testuser#main-key',
    owner: 'https://mastodon.social/users/testuser',
    publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMIIBI...\n-----END PUBLIC KEY-----',
    fetchedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    redis = createMockRedis();
    cacheService = new CacheService({ redis });
    keyCache = new PublicKeyCache(cacheService);
  });

  it('should cache and retrieve public keys', async () => {
    await keyCache.set(testKey);
    const result = await keyCache.get(testKey.keyId);

    expect(result).toEqual(testKey);
  });

  it('should use public key TTL', async () => {
    await keyCache.set(testKey);

    expect(redis.setex).toHaveBeenCalledWith(
      expect.stringContaining(CachePrefix.PUBLIC_KEY),
      CacheTTL.PUBLIC_KEY,
      expect.any(String)
    );
  });

  it('should invalidate specific key', async () => {
    await keyCache.set(testKey);
    await keyCache.invalidate(testKey.keyId);

    const result = await keyCache.get(testKey.keyId);
    expect(result).toBeNull();
  });
});

describe('WebFingerCache', () => {
  let redis: jest.Mocked<Redis>;
  let cacheService: CacheService;
  let webFingerCache: WebFingerCache;

  const testResult: CachedWebFinger = {
    subject: 'acct:testuser@mastodon.social',
    actorId: 'https://mastodon.social/users/testuser',
    aliases: ['https://mastodon.social/@testuser'],
    profileUrl: 'https://mastodon.social/@testuser',
  };

  beforeEach(() => {
    redis = createMockRedis();
    cacheService = new CacheService({ redis });
    webFingerCache = new WebFingerCache(cacheService);
  });

  it('should cache and retrieve WebFinger results', async () => {
    await webFingerCache.set('testuser@mastodon.social', testResult);
    const result = await webFingerCache.get('testuser@mastodon.social');

    expect(result).toEqual(testResult);
  });

  it('should normalize handles (remove leading @)', async () => {
    await webFingerCache.set('@testuser@mastodon.social', testResult);
    const result = await webFingerCache.get('testuser@mastodon.social');

    expect(result).toEqual(testResult);
  });

  it('should use WebFinger TTL (longer)', async () => {
    await webFingerCache.set('testuser@mastodon.social', testResult);

    expect(redis.setex).toHaveBeenCalledWith(
      expect.stringContaining(CachePrefix.WEBFINGER),
      CacheTTL.WEBFINGER,
      expect.any(String)
    );
  });
});

describe('ActivityDeduplicationCache', () => {
  let redis: jest.Mocked<Redis>;
  let cacheService: CacheService;
  let dedupCache: ActivityDeduplicationCache;

  beforeEach(() => {
    redis = createMockRedis();
    cacheService = new CacheService({ redis });
    dedupCache = new ActivityDeduplicationCache(cacheService);
  });

  it('should return false for unprocessed activities', async () => {
    const result = await dedupCache.hasProcessed('https://example.com/activities/123');
    expect(result).toBe(false);
  });

  it('should return true for processed activities', async () => {
    await dedupCache.markProcessed('https://example.com/activities/123');
    const result = await dedupCache.hasProcessed('https://example.com/activities/123');

    expect(result).toBe(true);
  });

  it('should use short TTL for deduplication', async () => {
    await dedupCache.markProcessed('https://example.com/activities/123');

    expect(redis.setex).toHaveBeenCalledWith(
      expect.stringContaining(CachePrefix.ACTIVITY),
      CacheTTL.ACTIVITY,
      expect.any(String)
    );
  });
});

describe('CacheTTL constants', () => {
  it('should have appropriate TTL values', () => {
    expect(CacheTTL.ACTOR).toBe(3600); // 1 hour
    expect(CacheTTL.PUBLIC_KEY).toBe(3600); // 1 hour
    expect(CacheTTL.WEBFINGER).toBe(86400); // 24 hours
    expect(CacheTTL.ACTIVITY).toBe(300); // 5 minutes
  });
});

describe('CachePrefix constants', () => {
  it('should have unique prefixes', () => {
    const prefixes = Object.values(CachePrefix);
    const uniquePrefixes = new Set(prefixes);
    expect(uniquePrefixes.size).toBe(prefixes.length);
  });
});
