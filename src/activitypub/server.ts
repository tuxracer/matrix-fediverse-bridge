import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { type ActivityPubConfig } from '../config/index.js';
import { activityPubLogger, createRequestLogger } from '../utils/logger.js';
import { requestIdMiddleware } from '../utils/requestId.js';

/**
 * Content types for ActivityPub
 */
export const ACTIVITY_CONTENT_TYPE = 'application/activity+json';
export const LD_CONTENT_TYPE = 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"';
export const ACCEPT_TYPES = [ACTIVITY_CONTENT_TYPE, LD_CONTENT_TYPE, 'application/json'];

/**
 * Rate limiter state per remote server
 */
interface RateLimitState {
  count: number;
  resetTime: number;
}

/**
 * ActivityPub HTTP server
 */
export class ActivityPubServer {
  private app: Express;
  private config: ActivityPubConfig;
  private server: ReturnType<Express['listen']> | null = null;
  private rateLimitState: Map<string, RateLimitState> = new Map();
  private rateLimitPerMinute = 100;

  constructor(config: ActivityPubConfig, rateLimitPerMinute = 100) {
    this.config = config;
    this.rateLimitPerMinute = rateLimitPerMinute;
    this.app = express();
    this.setupMiddleware();
    this.setupCoreRoutes();
  }

  /**
   * Configure Express middleware
   */
  private setupMiddleware(): void {
    // Parse JSON bodies
    this.app.use(
      express.json({
        limit: '1mb',
        type: ['application/json', ACTIVITY_CONTENT_TYPE, 'application/ld+json'],
      })
    );

    // Parse raw bodies for signature verification
    this.app.use(
      express.raw({
        limit: '1mb',
        type: ['application/json', ACTIVITY_CONTENT_TYPE, 'application/ld+json'],
      })
    );

    // Request ID tracking
    this.app.use(requestIdMiddleware);

    // Request logging
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const logger = createRequestLogger(req.requestId);
      const start = Date.now();

      res.on('finish', () => {
        const duration = Date.now() - start;
        logger.http('Request completed', {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration,
          contentType: req.headers['content-type'],
        });
      });

      next();
    });

    // Rate limiting middleware
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const remoteHost = this.extractRemoteHost(req);
      if (remoteHost !== null && !this.checkRateLimit(remoteHost)) {
        activityPubLogger().warn('Rate limit exceeded', { remoteHost });
        res.status(429).json({ error: 'Rate limit exceeded' });
        return;
      }
      next();
    });

    // Content negotiation middleware
    this.app.use((_req: Request, res: Response, next: NextFunction) => {
      // Set default content type for ActivityPub responses
      res.setHeader('Content-Type', ACTIVITY_CONTENT_TYPE);
      next();
    });

    // CORS headers for browser-based clients
    this.app.use((_req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Signature, Date, Digest');
      next();
    });
  }

  /**
   * Set up core routes (health, nodeinfo, etc.)
   */
  private setupCoreRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (_req: Request, res: Response) => {
      res.setHeader('Content-Type', 'application/json');
      res.json({ status: 'ok' });
    });

    // OPTIONS handler for CORS preflight
    this.app.options('*', (_req: Request, res: Response) => {
      res.status(204).end();
    });
  }

  /**
   * Extract remote host from request for rate limiting
   */
  private extractRemoteHost(req: Request): string | null {
    // Try to extract from Signature header
    const signature = req.headers['signature'] as string | undefined;
    if (signature !== undefined) {
      const keyIdMatch = signature.match(/keyId="([^"]+)"/);
      if (keyIdMatch?.[1] !== undefined) {
        try {
          const url = new URL(keyIdMatch[1]);
          return url.host;
        } catch {
          // Invalid URL
        }
      }
    }

    // Fall back to X-Forwarded-For or remote address
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0]?.trim() ?? null;
    }

    return req.ip ?? null;
  }

  /**
   * Check and update rate limit for a remote host
   */
  private checkRateLimit(remoteHost: string): boolean {
    const now = Date.now();
    const state = this.rateLimitState.get(remoteHost);

    if (state === undefined || now > state.resetTime) {
      // Reset or initialize
      this.rateLimitState.set(remoteHost, {
        count: 1,
        resetTime: now + 60000, // 1 minute window
      });
      return true;
    }

    if (state.count >= this.rateLimitPerMinute) {
      return false;
    }

    state.count++;
    return true;
  }

  /**
   * Clean up old rate limit entries
   */
  cleanupRateLimits(): void {
    const now = Date.now();
    for (const [host, state] of this.rateLimitState) {
      if (now > state.resetTime) {
        this.rateLimitState.delete(host);
      }
    }
  }

  /**
   * Check if client accepts ActivityPub content types
   */
  static acceptsActivityPub(req: Request): boolean {
    const accept = req.headers['accept'];
    if (accept === undefined) {
      return true; // Default to accepting
    }

    return ACCEPT_TYPES.some((type) => accept.includes(type));
  }

  /**
   * Get the Express app for route registration
   */
  getApp(): Express {
    return this.app;
  }

  /**
   * Get the base URL for this server
   */
  getBaseUrl(): string {
    return `https://${this.config.domain}`;
  }

  /**
   * Start the ActivityPub server
   */
  async start(): Promise<void> {
    const logger = activityPubLogger();

    return new Promise((resolve) => {
      this.server = this.app.listen(this.config.port, () => {
        logger.info('ActivityPub server started', {
          port: this.config.port,
          domain: this.config.domain,
        });

        // Start rate limit cleanup interval
        setInterval(() => this.cleanupRateLimits(), 60000);

        resolve();
      });
    });
  }

  /**
   * Stop the ActivityPub server
   */
  async stop(): Promise<void> {
    const logger = activityPubLogger();

    if (this.server !== null) {
      return new Promise((resolve) => {
        this.server?.close(() => {
          logger.info('ActivityPub server stopped');
          this.server = null;
          resolve();
        });
      });
    }
  }
}
