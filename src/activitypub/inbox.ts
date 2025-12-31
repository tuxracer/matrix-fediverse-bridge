import { type Request, type Response, type Router } from 'express';
import express from 'express';
import { activityPubLogger, createRequestLogger } from '../utils/logger.js';
import { type SignatureManager } from './signatures.js';

/**
 * ActivityPub Activity object
 */
export interface APActivity {
  '@context'?: string | string[];
  id: string;
  type: string;
  actor: string | { id: string };
  object?: string | APObject | APActivity;
  target?: string | APObject;
  to?: string | string[];
  cc?: string | string[];
  bto?: string | string[];
  bcc?: string | string[];
  published?: string;
  updated?: string;
}

/**
 * ActivityPub Object
 */
export interface APObject {
  '@context'?: string | string[];
  id: string;
  type: string;
  attributedTo?: string;
  content?: string;
  summary?: string;
  published?: string;
  updated?: string;
  to?: string | string[];
  cc?: string | string[];
  inReplyTo?: string;
  attachment?: APAttachment[];
  tag?: APTag[];
  url?: string;
  sensitive?: boolean;
}

/**
 * ActivityPub Attachment
 */
export interface APAttachment {
  type: string;
  mediaType?: string;
  url: string;
  name?: string;
  width?: number;
  height?: number;
  blurhash?: string;
}

/**
 * ActivityPub Tag (mention, hashtag, emoji)
 */
export interface APTag {
  type: string;
  name: string;
  href?: string;
}

/**
 * Activity handler function
 */
export type ActivityHandler = (activity: APActivity, actorId: string) => Promise<void>;

/**
 * Processed activity tracker for deduplication
 */
interface ProcessedActivity {
  processedAt: number;
}

/**
 * Inbox processor for handling incoming ActivityPub activities
 */
export class InboxProcessor {
  private signatureManager: SignatureManager;
  private processedActivities: Map<string, ProcessedActivity> = new Map();
  private readonly maxProcessedActivities = 10000;
  private readonly processedTTL = 3600000; // 1 hour

  // Activity handlers
  private createHandlers: ActivityHandler[] = [];
  private updateHandlers: ActivityHandler[] = [];
  private deleteHandlers: ActivityHandler[] = [];
  private likeHandlers: ActivityHandler[] = [];
  private announceHandlers: ActivityHandler[] = [];
  private followHandlers: ActivityHandler[] = [];
  private acceptHandlers: ActivityHandler[] = [];
  private rejectHandlers: ActivityHandler[] = [];
  private undoHandlers: ActivityHandler[] = [];
  private blockHandlers: ActivityHandler[] = [];
  private addHandlers: ActivityHandler[] = [];
  private removeHandlers: ActivityHandler[] = [];

  constructor(signatureManager: SignatureManager) {
    this.signatureManager = signatureManager;
  }

