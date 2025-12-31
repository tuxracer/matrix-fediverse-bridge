import pg from 'pg';
import { type DatabaseConfig } from '../config/index.js';
import { dbLogger } from '../utils/logger.js';

const { Pool } = pg;

let _pool: pg.Pool | null = null;

/**
 * Initialize the database connection pool
 */
export function initDatabase(config: DatabaseConfig): pg.Pool {
  const logger = dbLogger();

  if (_pool !== null) {
    logger.warn('Database pool already initialized, returning existing pool');
    return _pool;
  }

  _pool = new Pool({
    connectionString: config.url,
    min: config.poolMin,
    max: config.poolMax,
    idleTimeoutMillis: config.idleTimeoutMs,
    connectionTimeoutMillis: config.connectionTimeoutMs,
  });

  // Log pool events
  _pool.on('connect', () => {
    logger.debug('New database connection established');
  });

  _pool.on('error', (err) => {
    logger.error('Unexpected database pool error', { error: err.message });
  });

  _pool.on('remove', () => {
    logger.debug('Database connection removed from pool');
  });

  logger.info('Database pool initialized', {
    min: config.poolMin,
    max: config.poolMax,
  });

  return _pool;
}

/**
 * Get the database pool. Throws if not initialized.
 */
export function getPool(): pg.Pool {
  if (_pool === null) {
    throw new Error('Database pool not initialized. Call initDatabase() first.');
  }
  return _pool;
}

/**
 * Execute a query using the pool
 */
export async function query<T extends pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  const pool = getPool();
  const start = Date.now();
  const result = await pool.query<T>(text, params);
  const duration = Date.now() - start;

  dbLogger().debug('Query executed', {
    text: text.substring(0, 100),
    duration,
    rows: result.rowCount,
  });

  return result;
}

/**
 * Get a client from the pool for transactions
 */
export async function getClient(): Promise<pg.PoolClient> {
  const pool = getPool();
  return pool.connect();
}

/**
 * Execute a function within a transaction
 */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await getClient();
  const logger = dbLogger();

  try {
    await client.query('BEGIN');
    logger.debug('Transaction started');

    const result = await fn(client);

    await client.query('COMMIT');
    logger.debug('Transaction committed');

    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    logger.debug('Transaction rolled back');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Close the database pool
 */
export async function closeDatabase(): Promise<void> {
  if (_pool !== null) {
    await _pool.end();
    _pool = null;
    dbLogger().info('Database pool closed');
  }
}

/**
 * Check database connectivity
 */
export async function checkConnection(): Promise<boolean> {
  try {
    const pool = getPool();
    const result = await pool.query('SELECT 1 as check');
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Reset pool (for testing)
 */
export function resetPool(): void {
  _pool = null;
}
