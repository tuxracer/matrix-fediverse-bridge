/**
 * Unit tests for error handling utilities
 */
import {
  BridgeError,
  ConfigurationError,
  DatabaseError,
  FederationError,
  SignatureError,
  RateLimitError,
  ValidationError,
  NotFoundError,
  CircuitBreaker,
  CircuitBreakerOpenError,
  isOperationalError,
  formatErrorForLogging,
  formatErrorForResponse,
} from '../../src/utils/errors.js';

describe('BridgeError', () => {
  it('should create error with all properties', () => {
    const error = new BridgeError('Test error', 'TEST_ERROR', 500, true, { foo: 'bar' });

    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_ERROR');
    expect(error.statusCode).toBe(500);
    expect(error.isOperational).toBe(true);
    expect(error.details).toEqual({ foo: 'bar' });
    expect(error.name).toBe('BridgeError');
  });

  it('should default to 500 status code', () => {
    const error = new BridgeError('Test', 'TEST');
    expect(error.statusCode).toBe(500);
  });

  it('should default to operational=true', () => {
    const error = new BridgeError('Test', 'TEST');
    expect(error.isOperational).toBe(true);
  });

  it('should serialize to JSON correctly', () => {
    const error = new BridgeError('Test error', 'TEST_ERROR', 400, true, { field: 'value' });
    const json = error.toJSON();

    expect(json).toEqual({
      name: 'BridgeError',
      message: 'Test error',
      code: 'TEST_ERROR',
      statusCode: 400,
      details: { field: 'value' },
    });
  });

  it('should have stack trace', () => {
    const error = new BridgeError('Test', 'TEST');
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('BridgeError');
  });
});

describe('Specialized Error Classes', () => {
  describe('ConfigurationError', () => {
    it('should have correct properties', () => {
      const error = new ConfigurationError('Invalid config');
      expect(error.code).toBe('CONFIGURATION_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.isOperational).toBe(false); // Config errors are programmer errors
    });
  });

  describe('DatabaseError', () => {
    it('should have correct properties', () => {
      const error = new DatabaseError('Connection failed');
      expect(error.code).toBe('DATABASE_ERROR');
      expect(error.statusCode).toBe(503);
      expect(error.isOperational).toBe(true);
    });
  });

  describe('FederationError', () => {
    it('should have correct properties', () => {
      const error = new FederationError('Delivery failed', 'mastodon.social', { retry: 3 });
      expect(error.code).toBe('FEDERATION_ERROR');
      expect(error.statusCode).toBe(502);
      expect(error.remoteInstance).toBe('mastodon.social');
      expect(error.details).toEqual({ retry: 3 });
    });
  });

  describe('SignatureError', () => {
    it('should have correct properties', () => {
      const error = new SignatureError('Invalid signature');
      expect(error.code).toBe('SIGNATURE_ERROR');
      expect(error.statusCode).toBe(401);
    });
  });

  describe('RateLimitError', () => {
    it('should have correct properties with retry-after', () => {
      const error = new RateLimitError('Too many requests', 60);
      expect(error.code).toBe('RATE_LIMIT_ERROR');
      expect(error.statusCode).toBe(429);
      expect(error.retryAfter).toBe(60);
    });
  });

  describe('ValidationError', () => {
    it('should have correct properties', () => {
      const error = new ValidationError('Invalid input', { field: 'email', reason: 'format' });
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.statusCode).toBe(400);
      expect(error.details).toEqual({ field: 'email', reason: 'format' });
    });
  });

  describe('NotFoundError', () => {
    it('should have correct properties', () => {
      const error = new NotFoundError('User not found');
      expect(error.code).toBe('NOT_FOUND');
      expect(error.statusCode).toBe(404);
    });
  });
});

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker(3, 1000); // 3 failures, 1 second timeout
  });

  it('should allow requests initially', () => {
    expect(circuitBreaker.isAllowed('test.instance')).toBe(true);
  });

  it('should still allow requests after fewer failures than threshold', () => {
    circuitBreaker.recordFailure('test.instance');
    circuitBreaker.recordFailure('test.instance');
    expect(circuitBreaker.isAllowed('test.instance')).toBe(true);
  });

  it('should block requests after reaching failure threshold', () => {
    circuitBreaker.recordFailure('test.instance');
    circuitBreaker.recordFailure('test.instance');
    circuitBreaker.recordFailure('test.instance');
    expect(circuitBreaker.isAllowed('test.instance')).toBe(false);
  });

  it('should reset on success', () => {
    circuitBreaker.recordFailure('test.instance');
    circuitBreaker.recordFailure('test.instance');
    circuitBreaker.recordSuccess('test.instance');
    expect(circuitBreaker.isAllowed('test.instance')).toBe(true);
  });

  it('should track instances independently', () => {
    circuitBreaker.recordFailure('instance1');
    circuitBreaker.recordFailure('instance1');
    circuitBreaker.recordFailure('instance1');

    expect(circuitBreaker.isAllowed('instance1')).toBe(false);
    expect(circuitBreaker.isAllowed('instance2')).toBe(true);
  });

  it('should throw CircuitBreakerOpenError when checking open circuit', () => {
    circuitBreaker.recordFailure('test.instance');
    circuitBreaker.recordFailure('test.instance');
    circuitBreaker.recordFailure('test.instance');

    expect(() => circuitBreaker.checkOrThrow('test.instance')).toThrow(CircuitBreakerOpenError);
  });

  it('should return reset time for open circuits', () => {
    circuitBreaker.recordFailure('test.instance');
    circuitBreaker.recordFailure('test.instance');
    circuitBreaker.recordFailure('test.instance');

    const resetTime = circuitBreaker.getResetTime('test.instance');
    expect(resetTime).toBeInstanceOf(Date);
    expect(resetTime!.getTime()).toBeGreaterThan(Date.now());
  });

  it('should report status correctly', () => {
    circuitBreaker.recordFailure('open.instance');
    circuitBreaker.recordFailure('open.instance');
    circuitBreaker.recordFailure('open.instance');

    circuitBreaker.recordFailure('half.instance');

    const status = circuitBreaker.getStatus();

    expect(status.get('open.instance')?.isOpen).toBe(true);
    expect(status.get('open.instance')?.failures).toBe(3);

    expect(status.get('half.instance')?.isOpen).toBe(false);
    expect(status.get('half.instance')?.failures).toBe(1);
  });

  it('should allow one request in half-open state after timeout', async () => {
    // Use a very short timeout for testing
    const fastBreaker = new CircuitBreaker(2, 10); // 10ms timeout

    fastBreaker.recordFailure('test.instance');
    fastBreaker.recordFailure('test.instance');
    expect(fastBreaker.isAllowed('test.instance')).toBe(false);

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 15));

    // Should allow one request (half-open)
    expect(fastBreaker.isAllowed('test.instance')).toBe(true);
  });
});

