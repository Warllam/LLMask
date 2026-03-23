import { describe, it, expect, beforeEach } from "vitest";
import { CompositeAlertEngine, type MetricProvider } from "../../src/modules/alerts/composite-alerts";
import type { CompositeAlertRule } from "../../src/modules/alerts/alert-types";

const mockLogger: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function makeRule(overrides: Partial<CompositeAlertRule> = {}): CompositeAlertRule {
  return {
    id: "composite-1",
    name: "High load + leaks",
    enabled: true,
    severity: "critical",
    operator: "and",
    conditions: [
      { kind: "request_volume", threshold: 100, windowMinutes: 10 },
      { kind: "leak_threshold", threshold: 1, windowMinutes: 10 },
    ],
    channels: ["dashboard"],
    cooldownMinutes: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("CompositeAlertEngine", () => {
  let engine: CompositeAlertEngine;

  beforeEach(() => {
    engine = new CompositeAlertEngine(mockLogger);
  });

  it("fires when all AND conditions are met", () => {
    engine.addRule(makeRule());
    const metrics: Record<string, number> = { request_volume: 200, leak_threshold: 3 };
    const provider: MetricProvider = (kind) => metrics[kind] ?? 0;
    const results = engine.evaluate(provider);
    expect(results).toHaveLength(1);
    expect(results[0].fired).toBe(true);
  });

  it("does not fire when only one AND condition is met", () => {
    engine.addRule(makeRule());
    const metrics: Record<string, number> = { request_volume: 200, leak_threshold: 0 };
    const provider: MetricProvider = (kind) => metrics[kind] ?? 0;
    const results = engine.evaluate(provider);
    expect(results[0].fired).toBe(false);
  });

  it("fires when any OR condition is met", () => {
    engine.addRule(makeRule({ operator: "or" }));
    const metrics: Record<string, number> = { request_volume: 50, leak_threshold: 5 };
    const provider: MetricProvider = (kind) => metrics[kind] ?? 0;
    const results = engine.evaluate(provider);
    expect(results[0].fired).toBe(true);
  });

  it("does not fire when no OR conditions are met", () => {
    engine.addRule(makeRule({ operator: "or" }));
    const metrics: Record<string, number> = { request_volume: 50, leak_threshold: 0 };
    const provider: MetricProvider = (kind) => metrics[kind] ?? 0;
    const results = engine.evaluate(provider);
    expect(results[0].fired).toBe(false);
  });

  it("respects cooldown", () => {
    engine.addRule(makeRule({ cooldownMinutes: 60 }));
    const metrics: Record<string, number> = { request_volume: 200, leak_threshold: 3 };
    const provider: MetricProvider = (kind) => metrics[kind] ?? 0;

    const r1 = engine.evaluate(provider);
    expect(r1[0].fired).toBe(true);

    // Second evaluation should be in cooldown
    const r2 = engine.evaluate(provider);
    expect(r2).toHaveLength(0); // skipped due to cooldown
  });

  it("skips disabled rules", () => {
    engine.addRule(makeRule({ enabled: false }));
    const provider: MetricProvider = () => 999;
    expect(engine.evaluate(provider)).toHaveLength(0);
  });

  it("builds event with correct message", () => {
    const rule = makeRule();
    engine.addRule(rule);
    const metrics: Record<string, number> = { request_volume: 200, leak_threshold: 3 };
    const provider: MetricProvider = (kind) => metrics[kind] ?? 0;
    const results = engine.evaluate(provider);
    const event = engine.buildEvent(rule, results[0]);
    expect(event.severity).toBe("critical");
    expect(event.message).toContain("composite");
    expect(event.message).toContain("2/2");
  });

  it("manages rules (add/remove/list)", () => {
    engine.addRule(makeRule({ id: "a" }));
    engine.addRule(makeRule({ id: "b" }));
    expect(engine.listRules()).toHaveLength(2);
    expect(engine.removeRule("a")).toBe(true);
    expect(engine.listRules()).toHaveLength(1);
    expect(engine.getRule("b")).toBeDefined();
  });
});