  /**
   * Process an incoming activity
   */
  async processActivity(activity: APActivity, requestBody: string): Promise<void> {
    const logger = activityPubLogger();

    // Get actor ID
    const actorId = typeof activity.actor === 'string' ? activity.actor : activity.actor.id;

    // Check for duplicate
    if (this.processedActivities.has(activity.id)) {
      logger.debug('Duplicate activity, skipping', { activityId: activity.id });
      return;
    }

    logger.info('Processing activity', {
      activityId: activity.id,
      type: activity.type,
      actor: actorId,
    });

    // Mark as processed
    this.processedActivities.set(activity.id, { processedAt: Date.now() });
    this.cleanupProcessedActivities();

    // Route to appropriate handlers
    const handlers = this.getHandlersForType(activity.type);
    for (const handler of handlers) {
      try {
        await handler(activity, actorId);
      } catch (error) {
        logger.error('Activity handler failed', {
          activityId: activity.id,
          type: activity.type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Get handlers for an activity type
   */
  private getHandlersForType(type: string): ActivityHandler[] {
    switch (type) {
      case 'Create':
        return this.createHandlers;
      case 'Update':
        return this.updateHandlers;
      case 'Delete':
        return this.deleteHandlers;
      case 'Like':
        return this.likeHandlers;
      case 'Announce':
        return this.announceHandlers;
      case 'Follow':
        return this.followHandlers;
      case 'Accept':
        return this.acceptHandlers;
      case 'Reject':
        return this.rejectHandlers;
      case 'Undo':
        return this.undoHandlers;
      case 'Block':
        return this.blockHandlers;
      case 'Add':
        return this.addHandlers;
      case 'Remove':
        return this.removeHandlers;
      default:
        return [];
    }
  }

  /**
   * Clean up old processed activities
   */
  private cleanupProcessedActivities(): void {
    const now = Date.now();

    // Remove expired entries
    for (const [id, entry] of this.processedActivities) {
      if (now - entry.processedAt > this.processedTTL) {
        this.processedActivities.delete(id);
      }
    }

    // Enforce max size
    if (this.processedActivities.size > this.maxProcessedActivities) {
      const toDelete = this.processedActivities.size - this.maxProcessedActivities;
      const iterator = this.processedActivities.keys();
      for (let i = 0; i < toDelete; i++) {
        const key = iterator.next().value;
        if (key !== undefined) {
          this.processedActivities.delete(key);
        }
      }
    }
  }

  // Handler registration methods
  onCreate(handler: ActivityHandler): void {
    this.createHandlers.push(handler);
  }

  onUpdate(handler: ActivityHandler): void {
    this.updateHandlers.push(handler);
  }

  onDelete(handler: ActivityHandler): void {
    this.deleteHandlers.push(handler);
  }

  onLike(handler: ActivityHandler): void {
    this.likeHandlers.push(handler);
  }

  onAnnounce(handler: ActivityHandler): void {
    this.announceHandlers.push(handler);
  }

  onFollow(handler: ActivityHandler): void {
    this.followHandlers.push(handler);
  }

  onAccept(handler: ActivityHandler): void {
    this.acceptHandlers.push(handler);
  }

  onReject(handler: ActivityHandler): void {
    this.rejectHandlers.push(handler);
  }

  onUndo(handler: ActivityHandler): void {
    this.undoHandlers.push(handler);
  }

  onBlock(handler: ActivityHandler): void {
    this.blockHandlers.push(handler);
  }

  onAdd(handler: ActivityHandler): void {
    this.addHandlers.push(handler);
  }

  onRemove(handler: ActivityHandler): void {
    this.removeHandlers.push(handler);
  }

  /**
   * Get the signature manager
   */
  getSignatureManager(): SignatureManager {
    return this.signatureManager;
  }
}

/**
 * Create inbox routes
 */
export function createInboxRouter(processor: InboxProcessor): Router {
  const router = express.Router();
  const logger = activityPubLogger();

  /**
   * Middleware to capture raw body for signature verification
   */
  const captureBody = (req: Request, _res: Response, next: () => void): void => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      (req as Request & { rawBody: string }).rawBody = body;
      next();
    });
  };

  /**
   * User inbox endpoint
   * POST /users/:username/inbox
   */
  router.post('/users/:username/inbox', captureBody, async (req: Request, res: Response): Promise<void> => {
    const requestLogger = createRequestLogger(req.requestId);
    const { username } = req.params;
    const rawBody = (req as Request & { rawBody: string }).rawBody;

    requestLogger.debug('Received activity to user inbox', { username });

    // Verify HTTP signature
    const signatureValid = await processor.getSignatureManager().verifyRequest(req, rawBody);
    if (!signatureValid) {
      requestLogger.warn('Invalid signature on inbox request', { username });
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    try {
      const activity = JSON.parse(rawBody) as APActivity;

      // Validate activity has required fields
      if (activity.id === undefined || activity.type === undefined || activity.actor === undefined) {
        res.status(400).json({ error: 'Invalid activity: missing required fields' });
        return;
      }

      await processor.processActivity(activity, rawBody);
      res.status(202).json({ status: 'accepted' });
    } catch (error) {
      requestLogger.error('Failed to process inbox activity', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Shared inbox endpoint
   * POST /inbox
   */
  router.post('/inbox', captureBody, async (req: Request, res: Response): Promise<void> => {
    const requestLogger = createRequestLogger(req.requestId);
    const rawBody = (req as Request & { rawBody: string }).rawBody;

    requestLogger.debug('Received activity to shared inbox');

    // Verify HTTP signature
    const signatureValid = await processor.getSignatureManager().verifyRequest(req, rawBody);
    if (!signatureValid) {
      requestLogger.warn('Invalid signature on shared inbox request');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    try {
      const activity = JSON.parse(rawBody) as APActivity;

      // Validate activity has required fields
      if (activity.id === undefined || activity.type === undefined || activity.actor === undefined) {
        res.status(400).json({ error: 'Invalid activity: missing required fields' });
        return;
      }

      await processor.processActivity(activity, rawBody);
      res.status(202).json({ status: 'accepted' });
    } catch (error) {
      requestLogger.error('Failed to process shared inbox activity', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

/**
 * Validate an ActivityPub activity
 */
export function validateActivity(activity: unknown): activity is APActivity {
  if (typeof activity !== 'object' || activity === null) {
    return false;
  }

  const obj = activity as Record<string, unknown>;

  return (
    typeof obj['id'] === 'string' &&
    typeof obj['type'] === 'string' &&
    (typeof obj['actor'] === 'string' ||
      (typeof obj['actor'] === 'object' && obj['actor'] !== null && typeof (obj['actor'] as Record<string, unknown>)['id'] === 'string'))
  );
}