describe('Error Utility Functions', () => {
  describe('isOperationalError', () => {
    it('should return true for operational BridgeErrors', () => {
      const error = new ValidationError('Invalid input');
      expect(isOperationalError(error)).toBe(true);
    });

    it('should return false for non-operational BridgeErrors', () => {
      const error = new ConfigurationError('Bad config');
      expect(isOperationalError(error)).toBe(false);
    });

    it('should return false for regular Errors', () => {
      const error = new Error('Regular error');
      expect(isOperationalError(error)).toBe(false);
    });

    it('should return false for non-error values', () => {
      expect(isOperationalError('string error')).toBe(false);
      expect(isOperationalError(null)).toBe(false);
      expect(isOperationalError(undefined)).toBe(false);
    });
  });

  describe('formatErrorForLogging', () => {
    it('should format BridgeError with all properties', () => {
      const error = new ValidationError('Invalid email', { field: 'email' });
      const formatted = formatErrorForLogging(error);

      expect(formatted.name).toBe('ValidationError');
      expect(formatted.message).toBe('Invalid email');
      expect(formatted.code).toBe('VALIDATION_ERROR');
      expect(formatted.statusCode).toBe(400);
      expect(formatted.details).toEqual({ field: 'email' });
      expect(formatted.stack).toBeDefined();
    });

    it('should format regular Error', () => {
      const error = new Error('Something went wrong');
      const formatted = formatErrorForLogging(error);

      expect(formatted.name).toBe('Error');
      expect(formatted.message).toBe('Something went wrong');
      expect(formatted.stack).toBeDefined();
    });

    it('should format non-error values', () => {
      expect(formatErrorForLogging('string error')).toEqual({ message: 'string error' });
      expect(formatErrorForLogging(123)).toEqual({ message: '123' });
    });
  });

  describe('formatErrorForResponse', () => {
    it('should format BridgeError for API response', () => {
      const error = new ValidationError('Invalid input', { fields: ['email'] });
      const formatted = formatErrorForResponse(error);

      expect(formatted).toEqual({
        error: 'Invalid input',
        code: 'VALIDATION_ERROR',
        details: { fields: ['email'] },
      });
    });

    it('should format regular Error', () => {
      const error = new Error('Something went wrong');
      const formatted = formatErrorForResponse(error);

      expect(formatted).toEqual({
        error: 'Something went wrong',
      });
    });

    it('should format unknown error types', () => {
      const formatted = formatErrorForResponse('unknown error');

      expect(formatted).toEqual({
        error: 'An unexpected error occurred',
      });
    });
  });
});

describe('CircuitBreakerOpenError', () => {
  it('should have correct properties', () => {
    const resetAt = new Date(Date.now() + 60000);
    const error = new CircuitBreakerOpenError('mastodon.social', resetAt);

    expect(error.code).toBe('CIRCUIT_BREAKER_OPEN');
    expect(error.statusCode).toBe(503);
    expect(error.instance).toBe('mastodon.social');
    expect(error.resetAt).toEqual(resetAt);
    expect(error.message).toBe('Circuit breaker open for mastodon.social');
    expect(error.details).toEqual({
      instance: 'mastodon.social',
      resetAt: resetAt.toISOString(),
    });
  });
});
