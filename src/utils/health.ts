import { type Pool } from 'pg';
import { type Redis } from 'ioredis';
import { bridgeLogger } from './logger.js';

/**
 * Health check status
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Component health check result
 */
export interface ComponentHealth {
  status: HealthStatus;
  latencyMs?: number;
  error?: string;
  details?: Record<string, unknown>;
}

/**
 * Overall health check result
 */
export interface HealthCheckResult {
  status: HealthStatus;
  timestamp: string;
  uptime: number;
  version: string;
  components: {
    database: ComponentHealth;
    redis: ComponentHealth;
    matrix: ComponentHealth;
  };
}

/**
 * Health check configuration
 */
export interface HealthCheckConfig {
  database: Pool;
  redis: Redis;
  matrixHomeserverUrl: string;
  version?: string;
}

/**
 * Health check service
 */
export class HealthChecker {
  private config: HealthCheckConfig;
  private startTime: Date;
  private logger = bridgeLogger();

  constructor(config: HealthCheckConfig) {
    this.config = config;
    this.startTime = new Date();
  }

  /**
   * Run all health checks
   */
  async check(): Promise<HealthCheckResult> {
    const [database, redis, matrix] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkMatrix(),
    ]);

    const components = { database, redis, matrix };
    const status = this.aggregateStatus(components);

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
      version: this.config.version ?? '0.1.0',
      components,
    };
  }

  /**
   * Check database connectivity
   */
  private async checkDatabase(): Promise<ComponentHealth> {
    const start = Date.now();

    try {
      const client = await this.config.database.connect();
      try {
        await client.query('SELECT 1');
        return {
          status: 'healthy',
          latencyMs: Date.now() - start,
        };
      } finally {
        client.release();
      }
    } catch (error) {
      this.logger.error('Database health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        status: 'unhealthy',
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : 'Database connection failed',
      };
    }
  }

  /**
   * Check Redis connectivity
   */
  private async checkRedis(): Promise<ComponentHealth> {
    const start = Date.now();

    try {
      const result = await this.config.redis.ping();
      if (result === 'PONG') {
        return {
          status: 'healthy',
          latencyMs: Date.now() - start,
        };
      }
      return {
        status: 'degraded',
        latencyMs: Date.now() - start,
        error: `Unexpected ping response: ${result}`,
      };
    } catch (error) {
      this.logger.error('Redis health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        status: 'unhealthy',
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : 'Redis connection failed',
      };
    }
  }

  /**
   * Check Matrix homeserver connectivity
   */
  private async checkMatrix(): Promise<ComponentHealth> {
    const start = Date.now();

    try {
      const response = await fetch(`${this.config.matrixHomeserverUrl}/_matrix/client/versions`, {
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const data = (await response.json()) as { versions: string[] };
        return {
          status: 'healthy',
          latencyMs: Date.now() - start,
          details: {
            versions: data.versions,
          },
        };
      }

      return {
        status: 'degraded',
        latencyMs: Date.now() - start,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    } catch (error) {
      this.logger.error('Matrix health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        status: 'unhealthy',
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : 'Matrix homeserver connection failed',
      };
    }
  }

  /**
   * Aggregate component statuses into overall status
   */
  private aggregateStatus(components: Record<string, ComponentHealth>): HealthStatus {
    const statuses = Object.values(components).map((c) => c.status);

    if (statuses.every((s) => s === 'healthy')) {
      return 'healthy';
    }

    if (statuses.some((s) => s === 'unhealthy')) {
      // If database is unhealthy, overall is unhealthy
      if (components['database']?.status === 'unhealthy') {
        return 'unhealthy';
      }
      // Otherwise degraded
      return 'degraded';
    }

    return 'degraded';
  }

  /**
   * Get uptime in seconds
   */
  getUptime(): number {
    return Math.floor((Date.now() - this.startTime.getTime()) / 1000);
  }

  /**
   * Quick liveness check (just checks if service is running)
   */
  async liveness(): Promise<{ alive: boolean }> {
    return { alive: true };
  }

  /**
   * Readiness check (checks if service is ready to accept traffic)
   */
  async readiness(): Promise<{ ready: boolean; reason?: string }> {
    try {
      // Just check database since it's critical
      const dbHealth = await this.checkDatabase();
      if (dbHealth.status === 'unhealthy') {
        return { ready: false, reason: 'Database unavailable' };
      }
      return { ready: true };
    } catch (error) {
      return {
        ready: false,
        reason: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

/**
 * Shared health checker instance
 */
let sharedHealthChecker: HealthChecker | null = null;

export function initHealthChecker(config: HealthCheckConfig): HealthChecker {
  sharedHealthChecker = new HealthChecker(config);
  return sharedHealthChecker;
}

export function getHealthChecker(): HealthChecker | null {
  return sharedHealthChecker;
}
