import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { type MatrixConfig } from '../config/index.js';
import { matrixLogger, createRequestLogger } from '../utils/logger.js';
import { requestIdMiddleware } from '../utils/requestId.js';

/**
 * Matrix event from the homeserver
 */
export interface MatrixEvent {
  type: string;
  event_id: string;
  room_id: string;
  sender: string;
  origin_server_ts: number;
  content: Record<string, unknown>;
  unsigned?: {
    age?: number;
    transaction_id?: string;
  };
  state_key?: string;
}

/**
 * Transaction from the homeserver
 */
interface Transaction {
  events: MatrixEvent[];
}

/**
 * Appservice event handler type
 */
export type EventHandler = (event: MatrixEvent) => Promise<void>;

/**
 * User query handler type
 */
export type UserQueryHandler = (userId: string) => Promise<boolean>;

/**
 * Room alias query handler type
 */
export type RoomAliasQueryHandler = (roomAlias: string) => Promise<boolean>;

/**
 * Matrix Appservice server
 */
export class MatrixAppservice {
  private app: Express;
  private config: MatrixConfig;
  private server: ReturnType<Express['listen']> | null = null;
  private processedTransactions: Set<string> = new Set();
  private eventHandlers: EventHandler[] = [];
  private userQueryHandler: UserQueryHandler | null = null;
  private roomAliasQueryHandler: RoomAliasQueryHandler | null = null;
  private readonly maxProcessedTransactions = 1000;

