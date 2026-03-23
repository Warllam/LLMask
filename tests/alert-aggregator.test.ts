import { describe, it, expect, vi, beforeEach } from "vitest";
import { AlertAggregator, formatDigestText, type AggregatedDigest } from "../../src/modules/alerts/alert-aggregator";
import type { AlertEvent } from "../../src/modules/alerts/alert-types";

function createTestLogger() {
  return {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    fatal: vi.fn(), trace: vi.fn(), child: vi.fn().mockReturnThis(),
    level: "silent", silent: vi.fn(),
  } as any;
}

function makeEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    id: 1,
    ruleId: "test-rule",
    ruleName: "Test Rule",
    severity: "warning",
    status: "firing",
    message: "Test alert",
    value: 10,
    threshold: 5,
    firedAt: new Date().toISOString(),
    resolvedAt: null,
    acknowledgedAt: null,
    acknowledgedBy: null,
    ...overrides,
  };
}

describe("AlertAggregator", () => {
  let aggregator: AlertAggregator;
  let digestCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    digestCallback = vi.fn();
    aggregator = new AlertAggregator(
      { enabled: true, digestIntervalMinutes: 15, minAlertsForDigest: 3, maxBufferSize: 10 },
      createTestLogger()
    );
    aggregator.setDigestCallback(digestCallback);
  });

  it("buffers non-critical alerts", () => {
    const buffered = aggregator.add(makeEvent({ severity: "warning" }));
    expect(buffered).toBe(true);
    expect(aggregator.getBufferSize()).toBe(1);
  });

  it("does not buffer critical alerts", () => {
    const buffered = aggregator.add(makeEvent({ severity: "critical" }));
    expect(buffered).toBe(false);
    expect(aggregator.getBufferSize()).toBe(0);
  });

  it("flushes when buffer exceeds max size", () => {
    for (let i = 0; i < 10; i++) {
      aggregator.add(makeEvent({ id: i, severity: "warning" }));
    }
    expect(digestCallback).toHaveBeenCalledTimes(1);
    expect(aggregator.getBufferSize()).toBe(0);
  });

  it("groups events by ruleId in digest", () => {
    for (let i = 0; i < 5; i++) {
      aggregator.add(makeEvent({ id: i, ruleId: i < 3 ? "rule-a" : "rule-b", severity: "warning" }));
    }
    aggregator.flush();
    expect(digestCallback).toHaveBeenCalledTimes(1);
    const digest: AggregatedDigest = digestCallback.mock.calls[0][0];
    expect(digest.totalCount).toBe(5);
    expect(digest.groups.get("rule-a")?.length).toBe(3);
    expect(digest.groups.get("rule-b")?.length).toBe(2);
  });

  it("sends individually when below minAlertsForDigest", () => {
    aggregator.add(makeEvent({ id: 1, severity: "info" }));
    aggregator.add(makeEvent({ id: 2, severity: "info" }));
    aggregator.flush();
    // Each sent as individual digest
    expect(digestCallback).toHaveBeenCalledTimes(2);
  });

  it("does nothing when buffer is empty", () => {
    aggregator.flush();
    expect(digestCallback).not.toHaveBeenCalled();
  });

  it("does not buffer when disabled", () => {
    const disabled = new AlertAggregator(
      { enabled: false, digestIntervalMinutes: 15, minAlertsForDigest: 3, maxBufferSize: 10 },
      createTestLogger()
    );
    const buffered = disabled.add(makeEvent());
    expect(buffered).toBe(false);
  });
});

describe("formatDigestText", () => {
  it("formats a digest into readable text", () => {
    const digest: AggregatedDigest = {
      from: "2024-01-01T00:00:00Z",
      to: "2024-01-01T00:15:00Z",
      groups: new Map([
        ["rule-a", [makeEvent({ ruleId: "rule-a", ruleName: "Rule A", value: 10 })]],
        ["rule-b", [makeEvent({ ruleId: "rule-b", ruleName: "Rule B", value: 20 }), makeEvent({ ruleId: "rule-b", ruleName: "Rule B", value: 25 })]],
      ]),
      totalCount: 3,
      bySeverity: { info: 0, warning: 3, critical: 0 },
    };

    const text = formatDigestText(digest);
    expect(text).toContain("3 alerts");
    expect(text).toContain("Rule A");
    expect(text).toContain("Rule B (×2");
    expect(text).toContain("🟠 Warning: 3");
  });
});
