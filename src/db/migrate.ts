import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { loadConfig } from '../config/index.js';
import { initLogger, getLogger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

interface Migration {
  id: number;
  name: string;
  filename: string;
}

/**
 * Ensure the migrations tracking table exists
 */
async function ensureMigrationsTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

/**
 * Get list of applied migrations
 */
async function getAppliedMigrations(client: pg.PoolClient): Promise<string[]> {
  const result = await client.query<{ name: string }>(
    'SELECT name FROM schema_migrations ORDER BY id'
  );
  return result.rows.map((row) => row.name);
}

/**
 * Get list of pending migrations from the filesystem
 */
async function getPendingMigrations(appliedMigrations: string[]): Promise<Migration[]> {
  const files = await readdir(MIGRATIONS_DIR);

  const migrations = files
    .filter((file) => file.endsWith('.sql'))
    .map((filename) => {
      const match = filename.match(/^(\d+)_(.+)\.sql$/);
      if (!match?.[1] || !match[2]) {
        throw new Error(`Invalid migration filename: ${filename}`);
      }
      return {
        id: parseInt(match[1], 10),
        name: filename.replace('.sql', ''),
        filename,
      };
    })
    .filter((m) => !appliedMigrations.includes(m.name))
    .sort((a, b) => a.id - b.id);

  return migrations;
}

/**
 * Run a single migration
 */
async function runMigration(client: pg.PoolClient, migration: Migration): Promise<void> {
  const logger = getLogger();
  const filePath = join(MIGRATIONS_DIR, migration.filename);
  const sql = await readFile(filePath, 'utf-8');

  logger.info(`Running migration: ${migration.name}`);

  await client.query('BEGIN');

  try {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
    await client.query('COMMIT');
    logger.info(`Migration completed: ${migration.name}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/**
 * Run all pending migrations
 */
async function migrateUp(): Promise<void> {
  const config = loadConfig();
  initLogger(config.logging);
  const logger = getLogger();

  const pool = new pg.Pool({ connectionString: config.database.url });
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);
    const pending = await getPendingMigrations(applied);

    if (pending.length === 0) {
      logger.info('No pending migrations');
      return;
    }

    logger.info(`Found ${String(pending.length)} pending migration(s)`);

    for (const migration of pending) {
      await runMigration(client, migration);
    }

    logger.info('All migrations completed successfully');
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Rollback the last migration
 */
async function migrateDown(): Promise<void> {
  const config = loadConfig();
  initLogger(config.logging);
  const logger = getLogger();

  const pool = new pg.Pool({ connectionString: config.database.url });
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);

    if (applied.length === 0) {
      logger.info('No migrations to rollback');
      return;
    }

    const lastMigration = applied[applied.length - 1];
    if (!lastMigration) {
      logger.info('No migrations to rollback');
      return;
    }

    // Check for down migration file
    const downFilename = `${lastMigration}_down.sql`;
    const downFilePath = join(MIGRATIONS_DIR, downFilename);

    try {
      const sql = await readFile(downFilePath, 'utf-8');

      logger.info(`Rolling back migration: ${lastMigration}`);

      await client.query('BEGIN');
      await client.query(sql);
      await client.query('DELETE FROM schema_migrations WHERE name = $1', [lastMigration]);
      await client.query('COMMIT');

      logger.info(`Rollback completed: ${lastMigration}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.error(`No down migration found: ${downFilename}`);
        throw new Error(`Down migration file not found: ${downFilename}`);
      }
      throw error;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

// CLI entry point
const command = process.argv[2];

if (command === 'down') {
  migrateDown().catch((error: unknown) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
} else {
  migrateUp().catch((error: unknown) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
}
