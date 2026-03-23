/**
 * Prometheus metrics powered by prom-client
 * Drop-in replacement for the previous lightweight registry
 */

import client from "prom-client";

export type Labels = Record<string, string>;

// ──────────────────────────────────────────────────────────────────
// Registry & default metrics
// ──────────────────────────────────────────────────────────────────

export const registry = new client.Registry();

// Collect default Node.js metrics (memory, CPU, event loop, GC, etc.)
client.collectDefaultMetrics({ register: registry, prefix: "llmask_nodejs_" });

// ──────────────────────────────────────────────────────────────────
// Business metrics
// ──────────────────────────────────────────────────────────────────

const requestsTotal = new client.Counter({
  name: "llmask_requests_total",
  help: "Total number of requests by provider, model, and status",
  labelNames: ["provider", "model", "status"] as const,
  registers: [registry],
});

const requestDuration = new client.Histogram({
  name: "llmask_request_duration_seconds",
  help: "Request latency in seconds",
  labelNames: ["route", "method", "status"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [registry],
});

const httpRequestsTotal = new client.Counter({
  name: "llmask_http_requests_total",
  help: "Total HTTP requests by method, route and status",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});

const httpErrorsTotal = new client.Counter({
  name: "llmask_http_errors_total",
  help: "Total HTTP errors by class (4xx/5xx), method and route",
  labelNames: ["method", "route", "status_class"] as const,
  registers: [registry],
});

const tokensInput = new client.Counter({
  name: "llmask_tokens_input_total",
  help: "Total input tokens processed",
  labelNames: ["provider", "model"] as const,
  registers: [registry],
});

const tokensOutput = new client.Counter({
  name: "llmask_tokens_output_total",
  help: "Total output tokens generated",
  labelNames: ["provider", "model"] as const,
  registers: [registry],
});

const piiDetected = new client.Counter({
  name: "llmask_pii_detected_total",
  help: "Total PII entities detected by type",
  labelNames: ["type"] as const,
  registers: [registry],
});

const piiMasked = new client.Counter({
  name: "llmask_pii_masked_total",
  help: "Total PII entities masked by type",
  labelNames: ["type"] as const,
  registers: [registry],
});

const piiLeaked = new client.Counter({
  name: "llmask_pii_leaked_total",
  help: "Total PII entities that leaked (not masked)",
  registers: [registry],
});

const activeConnections = new client.Gauge({
  name: "llmask_active_connections",
  help: "Number of active connections",
  registers: [registry],
});

const mappingStoreSize = new client.Gauge({
  name: "llmask_mapping_store_size",
  help: "Number of entries in the mapping store",
  registers: [registry],
});

const providerErrors = new client.Counter({
  name: "llmask_provider_errors_total",
  help: "Total provider errors by provider and error type",
  labelNames: ["provider", "error_type"] as const,
  registers: [registry],
});

const streamingChunks = new client.Counter({
  name: "llmask_streaming_chunks_total",
  help: "Total streaming chunks processed",
  registers: [registry],
});

const requestPayloadBytes = new client.Histogram({
  name: "llmask_request_payload_bytes",
  help: "Request payload size in bytes",
  buckets: [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
  registers: [registry],
});

const remapsTotal = new client.Counter({
  name: "llmask_remaps_total",
  help: "Total inverse remaps performed",
  registers: [registry],
});

const rewritesTotal = new client.Counter({
  name: "llmask_rewrites_total",
  help: "Total rewrite operations executed on incoming payloads",
  registers: [registry],
});

const fallbackProviderTotal = new client.Counter({
  name: "llmask_fallback_provider_total",
  help: "Total fallback provider activations",
  labelNames: ["from_provider", "to_provider"] as const,
  registers: [registry],
});

const uptimeGauge = new client.Gauge({
  name: "llmask_uptime_seconds",
  help: "Server uptime in seconds",
  registers: [registry],
});

// ──────────────────────────────────────────────────────────────────
// Additional metrics (entities, alerts, latency, cache, sizes)
// ──────────────────────────────────────────────────────────────────

const entitiesDetectedTotal = new client.Counter({
  name: "llmask_entities_detected_total",
  help: "Total entities detected by type and severity",
  labelNames: ["entity_type", "severity"] as const,
  registers: [registry],
});

const entitiesMaskedTotal = new client.Counter({
  name: "llmask_entities_masked_total",
  help: "Total entities masked by type",
  labelNames: ["entity_type"] as const,
  registers: [registry],
});

const promptSizeBytes = new client.Histogram({
  name: "llmask_prompt_size_bytes",
  help: "Prompt size in bytes",
  buckets: [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
  registers: [registry],
});

const responseSizeBytes = new client.Histogram({
  name: "llmask_response_size_bytes",
  help: "Response size in bytes",
  buckets: [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
  registers: [registry],
});

const alertsFiredTotal = new client.Counter({
  name: "llmask_alerts_fired_total",
  help: "Total alerts fired by severity and rule",
  labelNames: ["severity", "rule"] as const,
  registers: [registry],
});

const upstreamLatency = new client.Histogram({
  name: "llmask_upstream_latency_seconds",
  help: "Upstream LLM provider latency in seconds",
  labelNames: ["provider"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [registry],
});

const cacheHitsTotal = new client.Counter({
  name: "llmask_cache_hits_total",
  help: "Total cache hits",
  registers: [registry],
});

const cacheMissesTotal = new client.Counter({
  name: "llmask_cache_misses_total",
  help: "Total cache misses",
  registers: [registry],
});

// ──────────────────────────────────────────────────────────────────
// Provider latency (histogram with provider/model/endpoint labels)
// ──────────────────────────────────────────────────────────────────

const providerLatency = new client.Histogram({
  name: "llmask_provider_latency_seconds",
  help: "LLM provider latency in seconds by provider, model and endpoint",
  labelNames: ["provider", "model", "endpoint"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [registry],
});

// ──────────────────────────────────────────────────────────────────
// PII masking ratio
// ──────────────────────────────────────────────────────────────────

const piiMaskingRatio = new client.Gauge({
  name: "llmask_pii_masking_ratio",
  help: "Ratio of masked PII entities vs detected (1.0 = all masked)",
  registers: [registry],
});

// ──────────────────────────────────────────────────────────────────
// Mapping store cache metrics (with operation label)
// ──────────────────────────────────────────────────────────────────

const mappingCacheHits = new client.Counter({
  name: "llmask_mapping_cache_hits_total",
  help: "Mapping store cache hits by operation",
  labelNames: ["operation"] as const,
  registers: [registry],
});

const mappingCacheMisses = new client.Counter({
  name: "llmask_mapping_cache_misses_total",
  help: "Mapping store cache misses by operation",
  labelNames: ["operation"] as const,
  registers: [registry],
});

// ──────────────────────────────────────────────────────────────────
// Rate limiting metrics
// ──────────────────────────────────────────────────────────────────

const rateLimitBlocked = new client.Counter({
  name: "llmask_rate_limit_blocked_total",
  help: "Total requests blocked by rate limiter",
  labelNames: ["key_type", "route"] as const,
  registers: [registry],
});

const rateLimitAllowed = new client.Counter({
  name: "llmask_rate_limit_allowed_total",
  help: "Total requests allowed by rate limiter",
  labelNames: ["key_type", "route"] as const,
  registers: [registry],
});

const rateLimitQuotaRemaining = new client.Gauge({
  name: "llmask_rate_limit_quota_remaining",
  help: "Remaining quota for rate-limited keys (sampled)",
  labelNames: ["key"] as const,
  registers: [registry],
});

// ──────────────────────────────────────────────────────────────────
// Dashboard / SSE metrics
// ──────────────────────────────────────────────────────────────────

const sseActiveConnections = new client.Gauge({
  name: "llmask_sse_active_connections",
  help: "Number of active SSE connections to the dashboard",
  registers: [registry],
});

const sseEventsTotal = new client.Counter({
  name: "llmask_sse_events_total",
  help: "Total SSE events sent to dashboard clients",
  labelNames: ["event_type"] as const,
  registers: [registry],
});

// ──────────────────────────────────────────────────────────────────
// Health check detailed metrics
// ──────────────────────────────────────────────────────────────────

const healthMemoryHeapUsed = new client.Gauge({
  name: "llmask_health_memory_heap_used_bytes",
  help: "Heap memory used in bytes",
  registers: [registry],
});

const healthMemoryHeapTotal = new client.Gauge({
  name: "llmask_health_memory_heap_total_bytes",
  help: "Total heap memory in bytes",
  registers: [registry],
});

const healthMemoryRss = new client.Gauge({
  name: "llmask_health_memory_rss_bytes",
  help: "Resident set size in bytes",
  registers: [registry],
});

const healthMemoryExternal = new client.Gauge({
  name: "llmask_health_memory_external_bytes",
  help: "External memory used by V8 in bytes",
  registers: [registry],
});

const healthEventLoopLag = new client.Gauge({
  name: "llmask_health_event_loop_lag_seconds",
  help: "Event loop lag in seconds",
  registers: [registry],
});

const healthEventLoopLagHistogram = new client.Histogram({
  name: "llmask_health_event_loop_lag_histogram_seconds",
  help: "Event loop lag distribution in seconds",
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [registry],
});

// Legacy aliases kept for backward compat with existing code
const entitiesDetected = piiDetected;
const entitiesMasked = piiMasked;
const entitiesLeaked = piiLeaked;
const activeSessions = activeConnections;

// ──────────────────────────────────────────────────────────────────
// Initialization (no-op now since metrics are created at import time,
// but kept for backward compat)
// ──────────────────────────────────────────────────────────────────

export function initializeMetrics(): void {
  // Metrics are already registered at module load. This is a no-op.
}

// ──────────────────────────────────────────────────────────────────
// Low-level helpers (backward compat)
// ──────────────────────────────────────────────────────────────────

export function incCounter(name: string, labels?: Labels, delta = 1): void {
  const metric = registry.getSingleMetric(name);
  if (metric && metric instanceof client.Counter) {
    metric.inc(labels ?? {}, delta);
  }
}

export function setGauge(name: string, labels: Labels | undefined, value: number): void {
  const metric = registry.getSingleMetric(name);
  if (metric && metric instanceof client.Gauge) {
    metric.set(labels ?? {}, value);
  }
}

export function observeHistogram(name: string, labels: Labels | undefined, value: number): void {
  const metric = registry.getSingleMetric(name);
  if (metric && metric instanceof client.Histogram) {
    metric.observe(labels ?? {}, value);
  }
}

export async function exportMetrics(): Promise<string> {
  // Update uptime and health metrics before export
  updateHealthMetrics();
  return registry.metrics();
}

export function resetMetrics(): void {
  registry.resetMetrics();
}

// ──────────────────────────────────────────────────────────────────
// System metrics (simplified — prom-client default metrics handle most)
// ──────────────────────────────────────────────────────────────────

export function updateSystemMetrics(): void {
  uptimeGauge.set(Math.floor(process.uptime()));
}

// ──────────────────────────────────────────────────────────────────
// Active sessions tracker
// ──────────────────────────────────────────────────────────────────

export function incrementActiveSessions(): void {
  activeConnections.inc();
}

export function decrementActiveSessions(): void {
  activeConnections.dec();
}

// ──────────────────────────────────────────────────────────────────
// Business metrics helpers
// ──────────────────────────────────────────────────────────────────

export interface RequestMetricsContext {
  provider: string;
  model: string;
  status: string;
  inputTokens?: number;
  outputTokens?: number;
}

export function recordRequestMetrics(ctx: RequestMetricsContext): void {
  requestsTotal.inc({ provider: ctx.provider, model: ctx.model, status: ctx.status });

  if (ctx.inputTokens && ctx.inputTokens > 0) {
    tokensInput.inc({ provider: ctx.provider, model: ctx.model }, ctx.inputTokens);
  }
  if (ctx.outputTokens && ctx.outputTokens > 0) {
    tokensOutput.inc({ provider: ctx.provider, model: ctx.model }, ctx.outputTokens);
  }
}

export function recordEntityDetection(findings: Array<{ category: string }>): void {
  const counts = new Map<string, number>();
  for (const f of findings) {
    const cat = f.category || "unknown";
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  for (const [type, count] of counts) {
    piiDetected.inc({ type }, count);
  }
}

export function recordEntityMasking(transformedCount: number): void {
  if (transformedCount > 0) {
    piiMasked.inc(transformedCount);
  }
}

export function recordEntityLeak(leakCount: number): void {
  if (leakCount > 0) {
    piiLeaked.inc(leakCount);
  }
}

export function recordRemap(): void {
  remapsTotal.inc();
}

export function recordRewrite(): void {
  rewritesTotal.inc();
}

export function recordFallbackProvider(fromProvider: string, toProvider: string): void {
  fallbackProviderTotal.inc({ from_provider: fromProvider, to_provider: toProvider });
}

export function recordHttpRequest(method: string, route: string, status: string): void {
  httpRequestsTotal.inc({ method, route, status });

  if (status.startsWith("4") || status.startsWith("5")) {
    const statusClass = status.startsWith("4") ? "4xx" : "5xx";
    httpErrorsTotal.inc({ method, route, status_class: statusClass });
  }
}

export function recordProviderError(provider: string, errorType: string): void {
  providerErrors.inc({ provider, error_type: errorType });
}

export function recordStreamingChunk(): void {
  streamingChunks.inc();
}

export function recordPayloadBytes(bytes: number): void {
  requestPayloadBytes.observe(bytes);
}

export function setMappingStoreSize(size: number): void {
  mappingStoreSize.set(size);
}

// ──────────────────────────────────────────────────────────────────
// New metrics helpers
// ──────────────────────────────────────────────────────────────────

export function recordEntitiesDetected(entities: Array<{ entityType: string; severity?: string }>): void {
  for (const e of entities) {
    entitiesDetectedTotal.inc({ entity_type: e.entityType, severity: e.severity || "medium" });
  }
}

export function recordEntitiesMasked(entities: Array<{ entityType: string }>): void {
  for (const e of entities) {
    entitiesMaskedTotal.inc({ entity_type: e.entityType });
  }
}

export function recordPromptSizeBytes(bytes: number): void {
  promptSizeBytes.observe(bytes);
}

export function recordResponseSizeBytes(bytes: number): void {
  responseSizeBytes.observe(bytes);
}

export function recordAlertFired(severity: string, rule: string): void {
  alertsFiredTotal.inc({ severity, rule });
}

export function recordUpstreamLatency(provider: string, durationSeconds: number): void {
  upstreamLatency.observe({ provider }, durationSeconds);
}

export function recordCacheHit(): void {
  cacheHitsTotal.inc();
}

export function recordCacheMiss(): void {
  cacheMissesTotal.inc();
}

// ──────────────────────────────────────────────────────────────────
// Provider latency helpers
// ──────────────────────────────────────────────────────────────────

export function recordProviderLatency(provider: string, model: string, endpoint: string, durationSeconds: number): void {
  providerLatency.observe({ provider, model, endpoint }, durationSeconds);
}

// ──────────────────────────────────────────────────────────────────
// PII masking ratio helper
// ──────────────────────────────────────────────────────────────────

export function updatePiiMaskingRatio(detected: number, masked: number): void {
  if (detected > 0) {
    piiMaskingRatio.set(masked / detected);
  }
}

// ──────────────────────────────────────────────────────────────────
// Mapping store cache helpers
// ──────────────────────────────────────────────────────────────────

export function recordMappingCacheHit(operation = "lookup"): void {
  mappingCacheHits.inc({ operation });
}

export function recordMappingCacheMiss(operation = "lookup"): void {
  mappingCacheMisses.inc({ operation });
}

// ──────────────────────────────────────────────────────────────────
// Rate limiting helpers
// ──────────────────────────────────────────────────────────────────

export function recordRateLimitBlocked(keyType: string, route: string): void {
  rateLimitBlocked.inc({ key_type: keyType, route });
}

export function recordRateLimitAllowed(keyType: string, route: string): void {
  rateLimitAllowed.inc({ key_type: keyType, route });
}

export function setRateLimitQuotaRemaining(key: string, remaining: number): void {
  rateLimitQuotaRemaining.set({ key }, remaining);
}

// ──────────────────────────────────────────────────────────────────
// Dashboard / SSE helpers
// ──────────────────────────────────────────────────────────────────

export function incrementSseConnections(): void {
  sseActiveConnections.inc();
}

export function decrementSseConnections(): void {
  sseActiveConnections.dec();
}

export function recordSseEvent(eventType: string): void {
  sseEventsTotal.inc({ event_type: eventType });
}

// ──────────────────────────────────────────────────────────────────
// Health check detailed helpers
// ──────────────────────────────────────────────────────────────────

export function updateHealthMetrics(): void {
  const mem = process.memoryUsage();
  healthMemoryHeapUsed.set(mem.heapUsed);
  healthMemoryHeapTotal.set(mem.heapTotal);
  healthMemoryRss.set(mem.rss);
  healthMemoryExternal.set(mem.external);
  uptimeGauge.set(Math.floor(process.uptime()));
}

let _eventLoopLagTimer: ReturnType<typeof setInterval> | undefined;

export function startEventLoopLagTracking(intervalMs = 1000): void {
  if (_eventLoopLagTimer) return;
  _eventLoopLagTimer = setInterval(() => {
    const start = process.hrtime.bigint();
    setImmediate(() => {
      const lagNs = Number(process.hrtime.bigint() - start);
      const lagSec = lagNs / 1e9;
      healthEventLoopLag.set(lagSec);
      healthEventLoopLagHistogram.observe(lagSec);
    });
  }, intervalMs);
  if (_eventLoopLagTimer.unref) _eventLoopLagTimer.unref();
}

export function stopEventLoopLagTracking(): void {
  if (_eventLoopLagTimer) {
    clearInterval(_eventLoopLagTimer);
    _eventLoopLagTimer = undefined;
  }
}

export function extractTokenUsage(response: unknown): { inputTokens?: number; outputTokens?: number } {
  if (!response || typeof response !== "object") return {};
  const resp = response as Record<string, unknown>;
  const usage = resp.usage as Record<string, unknown> | undefined;
  if (!usage) return {};
  const inputTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined;
  const outputTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : undefined;
  return { inputTokens, outputTokens };
}
