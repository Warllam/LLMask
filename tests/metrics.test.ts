import { describe, it, expect, beforeEach } from "vitest";
import {
  registry,
  resetMetrics,
  exportMetrics,
  initializeMetrics,
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
  incrementActiveSessions,
  decrementActiveSessions,
  recordEntitiesDetected,
  recordEntitiesMasked,
  recordPromptSizeBytes,
  recordResponseSizeBytes,
  recordAlertFired,
  recordUpstreamLatency,
  recordCacheHit,
  recordCacheMiss,
} from "../src/shared/metrics";

describe("Prometheus metrics", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("exportMetrics returns valid Prometheus text format", async () => {
    const text = await exportMetrics();
    expect(typeof text).toBe("string");
    expect(text).toContain("# HELP");
    expect(text).toContain("# TYPE");
    // Default Node.js metrics should be present
    expect(text).toContain("llmask_nodejs_");
  });

  it("records request metrics", async () => {
    recordRequestMetrics({ provider: "openai", model: "gpt-4", status: "200", inputTokens: 100, outputTokens: 50 });
    const text = await exportMetrics();
    expect(text).toContain("llmask_requests_total");
    expect(text).toContain('provider="openai"');
    expect(text).toContain("llmask_tokens_input_total");
    expect(text).toContain("llmask_tokens_output_total");
  });

  it("records PII detection metrics", async () => {
    recordEntityDetection([{ category: "email" }, { category: "email" }, { category: "secret" }]);
    const text = await exportMetrics();
    expect(text).toContain("llmask_pii_detected_total");
    expect(text).toContain('type="email"');
    expect(text).toContain('type="secret"');
  });

  it("records PII masking and leaks", async () => {
    recordEntityMasking(5);
    recordEntityLeak(2);
    const text = await exportMetrics();
    expect(text).toContain("llmask_pii_masked_total");
    expect(text).toContain("llmask_pii_leaked_total");
  });

  it("tracks active connections", async () => {
    incrementActiveSessions();
    incrementActiveSessions();
    decrementActiveSessions();
    const text = await exportMetrics();
    expect(text).toContain("llmask_active_connections 1");
  });

  it("records remaps", async () => {
    recordRemap();
    recordRemap();
    const text = await exportMetrics();
    expect(text).toContain("llmask_remaps_total 2");
  });

  it("records rewrites", async () => {
    recordRewrite();
    recordRewrite();
    const text = await exportMetrics();
    expect(text).toContain("llmask_rewrites_total 2");
  });

  it("records fallback provider usage", async () => {
    recordFallbackProvider("openai", "anthropic");
    const text = await exportMetrics();
    expect(text).toContain("llmask_fallback_provider_total");
    expect(text).toContain('from_provider="openai"');
    expect(text).toContain('to_provider="anthropic"');
  });

  it("records HTTP request and error classes", async () => {
    recordHttpRequest("GET", "/health", "200");
    recordHttpRequest("POST", "/v1/chat/completions", "500");
    const text = await exportMetrics();
    expect(text).toContain("llmask_http_requests_total");
    expect(text).toContain('route="/health"');
    expect(text).toContain("llmask_http_errors_total");
    expect(text).toContain('status_class="5xx"');
  });

  it("records provider errors", async () => {
    recordProviderError("openai", "timeout");
    const text = await exportMetrics();
    expect(text).toContain("llmask_provider_errors_total");
    expect(text).toContain('error_type="timeout"');
  });

  it("records streaming chunks", async () => {
    recordStreamingChunk();
    recordStreamingChunk();
    recordStreamingChunk();
    const text = await exportMetrics();
    expect(text).toContain("llmask_streaming_chunks_total 3");
  });

  it("records payload bytes histogram", async () => {
    recordPayloadBytes(1500);
    const text = await exportMetrics();
    expect(text).toContain("llmask_request_payload_bytes");
  });

  it("records mapping store size", async () => {
    setMappingStoreSize(42);
    const text = await exportMetrics();
    expect(text).toContain("llmask_mapping_store_size 42");
  });

  it("includes uptime gauge", async () => {
    const text = await exportMetrics();
    expect(text).toContain("llmask_uptime_seconds");
  });

  // ── New metrics tests ──────────────────────────────────────────

  it("records entities detected with type and severity", async () => {
    recordEntitiesDetected([
      { entityType: "email", severity: "high" },
      { entityType: "phone", severity: "medium" },
      { entityType: "email", severity: "high" },
    ]);
    const text = await exportMetrics();
    expect(text).toContain("llmask_entities_detected_total");
    expect(text).toContain('entity_type="email"');
    expect(text).toContain('severity="high"');
    expect(text).toContain('entity_type="phone"');
  });

  it("records entities detected uses default severity", async () => {
    recordEntitiesDetected([{ entityType: "ssn" }]);
    const text = await exportMetrics();
    expect(text).toContain('severity="medium"');
  });

  it("records entities masked with type", async () => {
    recordEntitiesMasked([
      { entityType: "email" },
      { entityType: "email" },
      { entityType: "credit_card" },
    ]);
    const text = await exportMetrics();
    expect(text).toContain("llmask_entities_masked_total");
    expect(text).toContain('entity_type="email"');
    expect(text).toContain('entity_type="credit_card"');
  });

  it("records prompt size bytes", async () => {
    recordPromptSizeBytes(2048);
    const text = await exportMetrics();
    expect(text).toContain("llmask_prompt_size_bytes");
    expect(text).toContain("llmask_prompt_size_bytes_count 1");
  });

  it("records response size bytes", async () => {
    recordResponseSizeBytes(4096);
    const text = await exportMetrics();
    expect(text).toContain("llmask_response_size_bytes");
    expect(text).toContain("llmask_response_size_bytes_count 1");
  });

  it("records alerts fired with severity and rule", async () => {
    recordAlertFired("critical", "leak_threshold");
    recordAlertFired("warning", "high_latency");
    const text = await exportMetrics();
    expect(text).toContain("llmask_alerts_fired_total");
    expect(text).toContain('severity="critical"');
    expect(text).toContain('rule="leak_threshold"');
    expect(text).toContain('severity="warning"');
    expect(text).toContain('rule="high_latency"');
  });

  it("records upstream latency", async () => {
    recordUpstreamLatency("openai", 1.5);
    recordUpstreamLatency("anthropic", 0.8);
    const text = await exportMetrics();
    expect(text).toContain("llmask_upstream_latency_seconds");
    expect(text).toContain('provider="openai"');
    expect(text).toContain('provider="anthropic"');
  });

  it("records cache hits and misses", async () => {
    recordCacheHit();
    recordCacheHit();
    recordCacheMiss();
    const text = await exportMetrics();
    expect(text).toContain("llmask_cache_hits_total 2");
    expect(text).toContain("llmask_cache_misses_total 1");
  });

  it("exports all expected metric families", async () => {
    const text = await exportMetrics();
    const expectedMetrics = [
      "llmask_requests_total",
      "llmask_request_duration_seconds",
      "llmask_active_connections",
      "llmask_mapping_store_size",
      "llmask_entities_detected_total",
      "llmask_entities_masked_total",
      "llmask_prompt_size_bytes",
      "llmask_response_size_bytes",
      "llmask_alerts_fired_total",
      "llmask_upstream_latency_seconds",
      "llmask_cache_hits_total",
      "llmask_cache_misses_total",
      "llmask_uptime_seconds",
    ];
    for (const name of expectedMetrics) {
      expect(text).toContain(`# HELP ${name}`);
      expect(text).toContain(`# TYPE ${name}`);
    }
  });
});
