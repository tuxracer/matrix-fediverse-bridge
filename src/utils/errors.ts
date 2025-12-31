/**
 * Base error class for the bridge
 */
export class BridgeError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    statusCode = 500,
    isOperational = true,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      details: this.details,
    };
  }
}

/**
 * Configuration errors
 */
export class ConfigurationError extends BridgeError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFIGURATION_ERROR', 500, false, details);
  }
}

/**
 * Database connection/query errors
 */
export class DatabaseError extends BridgeError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'DATABASE_ERROR', 503, true, details);
  }
}

/**
 * Redis connection errors
 */
export class RedisError extends BridgeError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'REDIS_ERROR', 503, true, details);
  }
}

/**
 * Matrix homeserver communication errors
 */
export class MatrixError extends BridgeError {
  constructor(message: string, statusCode = 502, details?: Record<string, unknown>) {
    super(message, 'MATRIX_ERROR', statusCode, true, details);
  }
}

/**
 * ActivityPub federation errors
 */
export class FederationError extends BridgeError {
  public readonly remoteInstance?: string;

  constructor(message: string, remoteInstance?: string, details?: Record<string, unknown>) {
    super(message, 'FEDERATION_ERROR', 502, true, details);
    this.remoteInstance = remoteInstance;
  }
}

/**
 * HTTP Signature errors
 */
export class SignatureError extends BridgeError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'SIGNATURE_ERROR', 401, true, details);
  }
}

/**
 * Rate limiting errors
 */
export class RateLimitError extends BridgeError {
  public readonly retryAfter?: number;

  constructor(message: string, retryAfter?: number, details?: Record<string, unknown>) {
    super(message, 'RATE_LIMIT_ERROR', 429, true, details);
    this.retryAfter = retryAfter;
  }
}

/**
 * Validation errors
 */
export class ValidationError extends BridgeError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, true, details);
  }
}

/**
 * Not found errors
 */
export class NotFoundError extends BridgeError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'NOT_FOUND', 404, true, details);
  }
}

/**
 * Authorization errors
 */
export class AuthorizationError extends BridgeError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'AUTHORIZATION_ERROR', 403, true, details);
  }
}

/**
 * Blocked instance error
 */
export class BlockedInstanceError extends BridgeError {
  public readonly instance: string;

  constructor(instance: string) {
    super(`Instance ${instance} is blocked`, 'BLOCKED_INSTANCE', 403, true, { instance });
    this.instance = instance;
  }
}

/**
 * Circuit breaker open error
 */
export class CircuitBreakerOpenError extends BridgeError {
  public readonly instance: string;
  public readonly resetAt: Date;

  constructor(instance: string, resetAt: Date) {
    super(
      `Circuit breaker open for ${instance}`,
      'CIRCUIT_BREAKER_OPEN',
      503,
      true,
      { instance, resetAt: resetAt.toISOString() }
    );
    this.instance = instance;
    this.resetAt = resetAt;
  }
}

/**
 * Circuit breaker for failing remote instances
 */
export class CircuitBreaker {
  private failures: Map<string, { count: number; lastFailure: Date; openUntil?: Date }> = new Map();
  private readonly threshold: number;
  private readonly resetTimeout: number;

  constructor(threshold = 5, resetTimeoutMs = 60000) {
    this.threshold = threshold;
    this.resetTimeout = resetTimeoutMs;
  }

  /**
   * Record a failure for an instance
   */
  recordFailure(instance: string): void {
    const existing = this.failures.get(instance) ?? { count: 0, lastFailure: new Date() };
    existing.count += 1;
    existing.lastFailure = new Date();

    if (existing.count >= this.threshold) {
      existing.openUntil = new Date(Date.now() + this.resetTimeout);
    }

    this.failures.set(instance, existing);
  }

  /**
   * Record a success for an instance (resets the circuit)
   */
  recordSuccess(instance: string): void {
    this.failures.delete(instance);
  }

  /**
   * Check if requests to an instance are allowed
   */
  isAllowed(instance: string): boolean {
    const state = this.failures.get(instance);
    if (state === undefined) {
      return true;
    }

    if (state.openUntil !== undefined) {
      if (new Date() > state.openUntil) {
        // Half-open state - allow one request
        state.openUntil = undefined;
        state.count = this.threshold - 1; // Will open again on next failure
        return true;
      }
      return false;
    }

    return true;
  }

  /**
   * Get the reset time for an open circuit
   */
  getResetTime(instance: string): Date | undefined {
    return this.failures.get(instance)?.openUntil;
  }

  /**
   * Check and throw if circuit is open
   */
  checkOrThrow(instance: string): void {
    if (!this.isAllowed(instance)) {
      const resetAt = this.getResetTime(instance);
      if (resetAt !== undefined) {
        throw new CircuitBreakerOpenError(instance, resetAt);
      }
    }
  }

  /**
   * Get circuit status for all instances
   */
  getStatus(): Map<string, { failures: number; isOpen: boolean; opensAt?: Date }> {
    const status = new Map<string, { failures: number; isOpen: boolean; opensAt?: Date }>();

    for (const [instance, state] of this.failures) {
      status.set(instance, {
        failures: state.count,
        isOpen: state.openUntil !== undefined && new Date() < state.openUntil,
        opensAt: state.openUntil,
      });
    }

    return status;
  }
}

/**
 * Global circuit breaker instance
 */
export const federationCircuitBreaker = new CircuitBreaker(5, 60000);

/**
 * Check if an error is operational (expected) vs programmer error
 */
export function isOperationalError(error: unknown): boolean {
  if (error instanceof BridgeError) {
    return error.isOperational;
  }
  return false;
}

/**
 * Format error for logging
 */
export function formatErrorForLogging(error: unknown): Record<string, unknown> {
  if (error instanceof BridgeError) {
    return {
      ...error.toJSON(),
      stack: error.stack,
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}

/**
 * Format error for API response
 */
export function formatErrorForResponse(error: unknown): { error: string; code?: string; details?: unknown } {
  if (error instanceof BridgeError) {
    return {
      error: error.message,
      code: error.code,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      error: error.message,
    };
  }

  return {
    error: 'An unexpected error occurred',
  };
}
