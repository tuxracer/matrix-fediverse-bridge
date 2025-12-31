import { Queue, type QueueOptions, type JobsOptions } from 'bullmq';
import IORedis, { type Redis as RedisInstance } from 'ioredis';
import { type RedisConfig } from '../config/index.js';
import { queueLogger } from '../utils/logger.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Redis = IORedis as any as new (url: string, options?: object) => RedisInstance;

/**
 * Queue names
 */
export const QUEUE_NAMES = {
  MATRIX_TO_AP: 'matrix-to-ap',
  AP_TO_MATRIX: 'ap-to-matrix',
  AP_DELIVERY: 'ap-delivery',
} as const;

/**
 * Job data for Matrix to AP bridging
 */
export interface MatrixToAPJobData {
  eventId: string;
  roomId: string;
  sender: string;
  eventType: string;
  content: Record<string, unknown>;
  timestamp: number;
}

/**
 * Job data for AP to Matrix bridging
 */
export interface APToMatrixJobData {
  activityId: string;
  activityType: string;
  actorId: string;
  object: Record<string, unknown>;
  targetRoomId?: string;
}

/**
 * Job data for AP delivery
 */
export interface APDeliveryJobData {
  activityId: string;
  activity: Record<string, unknown>;
  inboxUrl: string;
  senderKeyId: string;
  retryCount?: number;
}

/**
 * Queue manager for all bridge queues
 */
export class QueueManager {
  private connection: RedisInstance;
  private queues: Map<string, Queue> = new Map();
  private isShutdown = false;

  constructor(config: RedisConfig) {
    this.connection = new Redis(config.url, {
      maxRetriesPerRequest: config.maxRetriesPerRequest,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        if (times > 10) {
          return null; // Stop retrying
        }
        return Math.min(times * 100, 3000);
      },
    });

    this.connection.on('error', (error: Error) => {
      queueLogger().error('Redis connection error', { error: error.message });
    });

