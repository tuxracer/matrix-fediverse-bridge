import { randomUUID } from 'crypto';
import { type Request, type Response, type NextFunction } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

/**
 * Express middleware to add a request ID to each request
 * Uses X-Request-ID header if provided, otherwise generates a new UUID
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
}

/**
 * Generate a new request ID
 */
export function generateRequestId(): string {
  return randomUUID();
}
