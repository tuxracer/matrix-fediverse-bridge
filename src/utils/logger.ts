import winston from 'winston';
import { type LoggingConfig } from '../config/index.js';

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

/**
 * Custom format for pretty console output
 */
const prettyFormat = printf(({ level, message, timestamp, requestId, ...metadata }) => {
  let msg = `${String(timestamp)} [${level}]`;

  if (requestId) {
    msg += ` [${String(requestId)}]`;
  }

  msg += `: ${String(message)}`;

  if (Object.keys(metadata).length > 0) {
    // Remove the 'service' field from metadata display to avoid clutter
    const { service: _service, ...rest } = metadata;
    if (Object.keys(rest).length > 0) {
      msg += ` ${JSON.stringify(rest)}`;
    }
  }

  return msg;
});

/**
 * Create a Winston logger instance with the specified configuration
 */
export function createLogger(config: LoggingConfig, serviceName = 'bridge'): winston.Logger {
  const isPretty = config.format === 'pretty';

  const baseFormat = combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }), errors({ stack: true }));

  const formats = isPretty
    ? combine(baseFormat, colorize(), prettyFormat)
    : combine(baseFormat, json());

  const logger = winston.createLogger({
    level: config.level,
    defaultMeta: { service: serviceName },
    format: formats,
    transports: [new winston.transports.Console()],
    exitOnError: false,
  });

  return logger;
}

/**
 * Global logger instance - initialized after config is loaded
 */
let _logger: winston.Logger | null = null;

/**
 * Initialize the global logger with configuration
 */
export function initLogger(config: LoggingConfig): winston.Logger {
  _logger = createLogger(config);
  return _logger;
}

/**
 * Get the global logger instance
 * Falls back to a default console logger if not initialized
 */
export function getLogger(): winston.Logger {
  if (_logger === null) {
    // Create a default logger for early-stage logging
    _logger = createLogger({ level: 'info', format: 'pretty' });
    _logger.warn('Logger used before initialization, using defaults');
  }
  return _logger;
}

/**
 * Create a child logger with additional metadata
 */
export function createChildLogger(
  metadata: Record<string, unknown>,
  parent?: winston.Logger
): winston.Logger {
  const baseLogger = parent ?? getLogger();
  return baseLogger.child(metadata);
}

/**
 * Create a request-scoped logger with a request ID
 */
export function createRequestLogger(requestId: string, parent?: winston.Logger): winston.Logger {
  return createChildLogger({ requestId }, parent);
}

/**
 * Log helper for Matrix-related operations
 */
export function matrixLogger(): winston.Logger {
  return createChildLogger({ component: 'matrix' });
}

/**
 * Log helper for ActivityPub-related operations
 */
export function activityPubLogger(): winston.Logger {
  return createChildLogger({ component: 'activitypub' });
}

/**
 * Log helper for database operations
 */
export function dbLogger(): winston.Logger {
  return createChildLogger({ component: 'database' });
}

/**
 * Log helper for queue operations
 */
export function queueLogger(): winston.Logger {
  return createChildLogger({ component: 'queue' });
}

/**
 * Log helper for bridge operations
 */
export function bridgeLogger(): winston.Logger {
  return createChildLogger({ component: 'bridge' });
}

/**
 * Reset logger (primarily for testing)
 */
export function resetLogger(): void {
  _logger = null;
}
