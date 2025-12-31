import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';

/**
 * Prometheus metrics registry
 */
export const metricsRegistry = new Registry();

// Collect default Node.js metrics
collectDefaultMetrics({ register: metricsRegistry });

/**
 * Message counters
 */
export const messagesTotal = new Counter({
  name: 'bridge_messages_total',
  help: 'Total number of messages processed',
  labelNames: ['direction', 'status', 'type'] as const,
  registers: [metricsRegistry],
});

/**
 * Message processing latency
 */
export const messageLatency = new Histogram({
  name: 'bridge_message_latency_seconds',
  help: 'Message processing latency in seconds',
  labelNames: ['direction', 'type'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

/**
 * User counts
 */
export const usersTotal = new Gauge({
  name: 'bridge_users_total',
  help: 'Total number of users',
  labelNames: ['type'] as const,
  registers: [metricsRegistry],
});

/**
 * Room counts
 */
export const roomsTotal = new Gauge({
  name: 'bridge_rooms_total',
  help: 'Total number of bridged rooms',
  labelNames: ['type'] as const,
  registers: [metricsRegistry],
});

/**
 * Queue depth
 */
export const queueDepth = new Gauge({
  name: 'bridge_queue_depth',
  help: 'Current queue depth',
  labelNames: ['queue'] as const,
  registers: [metricsRegistry],
});

/**
 * Delivery failures
 */
export const deliveryFailuresTotal = new Counter({
  name: 'bridge_delivery_failures_total',
  help: 'Total number of delivery failures',
  labelNames: ['instance', 'reason'] as const,
  registers: [metricsRegistry],
});

/**
 * HTTP request counters
 */
export const httpRequestsTotal = new Counter({
  name: 'bridge_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status'] as const,
  registers: [metricsRegistry],
});

/**
 * HTTP request latency
 */
export const httpRequestLatency = new Histogram({
  name: 'bridge_http_request_latency_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'path'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

/**
 * Federation health
 */
export const federationHealth = new Gauge({
  name: 'bridge_federation_health',
  help: 'Federation health status (1 = healthy, 0 = unhealthy)',
  labelNames: ['instance'] as const,
  registers: [metricsRegistry],
});

/**
 * Circuit breaker status
 */
export const circuitBreakerStatus = new Gauge({
  name: 'bridge_circuit_breaker_status',
  help: 'Circuit breaker status (1 = open, 0 = closed)',
  labelNames: ['instance'] as const,
  registers: [metricsRegistry],
});

/**
 * Active connections
 */
export const activeConnections = new Gauge({
  name: 'bridge_active_connections',
  help: 'Number of active connections',
  labelNames: ['type'] as const,
  registers: [metricsRegistry],
});

/**
 * Cache metrics
 */
export const cacheHits = new Counter({
  name: 'bridge_cache_hits_total',
  help: 'Total number of cache hits',
  labelNames: ['cache'] as const,
  registers: [metricsRegistry],
});

export const cacheMisses = new Counter({
  name: 'bridge_cache_misses_total',
  help: 'Total number of cache misses',
  labelNames: ['cache'] as const,
  registers: [metricsRegistry],
});

/**
 * Helper to record message metrics
 */
export function recordMessage(
  direction: 'matrix_to_ap' | 'ap_to_matrix',
  status: 'success' | 'error',
  type: string,
  durationMs: number
): void {
  messagesTotal.inc({ direction, status, type });
  messageLatency.observe({ direction, type }, durationMs / 1000);
}

/**
 * Helper to record HTTP request metrics
 */
export function recordHttpRequest(
  method: string,
  path: string,
  status: number,
  durationMs: number
): void {
  // Normalize path to avoid high cardinality
  const normalizedPath = normalizePath(path);
  httpRequestsTotal.inc({ method, path: normalizedPath, status: String(status) });
  httpRequestLatency.observe({ method, path: normalizedPath }, durationMs / 1000);
}

/**
 * Normalize paths to reduce cardinality
 */
function normalizePath(path: string): string {
  return path
    .replace(/\/users\/[^/]+/g, '/users/:username')
    .replace(/\/activities\/[^/]+/g, '/activities/:id')
    .replace(/\/objects\/[^/]+/g, '/objects/:id')
    .replace(/\/media\/[^/]+\/[^/]+/g, '/media/:server/:id')
    .replace(/\/transactions\/[^/]+/g, '/transactions/:txnId');
}

/**
 * Helper to record delivery failure
 */
export function recordDeliveryFailure(instance: string, reason: string): void {
  deliveryFailuresTotal.inc({ instance, reason });
}

/**
 * Update user counts from database
 */
export async function updateUserMetrics(
  total: number,
  puppets: number,
  doublePuppets: number
): Promise<void> {
  usersTotal.set({ type: 'total' }, total);
  usersTotal.set({ type: 'puppet' }, puppets);
  usersTotal.set({ type: 'double_puppet' }, doublePuppets);
}

/**
 * Update room counts from database
 */
export async function updateRoomMetrics(
  total: number,
  dm: number,
  group: number,
  publicCount: number
): Promise<void> {
  roomsTotal.set({ type: 'total' }, total);
  roomsTotal.set({ type: 'dm' }, dm);
  roomsTotal.set({ type: 'group' }, group);
  roomsTotal.set({ type: 'public' }, publicCount);
}

/**
 * Update queue depth metrics
 */
export function updateQueueDepth(queue: string, depth: number): void {
  queueDepth.set({ queue }, depth);
}

/**
 * Get metrics as string for /metrics endpoint
 */
export async function getMetrics(): Promise<string> {
  return metricsRegistry.metrics();
}

/**
 * Get metrics content type
 */
export function getMetricsContentType(): string {
  return metricsRegistry.contentType;
}
