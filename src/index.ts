import { loadConfig, validateEnvVars, type Config } from './config/index.js';
import { initLogger, getLogger, resetLogger } from './utils/logger.js';
import { initDatabase, closeDatabase, checkConnection } from './db/index.js';

/**
 * Application state for graceful shutdown
 */
interface AppState {
  isShuttingDown: boolean;
  config: Config | null;
}

const state: AppState = {
  isShuttingDown: false,
  config: null,
};

/**
 * Graceful shutdown handler
 */
async function shutdown(signal: string): Promise<void> {
  const logger = getLogger();

  if (state.isShuttingDown) {
    logger.warn('Shutdown already in progress, ignoring signal', { signal });
    return;
  }

  state.isShuttingDown = true;
  logger.info('Received shutdown signal, starting graceful shutdown...', { signal });

  try {
    // Close database connections
    logger.info('Closing database connections...');
    await closeDatabase();

    // TODO: Close Redis connections
    // TODO: Stop queue workers
    // TODO: Stop HTTP servers

    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error });
    process.exit(1);
  }
}

/**
 * Health check function
 */
export async function healthCheck(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: Record<string, boolean>;
}> {
  const checks: Record<string, boolean> = {};

  // Check database connectivity
  checks['database'] = await checkConnection();

  // TODO: Check Redis connectivity
  // TODO: Check Matrix homeserver connectivity

  const allHealthy = Object.values(checks).every(Boolean);
  const anyHealthy = Object.values(checks).some(Boolean);

  return {
    status: allHealthy ? 'healthy' : anyHealthy ? 'degraded' : 'unhealthy',
    checks,
  };
}

/**
 * Main application startup
 */
async function main(): Promise<void> {
  // Validate environment variables before loading config
  const missingVars = validateEnvVars();
  if (missingVars.length > 0) {
    console.error('Missing required environment variables:');
    missingVars.forEach((v) => console.error(`  - ${v}`));
    console.error('\nSee .env.example for required configuration.');
    process.exit(1);
  }

  // Load and validate configuration
  try {
    state.config = loadConfig();
  } catch (error) {
    console.error('Failed to load configuration:', error);
    process.exit(1);
  }

  // Initialize logging
  initLogger(state.config.logging);
  const logger = getLogger();

  logger.info('Starting Matrix-ActivityPub Bridge...', {
    nodeEnv: state.config.nodeEnv,
    matrixDomain: state.config.matrix.domain,
    apDomain: state.config.activityPub.domain,
  });

  // Register shutdown handlers
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack });
    void shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason });
    void shutdown('unhandledRejection');
  });

  try {
    // Initialize database
    logger.info('Initializing database connection...');
    initDatabase(state.config.database);

    // Verify database connectivity
    const dbConnected = await checkConnection();
    if (!dbConnected) {
      throw new Error('Failed to connect to database');
    }
    logger.info('Database connection established');

    // TODO: Initialize Redis connection
    // TODO: Initialize message queues
    // TODO: Initialize Matrix appservice
    // TODO: Initialize ActivityPub server

    // Perform initial health check
    const health = await healthCheck();
    logger.info('Initial health check', { status: health.status, checks: health.checks });

    if (health.status === 'unhealthy') {
      throw new Error('Initial health check failed');
    }

    logger.info('Matrix-ActivityPub Bridge started successfully', {
      matrixAppservicePort: state.config.matrix.appservicePort,
      apPort: state.config.activityPub.port,
    });
  } catch (error) {
    logger.error('Failed to start bridge', { error });
    await closeDatabase();
    resetLogger();
    process.exit(1);
  }
}

// Start the application
main().catch((error: unknown) => {
  console.error('Fatal error during startup:', error);
  process.exit(1);
});
