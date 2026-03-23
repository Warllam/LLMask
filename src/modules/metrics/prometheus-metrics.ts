/**
 * Prometheus Metrics Module — Centralized metrics for LLMask/AIDAT
 *
 * Re-exports the shared metrics registry and adds pipeline-specific
 * instrumentation helpers (masking duration, streaming duration, etc.)
 *
 * All metrics use the `llmask_` prefix for Prometheus namespace consistency.
 */

import client from "prom-client";
import { registry } from "../../shared/metrics";

// Re-export everything from shared metrics for backward compat
export {
  registry,
  initializeMetrics,
  exportMetrics,
  resetMetrics,
  updateSystemMetrics,
  incCounter,
  setGauge,
  observeHistogram,
  incrementActiveSessions,
  decrementActiveSessions,
  recordRequestMetrics,
  recordEntityDetection,
  recordEntityMasking,
  recordEntityLeak,
  recordRemap,
  recordRewrite,
  recordFallbackProvider,
  recordHttpRequest,
  recordProviderError,
  recordStreamingChunk,
  recordPayloadBytes,
  setMappingStoreSize,
  recordEntitiesDetected,
  recordEntitiesMasked,
  recordPromptSizeBytes,
  recordResponseSizeBytes,
  recordAlertFired,
  recordUpstreamLatency,
  recordCacheHit,
  recordCacheMiss,
  extractTokenUsage,
  // New enriched metrics
  recordProviderLatency,
  updatePiiMaskingRatio,
  recordMappingCacheHit,
  recordMappingCacheMiss,
  recordRateLimitBlocked,
  recordRateLimitAllowed,
  setRateLimitQuotaRemaining,
  incrementSseConnections,
  decrementSseConnections,
  recordSseEvent,
  updateHealthMetrics,
  startEventLoopLagTracking,
  stopEventLoopLagTracking,
} from "../../shared/metrics";

// ──────────────────────────────────────────────────────────────────
// Additional pipeline metrics (not in shared/metrics.ts)
// ──────────────────────────────────────────────────────────────────

/** Duration of the masking/rewrite phase in seconds */
export const maskingDuration = new client.Histogram({
  name: "llmask_masking_duration_seconds",
  help: "Duration of the PII masking/rewrite phase in seconds",
  labelNames: ["provider", "endpoint"] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [registry],
});

/** Duration of a full streaming response in seconds */
export const streamingDuration = new client.Histogram({
  name: "llmask_streaming_duration_seconds",
  help: "Total duration of streaming responses in seconds",
  labelNames: ["provider", "status"] as const,
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  registers: [registry],
});

/** Duration of the remap (response un-masking) phase in seconds */
export const remapDuration = new client.Histogram({
  name: "llmask_remap_duration_seconds",
  help: "Duration of the response remap/un-masking phase in seconds",
  labelNames: ["provider", "streaming"] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [registry],
});

/** PII detections by type (more granular than shared pii_detected) */
export const piiDetectionsByType = new client.Counter({
  name: "llmask_pii_detections_by_type_total",
  help: "PII detections broken down by pii_type and provider",
  labelNames: ["pii_type", "provider"] as const,
  registers: [registry],
});

/** Alerts by level */
export const alertsByLevel = new client.Counter({
  name: "llmask_alerts_by_level_total",
  help: "Alerts fired broken down by alert_level and rule",
  labelNames: ["alert_level", "rule"] as const,
  registers: [registry],
});

/** Detection engine duration */
export const detectionDuration = new client.Histogram({
  name: "llmask_detection_duration_seconds",
  help: "Duration of the PII detection phase in seconds",
  labelNames: ["provider"] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [registry],
});

/** Pipeline total duration (detection + masking + upstream + remap) */
export const pipelineDuration = new client.Histogram({
  name: "llmask_pipeline_duration_seconds",
  help: "Total proxy pipeline duration in seconds (detection + masking + upstream + remap)",
  labelNames: ["provider", "endpoint", "status"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [registry],
});

// ──────────────────────────────────────────────────────────────────
// Instrumentation helpers
// ──────────────────────────────────────────────────────────────────

/** Record masking phase duration */
export function recordMaskingDuration(provider: string, endpoint: string, durationSec: number): void {
  maskingDuration.observe({ provider, endpoint }, durationSec);
}

/** Record streaming response duration */
export function recordStreamingDuration(provider: string, status: string, durationSec: number): void {
  streamingDuration.observe({ provider, status }, durationSec);
}

/** Record remap phase duration */
export function recordRemapDuration(provider: string, streaming: boolean, durationSec: number): void {
  remapDuration.observe({ provider, streaming: String(streaming) }, durationSec);
}

/** Record PII detections by type for a given provider */
export function recordPiiDetectionsByType(
  findings: Array<{ category: string }>,
  provider: string,
): void {
  for (const f of findings) {
    piiDetectionsByType.inc({ pii_type: f.category || "unknown", provider });
  }
}

/** Record alert by level */
export function recordAlertByLevel(level: string, rule: string): void {
  alertsByLevel.inc({ alert_level: level, rule });
}

/** Record detection phase duration */
export function recordDetectionDuration(provider: string, durationSec: number): void {
  detectionDuration.observe({ provider }, durationSec);
}

/** Record full pipeline duration */
export function recordPipelineDuration(
  provider: string,
  endpoint: string,
  status: string,
  durationSec: number,
): void {
  pipelineDuration.observe({ provider, endpoint, status }, durationSec);
}

/**
 * Timer helper — returns a function that, when called, returns elapsed seconds.
 */
export function startTimer(): () => number {
  const start = process.hrtime.bigint();
  return () => Number(process.hrtime.bigint() - start) / 1e9;
}
