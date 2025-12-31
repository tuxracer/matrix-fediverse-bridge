import { z } from 'zod';

/**
 * Matrix homeserver and appservice configuration
 */
const matrixConfigSchema = z.object({
  homeserverUrl: z.string().url(),
  domain: z.string().min(1),
  appserviceToken: z.string().min(1),
  homeserverToken: z.string().min(1),
  appservicePort: z.coerce.number().int().min(1).max(65535).default(9000),
  senderLocalpart: z.string().default('apbot'),
});

export type MatrixConfig = z.infer<typeof matrixConfigSchema>;

/**
 * ActivityPub server configuration
 */
const activityPubConfigSchema = z.object({
  domain: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(443),
  privateKeyPath: z.string().optional(),
});

export type ActivityPubConfig = z.infer<typeof activityPubConfigSchema>;

/**
 * PostgreSQL database configuration
 */
const databaseConfigSchema = z.object({
  url: z.string().url().startsWith('postgresql://'),
  poolMin: z.coerce.number().int().min(0).default(2),
  poolMax: z.coerce.number().int().min(1).default(10),
  idleTimeoutMs: z.coerce.number().int().min(0).default(30000),
  connectionTimeoutMs: z.coerce.number().int().min(0).default(5000),
});

export type DatabaseConfig = z.infer<typeof databaseConfigSchema>;

/**
 * Redis configuration
 */
const redisConfigSchema = z.object({
  url: z.string().url().startsWith('redis://'),
  maxRetriesPerRequest: z.coerce.number().int().min(0).default(3),
});

export type RedisConfig = z.infer<typeof redisConfigSchema>;

/**
 * Security configuration
 */
const securityConfigSchema = z.object({
  encryptionKey: z
    .string()
    .length(64)
    .regex(/^[0-9a-fA-F]+$/, 'Must be a 64-character hex string'),
  blockedInstances: z
    .string()
    .default('')
    .transform((val) => (val ? val.split(',').map((s) => s.trim()) : [])),
  rateLimitPerMinute: z.coerce.number().int().min(1).default(100),
});

export type SecurityConfig = z.infer<typeof securityConfigSchema>;

/**
 * Logging configuration
 */
const loggingConfigSchema = z.object({
  level: z.enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']).default('info'),
  format: z.enum(['json', 'pretty']).default('json'),
});

export type LoggingConfig = z.infer<typeof loggingConfigSchema>;

/**
 * Complete application configuration
 */
const configSchema = z.object({
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
  matrix: matrixConfigSchema,
  activityPub: activityPubConfigSchema,
  database: databaseConfigSchema,
  redis: redisConfigSchema,
  security: securityConfigSchema,
  logging: loggingConfigSchema,
});

export type Config = z.infer<typeof configSchema>;

/**
 * Load and validate configuration from environment variables
 */
export function loadConfig(): Config {
  const env = process.env;

  const rawConfig = {
    nodeEnv: env['NODE_ENV'],
    matrix: {
      homeserverUrl: env['MATRIX_HOMESERVER_URL'],
      domain: env['MATRIX_DOMAIN'],
      appserviceToken: env['MATRIX_APPSERVICE_TOKEN'],
      homeserverToken: env['MATRIX_HOMESERVER_TOKEN'],
      appservicePort: env['MATRIX_APPSERVICE_PORT'],
      senderLocalpart: env['MATRIX_SENDER_LOCALPART'],
    },
    activityPub: {
      domain: env['AP_DOMAIN'],
      port: env['AP_PORT'],
      privateKeyPath: env['AP_PRIVATE_KEY_PATH'],
    },
    database: {
      url: env['DATABASE_URL'],
      poolMin: env['DATABASE_POOL_MIN'],
      poolMax: env['DATABASE_POOL_MAX'],
      idleTimeoutMs: env['DATABASE_IDLE_TIMEOUT_MS'],
      connectionTimeoutMs: env['DATABASE_CONNECTION_TIMEOUT_MS'],
    },
    redis: {
      url: env['REDIS_URL'],
      maxRetriesPerRequest: env['REDIS_MAX_RETRIES'],
    },
    security: {
      encryptionKey: env['ENCRYPTION_KEY'],
      blockedInstances: env['BLOCKED_INSTANCES'],
      rateLimitPerMinute: env['RATE_LIMIT_PER_MINUTE'],
    },
    logging: {
      level: env['LOG_LEVEL'],
      format: env['LOG_FORMAT'],
    },
  };

  const result = configSchema.safeParse(rawConfig);

  if (!result.success) {
    const errors = result.error.issues
      .map((err) => `  - ${String(err.path.join('.'))}: ${err.message}`)
      .join('\n');
    throw new Error(`Configuration validation failed:\n${errors}`);
  }

  return result.data;
}

/**
 * Validate that all required environment variables are set
 * Returns a list of missing variables
 */
export function validateEnvVars(): string[] {
  const required = [
    'MATRIX_HOMESERVER_URL',
    'MATRIX_DOMAIN',
    'MATRIX_APPSERVICE_TOKEN',
    'MATRIX_HOMESERVER_TOKEN',
    'AP_DOMAIN',
    'DATABASE_URL',
    'REDIS_URL',
    'ENCRYPTION_KEY',
  ];

  return required.filter((key) => !process.env[key]);
}

// Singleton config instance
let _config: Config | null = null;

/**
 * Get the configuration singleton. Must call loadConfig() first.
 */
export function getConfig(): Config {
  if (_config === null) {
    _config = loadConfig();
  }
  return _config;
}

/**
 * Reset config (primarily for testing)
 */
export function resetConfig(): void {
  _config = null;
}
