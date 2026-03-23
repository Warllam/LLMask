import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  registry,
  resetMetrics,
  exportMetrics,
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
} from "../../src/shared/metrics";

describe("Enriched Prometheus metrics", () => {
  beforeEach(() => {
    resetMetrics();
  });

  afterEach(() => {
    stopEventLoopLagTracking();
  });

  // ── Provider Latency ──────────────────────────────────────────

  it("records provider latency with provider/model/endpoint labels", async () => {
    recordProviderLatency("openai", "gpt-4o", "chat-completions", 1.23);
    recordProviderLatency("anthropic", "claude-3", "messages", 0.85);
    const text = await exportMetrics();
    expect(text).toContain("llmask_provider_latency_seconds");
    expect(text).toContain('provider="openai"');
    expect(text).toContain('model="gpt-4o"');
    expect(text).toContain('endpoint="chat-completions"');
    expect(text).toContain('provider="anthropic"');
    expect(text).toContain('model="claude-3"');
  });

  // ── PII Masking Ratio ─────────────────────────────────────────

  it("updates PII masking ratio", async () => {
    updatePiiMaskingRatio(100, 95);
    const text = await exportMetrics();
    expect(text).toContain("llmask_pii_masking_ratio");
    expect(text).toContain("0.95");
  });

  it("does not update ratio when detected is zero", async () => {
    updatePiiMaskingRatio(0, 0);
    const text = await exportMetrics();
    // Gauge exists but value should be 0 (default)
    expect(text).toContain("llmask_pii_masking_ratio 0");
  });

  // ── Mapping Cache ─────────────────────────────────────────────

  it("records mapping cache hits with operation label", async () => {
    recordMappingCacheHit("lookup");
    recordMappingCacheHit("reverse");
    recordMappingCacheHit(); // default "lookup"
    const text = await exportMetrics();
    expect(text).toContain("llmask_mapping_cache_hits_total");
    expect(text).toContain('operation="lookup"');
    expect(text).toContain('operation="reverse"');
  });

  it("records mapping cache misses", async () => {
    recordMappingCacheMiss("lookup");
    const text = await exportMetrics();
    expect(text).toContain("llmask_mapping_cache_misses_total");
    expect(text).toContain('operation="lookup"');
  });

  // ── Rate Limiting ─────────────────────────────────────────────

  it("records rate limit blocked requests", async () => {
    recordRateLimitBlocked("ip", "/v1/chat/completions");
    recordRateLimitBlocked("apikey", "/v1/chat/completions");
    const text = await exportMetrics();
    expect(text).toContain("llmask_rate_limit_blocked_total");
    expect(text).toContain('key_type="ip"');
    expect(text).toContain('key_type="apikey"');
  });

  it("records rate limit allowed requests", async () => {
    recordRateLimitAllowed("ip", "/health");
    const text = await exportMetrics();
    expect(text).toContain("llmask_rate_limit_allowed_total");
    expect(text).toContain('key_type="ip"');
  });

  it("sets rate limit quota remaining", async () => {
    setRateLimitQuotaRemaining("ip:192.168.1.1", 42);
    const text = await exportMetrics();
    expect(text).toContain("llmask_rate_limit_quota_remaining");
    expect(text).toContain("42");
  });

  // ── SSE / Dashboard ───────────────────────────────────────────

  it("tracks SSE active connections", async () => {
    incrementSseConnections();
    incrementSseConnections();
    decrementSseConnections();
    const text = await exportMetrics();
    expect(text).toContain("llmask_sse_active_connections 1");
  });

  it("records SSE events by type", async () => {
    recordSseEvent("masking");
    recordSseEvent("masking");
    recordSseEvent("alert");
    const text = await exportMetrics();
    expect(text).toContain("llmask_sse_events_total");
    expect(text).toContain('event_type="masking"');
    expect(text).toContain('event_type="alert"');
  });

  // ── Health Check ──────────────────────────────────────────────

  it("updates health metrics (memory, uptime)", async () => {
    updateHealthMetrics();
    const text = await exportMetrics();
    expect(text).toContain("llmask_health_memory_heap_used_bytes");
    expect(text).toContain("llmask_health_memory_heap_total_bytes");
    expect(text).toContain("llmask_health_memory_rss_bytes");
    expect(text).toContain("llmask_health_memory_external_bytes");
    expect(text).toContain("llmask_uptime_seconds");

    // Values should be > 0
    const heapMatch = text.match(/llmask_health_memory_heap_used_bytes (\d+)/);
    expect(heapMatch).toBeTruthy();
    expect(Number(heapMatch![1])).toBeGreaterThan(0);
  });

  it("tracks event loop lag", async () => {
    startEventLoopLagTracking(50); // fast interval for test
    // Wait enough for at least one tick
    await new Promise((r) => setTimeout(r, 150));
    const text = await exportMetrics();
    expect(text).toContain("llmask_health_event_loop_lag_seconds");
    expect(text).toContain("llmask_health_event_loop_lag_histogram_seconds");
    stopEventLoopLagTracking();
  });

  // ── All new metrics in export ─────────────────────────────────

  it("exports all new metric families", async () => {
    // Trigger all metrics
    recordProviderLatency("test", "test", "test", 0.1);
    updatePiiMaskingRatio(10, 9);
    recordMappingCacheHit();
    recordMappingCacheMiss();
    recordRateLimitBlocked("ip", "/test");
    recordRateLimitAllowed("ip", "/test");
    setRateLimitQuotaRemaining("test", 5);
    incrementSseConnections();
    recordSseEvent("test");
    updateHealthMetrics();

    const text = await exportMetrics();
    const expected = [
      "llmask_provider_latency_seconds",
      "llmask_pii_masking_ratio",
      "llmask_mapping_cache_hits_total",
      "llmask_mapping_cache_misses_total",
      "llmask_rate_limit_blocked_total",
      "llmask_rate_limit_allowed_total",
      "llmask_rate_limit_quota_remaining",
      "llmask_sse_active_connections",
      "llmask_sse_events_total",
      "llmask_health_memory_heap_used_bytes",
      "llmask_health_memory_heap_total_bytes",
      "llmask_health_memory_rss_bytes",
      "llmask_health_memory_external_bytes",
      "llmask_health_event_loop_lag_seconds",
      "llmask_health_event_loop_lag_histogram_seconds",
    ];
    for (const name of expected) {
      expect(text).toContain(`# HELP ${name}`);
      expect(text).toContain(`# TYPE ${name}`);
    }
  });
});