    this.connection.on('connect', () => {
      queueLogger().info('Redis connected for queues');
    });
  }

  /**
   * Initialize all queues
   */
  async initialize(): Promise<void> {
    const logger = queueLogger();

    // Default queue options
    const defaultOpts: QueueOptions = {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: {
          count: 1000,
          age: 24 * 60 * 60, // 24 hours
        },
        removeOnFail: {
          count: 5000,
          age: 7 * 24 * 60 * 60, // 7 days
        },
      },
    };

    // Create Matrix to AP queue
    this.queues.set(
      QUEUE_NAMES.MATRIX_TO_AP,
      new Queue(QUEUE_NAMES.MATRIX_TO_AP, defaultOpts)
    );

    // Create AP to Matrix queue
    this.queues.set(
      QUEUE_NAMES.AP_TO_MATRIX,
      new Queue(QUEUE_NAMES.AP_TO_MATRIX, defaultOpts)
    );

    // Create AP delivery queue with custom options
    this.queues.set(
      QUEUE_NAMES.AP_DELIVERY,
      new Queue(QUEUE_NAMES.AP_DELIVERY, {
        ...defaultOpts,
        defaultJobOptions: {
          ...defaultOpts.defaultJobOptions,
          attempts: 10, // More retries for delivery
          backoff: {
            type: 'exponential',
            delay: 2000, // Start with 2 seconds
          },
        },
      })
    );

    logger.info('Queues initialized', {
      queues: Object.values(QUEUE_NAMES),
    });
  }

  /**
   * Get a queue by name
   */
  getQueue(name: string): Queue | undefined {
    return this.queues.get(name);
  }

  /**
   * Add a Matrix to AP job
   */
  async addMatrixToAPJob(
    data: MatrixToAPJobData,
    options?: JobsOptions
  ): Promise<string> {
    const queue = this.queues.get(QUEUE_NAMES.MATRIX_TO_AP);
    if (queue === undefined) {
      throw new Error('Matrix to AP queue not initialized');
    }

    const job = await queue.add('bridge', data, {
      ...options,
      jobId: `matrix-${data.eventId}`,
    });

    queueLogger().debug('Added Matrix to AP job', {
      jobId: job.id,
      eventId: data.eventId,
    });

    return job.id ?? '';
  }

  /**
   * Add an AP to Matrix job
   */
  async addAPToMatrixJob(
    data: APToMatrixJobData,
    options?: JobsOptions
  ): Promise<string> {
    const queue = this.queues.get(QUEUE_NAMES.AP_TO_MATRIX);
    if (queue === undefined) {
      throw new Error('AP to Matrix queue not initialized');
    }

    const job = await queue.add('bridge', data, {
      ...options,
      jobId: `ap-${data.activityId}`,
    });

    queueLogger().debug('Added AP to Matrix job', {
      jobId: job.id,
      activityId: data.activityId,
    });

    return job.id ?? '';
  }

  /**
   * Add an AP delivery job
   */
  async addAPDeliveryJob(
    data: APDeliveryJobData,
    options?: JobsOptions
  ): Promise<string> {
    const queue = this.queues.get(QUEUE_NAMES.AP_DELIVERY);
    if (queue === undefined) {
      throw new Error('AP delivery queue not initialized');
    }

    // Use inbox URL hash for job ID to prevent duplicates
    const inboxHash = Buffer.from(data.inboxUrl).toString('base64url').slice(0, 16);
    const jobId = `deliver-${data.activityId}-${inboxHash}`;

    const job = await queue.add('deliver', data, {
      ...options,
      jobId,
    });

    queueLogger().debug('Added AP delivery job', {
      jobId: job.id,
      activityId: data.activityId,
      inboxUrl: data.inboxUrl,
    });

    return job.id ?? '';
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<Record<string, { waiting: number; active: number; completed: number; failed: number }>> {
    const stats: Record<string, { waiting: number; active: number; completed: number; failed: number }> = {};

    for (const [name, queue] of this.queues) {
      const counts = await queue.getJobCounts();
      stats[name] = {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
      };
    }

    return stats;
  }

  /**
   * Get queue depth (waiting + active jobs)
   */
  async getQueueDepth(queueName: string): Promise<number> {
    const queue = this.queues.get(queueName);
    if (queue === undefined) {
      return 0;
    }

    const counts = await queue.getJobCounts();
    return (counts.waiting ?? 0) + (counts.active ?? 0);
  }

  /**
   * Pause all queues
   */
  async pauseAll(): Promise<void> {
    for (const [name, queue] of this.queues) {
      await queue.pause();
      queueLogger().info('Queue paused', { queue: name });
    }
  }

  /**
   * Resume all queues
   */
  async resumeAll(): Promise<void> {
    for (const [name, queue] of this.queues) {
      await queue.resume();
      queueLogger().info('Queue resumed', { queue: name });
    }
  }

  /**
   * Close all queues and connections
   */
  async close(): Promise<void> {
    if (this.isShutdown) {
      return;
    }

    this.isShutdown = true;
    const logger = queueLogger();

    // Close all queues
    for (const [name, queue] of this.queues) {
      await queue.close();
      logger.debug('Queue closed', { queue: name });
    }

    // Close Redis connection
    await this.connection.quit();
    logger.info('Queue manager closed');
  }

  /**
   * Get the Redis connection (for workers)
   */
  getConnection(): RedisInstance {
    return this.connection;
  }
}

// Singleton instance
let _queueManager: QueueManager | null = null;

/**
 * Initialize the queue manager
 */
export function initQueueManager(config: RedisConfig): QueueManager {
  if (_queueManager !== null) {
    queueLogger().warn('Queue manager already initialized');
    return _queueManager;
  }

  _queueManager = new QueueManager(config);
  return _queueManager;
}

/**
 * Get the queue manager
 */
export function getQueueManager(): QueueManager {
  if (_queueManager === null) {
    throw new Error('Queue manager not initialized');
  }
  return _queueManager;
}

/**
 * Close the queue manager
 */
export async function closeQueueManager(): Promise<void> {
  if (_queueManager !== null) {
    await _queueManager.close();
    _queueManager = null;
  }
}