  constructor(config: MatrixConfig) {
    this.config = config;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Configure Express middleware
   */
  private setupMiddleware(): void {
    // Parse JSON bodies
    this.app.use(express.json({ limit: '10mb' }));

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
        });
      });

      next();
    });

    // Authentication middleware for appservice endpoints
    this.app.use('/_matrix/app', (req: Request, res: Response, next: NextFunction) => {
      const token = req.query['access_token'] as string | undefined;

      if (token !== this.config.homeserverToken) {
        matrixLogger().warn('Unauthorized request to appservice', {
          path: req.path,
          providedToken: token ? '[REDACTED]' : 'none',
        });
        res.status(401).json({ errcode: 'M_UNAUTHORIZED', error: 'Invalid hs_token' });
        return;
      }

      next();
    });
  }

  /**
   * Set up appservice routes
   */
  private setupRoutes(): void {
    const logger = matrixLogger();

    // Health check endpoint
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok' });
    });

    // Transaction endpoint - receives events from homeserver
    this.app.put(
      '/_matrix/app/v1/transactions/:txnId',
      async (req: Request, res: Response): Promise<void> => {
        const { txnId } = req.params;
        const requestLogger = createRequestLogger(req.requestId);

        // Deduplicate transactions
        if (this.processedTransactions.has(txnId ?? '')) {
          requestLogger.debug('Duplicate transaction, skipping', { txnId });
          res.json({});
          return;
        }

        try {
          const transaction = req.body as Transaction;
          const events = transaction.events ?? [];

          requestLogger.debug('Processing transaction', {
            txnId,
            eventCount: events.length,
          });

          // Process events
          for (const event of events) {
            await this.processEvent(event, requestLogger);
          }

          // Mark transaction as processed
          this.processedTransactions.add(txnId ?? '');
          this.cleanupProcessedTransactions();

          res.json({});
        } catch (error) {
          requestLogger.error('Failed to process transaction', {
            txnId,
            error: error instanceof Error ? error.message : String(error),
          });
          res.status(500).json({
            errcode: 'M_UNKNOWN',
            error: 'Internal server error',
          });
        }
      }
    );

    // User query endpoint
    this.app.get(
      '/_matrix/app/v1/users/:userId',
      async (req: Request, res: Response): Promise<void> => {
        const { userId } = req.params;
        const requestLogger = createRequestLogger(req.requestId);

        requestLogger.debug('User query', { userId });

        try {
          if (this.userQueryHandler !== null) {
            const exists = await this.userQueryHandler(userId ?? '');
            if (exists) {
              res.json({});
              return;
            }
          }

          res.status(404).json({
            errcode: 'M_NOT_FOUND',
            error: 'User not found',
          });
        } catch (error) {
          requestLogger.error('User query failed', {
            userId,
            error: error instanceof Error ? error.message : String(error),
          });
          res.status(500).json({
            errcode: 'M_UNKNOWN',
            error: 'Internal server error',
          });
        }
      }
    );

    // Room alias query endpoint
    this.app.get(
      '/_matrix/app/v1/rooms/:roomAlias',
      async (req: Request, res: Response): Promise<void> => {
        const { roomAlias } = req.params;
        const requestLogger = createRequestLogger(req.requestId);

        requestLogger.debug('Room alias query', { roomAlias });

        try {
          if (this.roomAliasQueryHandler !== null) {
            const exists = await this.roomAliasQueryHandler(roomAlias ?? '');
            if (exists) {
              res.json({});
              return;
            }
          }

          res.status(404).json({
            errcode: 'M_NOT_FOUND',
            error: 'Room alias not found',
          });
        } catch (error) {
          requestLogger.error('Room alias query failed', {
            roomAlias,
            error: error instanceof Error ? error.message : String(error),
          });
          res.status(500).json({
            errcode: 'M_UNKNOWN',
            error: 'Internal server error',
          });
        }
      }
    );

    // Error handler
    this.app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      logger.error('Unhandled error in appservice', {
        error: err.message,
        stack: err.stack,
      });
      res.status(500).json({
        errcode: 'M_UNKNOWN',
        error: 'Internal server error',
      });
    });
  }

  /**
   * Process a single Matrix event
   */
  private async processEvent(
    event: MatrixEvent,
    logger: ReturnType<typeof createRequestLogger>
  ): Promise<void> {
    logger.debug('Processing event', {
      type: event.type,
      eventId: event.event_id,
      roomId: event.room_id,
      sender: event.sender,
    });

    // Call all registered event handlers
    for (const handler of this.eventHandlers) {
      try {
        await handler(event);
      } catch (error) {
        logger.error('Event handler failed', {
          eventId: event.event_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Clean up old processed transactions to prevent memory leak
   */
  private cleanupProcessedTransactions(): void {
    if (this.processedTransactions.size > this.maxProcessedTransactions) {
      const toDelete = this.processedTransactions.size - this.maxProcessedTransactions;
      const iterator = this.processedTransactions.values();

      for (let i = 0; i < toDelete; i++) {
        const value = iterator.next().value;
        if (value !== undefined) {
          this.processedTransactions.delete(value);
        }
      }
    }
  }

  /**
   * Register an event handler
   */
  onEvent(handler: EventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Register a user query handler
   */
  onUserQuery(handler: UserQueryHandler): void {
    this.userQueryHandler = handler;
  }

  /**
   * Register a room alias query handler
   */
  onRoomAliasQuery(handler: RoomAliasQueryHandler): void {
    this.roomAliasQueryHandler = handler;
  }

  /**
   * Start the appservice server
   */
  async start(): Promise<void> {
    const logger = matrixLogger();

    return new Promise((resolve) => {
      this.server = this.app.listen(this.config.appservicePort, () => {
        logger.info('Matrix Appservice started', {
          port: this.config.appservicePort,
        });
        resolve();
      });
    });
  }

  /**
   * Stop the appservice server
   */
  async stop(): Promise<void> {
    const logger = matrixLogger();

    if (this.server !== null) {
      return new Promise((resolve) => {
        this.server?.close(() => {
          logger.info('Matrix Appservice stopped');
          this.server = null;
          resolve();
        });
      });
    }
  }

  /**
   * Get the Express app (for testing)
   */
  getApp(): Express {
    return this.app;
  }
}
