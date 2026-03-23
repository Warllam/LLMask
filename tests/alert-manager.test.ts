import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { AlertStore } from "../../src/modules/alerts/alert-store";
import { AlertManager } from "../../src/modules/alerts/alert-manager";
import pino from "pino";

describe("AlertManager", () => {
  let db: Database.Database;
  let alertStore: AlertStore;
  let alertManager: AlertManager;
  let logger: any;

  beforeEach(() => {
    db = Database(":memory:");
    alertStore = new AlertStore(db);
    alertStore.initialize();

    logger = pino({ level: "silent" });

    alertManager = new AlertManager(
      {
        enabled: true,
        channels: ["console"],
      },
      alertStore,
      logger,
      {
        getLeakCount: () => 0,
      }
    );
  });

  it("should initialize with default rules", () => {
    const rules = alertStore.listRules();
    expect(rules.length).toBeGreaterThan(0);
  });

  it("should record blocked requests", () => {
    alertManager.recordBlock();
    alertManager.recordBlock();
    
    const metrics = alertManager.getMetrics();
    expect(metrics.totalBlocked).toBe(2);
  });

  it("should record rate limit violations", () => {
    alertManager.recordRateLimit();
    alertManager.recordRateLimit();
    alertManager.recordRateLimit();
    
    const metrics = alertManager.getMetrics();
    expect(metrics.totalRateLimited).toBe(3);
  });

  it("should record provider errors", () => {
    alertManager.recordProviderError();
    
    const metrics = alertManager.getMetrics();
    expect(metrics.totalProviderErrors).toBe(1);
  });

  it("should calculate average latency", () => {
    alertManager.recordLatency(100);
    alertManager.recordLatency(200);
    alertManager.recordLatency(300);
    
    const metrics = alertManager.getMetrics();
    expect(metrics.avgProxyLatencyMs).toBe(200);
  });

  it("should fire alert when threshold breached", () => {
    // Create a rule with low threshold
    alertStore.upsertRule({
      id: "test-rule",
      name: "Test Rule",
      kind: "policy_block_rate",
      enabled: true,
      severity: "warning",
      threshold: 2,
      windowMinutes: 60,
      channels: ["console"],
      cooldownMinutes: 5,
    });

    // Record blocks to breach threshold
    alertManager.recordBlock();
    alertManager.recordBlock();
    alertManager.recordBlock();

    // Trigger evaluation
    alertManager["evaluate"]();

    // Check if alert was fired
    const firingAlerts = alertStore.listFiringEvents();
    expect(firingAlerts.length).toBeGreaterThan(0);
    
    const testAlert = firingAlerts.find(a => a.ruleId === "test-rule");
    expect(testAlert).toBeDefined();
    expect(testAlert?.status).toBe("firing");
  });

  it("should resolve alert when condition returns to normal", () => {
    // Create and fire an alert
    alertStore.upsertRule({
      id: "test-resolve",
      name: "Test Resolve",
      kind: "policy_block_rate",
      enabled: true,
      severity: "warning",
      threshold: 2,
      windowMinutes: 60,
      channels: ["console"],
      cooldownMinutes: 0,
    });

    alertManager.recordBlock();
    alertManager.recordBlock();
    alertManager.recordBlock();
    alertManager["evaluate"]();

    let firingAlerts = alertStore.listFiringEvents();
    expect(firingAlerts.length).toBeGreaterThan(0);

    // Reset condition (simulate metrics reset)
    alertManager["metrics"].blocked = 0;
    alertManager["evaluate"]();

    // Check if alert was resolved
    const events = alertStore.listEvents(10);
    const testEvent = events.find(e => e.ruleId === "test-resolve");
    expect(testEvent?.status).toBe("resolved");
    expect(testEvent?.resolvedAt).not.toBeNull();
  });

  it("should respect cooldown period", () => {
    alertStore.upsertRule({
      id: "test-cooldown",
      name: "Test Cooldown",
      kind: "policy_block_rate",
      enabled: true,
      severity: "warning",
      threshold: 1,
      windowMinutes: 60,
      channels: ["console"],
      cooldownMinutes: 60,
    });

    // Fire alert
    alertManager.recordBlock();
    alertManager.recordBlock();
    alertManager["evaluate"]();

    const eventsBefore = alertStore.listEvents(10);
    const countBefore = eventsBefore.filter(e => e.ruleId === "test-cooldown").length;

    // Try to fire again immediately (should be blocked by cooldown)
    alertManager.recordBlock();
    alertManager["evaluate"]();

    const eventsAfter = alertStore.listEvents(10);
    const countAfter = eventsAfter.filter(e => e.ruleId === "test-cooldown").length;

    // Should still be only 1 event due to cooldown
    expect(countAfter).toBe(countBefore);
  });

  it("should stop cleanly", () => {
    alertManager.start(1000);
    alertManager.stop();
    
    // No assertions needed, just verify it doesn't throw
    expect(true).toBe(true);
  });
});
