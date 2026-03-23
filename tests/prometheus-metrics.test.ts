import { describe, it, expect, beforeEach } from "vitest";
import { resetMetrics } from "../../src/shared/metrics";
import {
  registry,
  startTimer,
  recordMaskingDuration,
  recordStreamingDuration,
  recordRemapDuration,
  recordPiiDetectionsByType,
  recordAlertByLevel,
  recordDetectionDuration,
  recordPipelineDuration,
  maskingDuration,
  streamingDuration,
  remapDuration,
  piiDetectionsByType,
  alertsByLevel,
  detectionDuration,
  pipelineDuration,
} from "../../src/modules/metrics/prometheus-metrics";

describe("Pipeline Prometheus metrics", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("records masking duration histogram", async () => {
    recordMaskingDuration("openai", "chat-completions", 0.042);
    const text = await registry.metrics();
    expect(text).toContain("llmask_masking_duration_seconds");
    expect(text).toContain('provider="openai"');
    expect(text).toContain('endpoint="chat-completions"');
    expect(text).toContain("llmask_masking_duration_seconds_count");
  });

  it("records streaming duration histogram", async () => {
    recordStreamingDuration("anthropic", "200", 3.5);
    const text = await registry.metrics();
    expect(text).toContain("llmask_streaming_duration_seconds");
    expect(text).toContain('provider="anthropic"');
    expect(text).toContain('status="200"');
  });

  it("records remap duration histogram", async () => {
    recordRemapDuration("openai", false, 0.015);
    recordRemapDuration("openai", true, 0.008);
    const text = await registry.metrics();
    expect(text).toContain("llmask_remap_duration_seconds");
    expect(text).toContain('streaming="false"');
    expect(text).toContain('streaming="true"');
  });

  it("records PII detections by type with provider label", async () => {
    recordPiiDetectionsByType(
      [{ category: "email" }, { category: "phone" }, { category: "email" }],
      "openai",
    );
    const text = await registry.metrics();
    expect(text).toContain("llmask_pii_detections_by_type_total");
    expect(text).toContain('pii_type="email"');
    expect(text).toContain('pii_type="phone"');
    expect(text).toContain('provider="openai"');
  });

  it("records alerts by level", async () => {
    recordAlertByLevel("critical", "leak_threshold");
    recordAlertByLevel("warning", "high_latency");
    const text = await registry.metrics();
    expect(text).toContain("llmask_alerts_by_level_total");
    expect(text).toContain('alert_level="critical"');
    expect(text).toContain('alert_level="warning"');
  });

  it("records detection duration histogram", async () => {
    recordDetectionDuration("openai", 0.003);
    const text = await registry.metrics();
    expect(text).toContain("llmask_detection_duration_seconds");
    expect(text).toContain('provider="openai"');
  });

  it("records pipeline duration histogram", async () => {
    recordPipelineDuration("openai", "chat-completions", "200", 1.234);
    const text = await registry.metrics();
    expect(text).toContain("llmask_pipeline_duration_seconds");
    expect(text).toContain('provider="openai"');
    expect(text).toContain('endpoint="chat-completions"');
    expect(text).toContain('status="200"');
  });

  it("startTimer returns elapsed seconds", async () => {
    const elapsed = startTimer();
    // Small busy wait
    const start = Date.now();
    while (Date.now() - start < 10) { /* wait ~10ms */ }
    const dur = elapsed();
    expect(dur).toBeGreaterThan(0.005);
    expect(dur).toBeLessThan(1);
  });

  it("all new metrics appear in export", async () => {
    // Trigger all metrics so they appear
    recordMaskingDuration("test", "test", 0.01);
    recordStreamingDuration("test", "200", 1);
    recordRemapDuration("test", false, 0.01);
    recordPiiDetectionsByType([{ category: "test" }], "test");
    recordAlertByLevel("info", "test_rule");
    recordDetectionDuration("test", 0.01);
    recordPipelineDuration("test", "test", "200", 1);

    const text = await registry.metrics();
    const expected = [
      "llmask_masking_duration_seconds",
      "llmask_streaming_duration_seconds",
      "llmask_remap_duration_seconds",
      "llmask_pii_detections_by_type_total",
      "llmask_alerts_by_level_total",
      "llmask_detection_duration_seconds",
      "llmask_pipeline_duration_seconds",
    ];
    for (const name of expected) {
      expect(text).toContain(`# HELP ${name}`);
      expect(text).toContain(`# TYPE ${name}`);
    }
  });

  it("exported text is valid Prometheus format", async () => {
    recordMaskingDuration("openai", "chat-completions", 0.05);
    const text = await registry.metrics();
    // Every non-empty line should be a comment (#) or a metric line
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    for (const line of lines) {
      const isComment = line.startsWith("#");
      // Prometheus metric line: name{labels} value [timestamp]
      const isMetric = /^[a-zA-Z_:][a-zA-Z0-9_:]*(\{[^}]*\})?\s+/.test(line);
      expect(isComment || isMetric).toBe(true);
    }
  });
});
