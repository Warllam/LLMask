import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { AlertStore } from "../../src/modules/alerts/alert-store";
import { AlertManager } from "../../src/modules/alerts/alert-manager";
import pino from "pino";

describe("New Alert Rules", () => {
  let db: Database.Database;
  let alertStore: AlertStore;
  let logger: any;

  function createManager(opts?: { escalation?: any }) {
    return new AlertManager(
      {
        enabled: true,
        channels: ["console"],
        ...opts,
      },
      alertStore,
      logger,
      { getLeakCount: () => 0 }
    );
  }

  beforeEach(() => {
    db = Database(":memory:");
    // Create request_log table needed by AlertStore
    db.exec(`
      CREATE TABLE IF NOT EXISTS request_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        transformed_count INTEGER NOT NULL DEFAULT 0
      );
    `);
    alertStore = new AlertStore(db);
    alertStore.initialize();
    logger = pino({ level: "silent" });
  });

  it("should record and detect high entropy secrets", () => {
    const mgr = createManager();
    alertStore.upsertRule({
      id: "test-entropy",
      name: "High Entropy",
      kind: "high_entropy_secret",
      enabled: true,
      severity: "critical",
      threshold: 2,
      windowMinutes: 5,
      channels: ["console"],
      cooldownMinutes: 5,
    });

    mgr.recordHighEntropySecret(5.2);
    mgr.recordHighEntropySecret(4.8);
    mgr["evaluate"]();

    const events = alertStore.listFiringEvents();
    const found = events.find(e => e.ruleId === "test-entropy");
    expect(found).toBeDefined();
    expect(found?.severity).toBe("critical");
  });

  it("should record and detect prompt injections", () => {
    const mgr = createManager();
    alertStore.upsertRule({
      id: "test-injection",
      name: "Prompt Injection",
      kind: "prompt_injection",
      enabled: true,
      severity: "critical",
      threshold: 1,
      windowMinutes: 10,
      channels: ["console"],
      cooldownMinutes: 5,
    });

    mgr.recordPromptInjection();
    mgr["evaluate"]();

    const events = alertStore.listFiringEvents();
    expect(events.find(e => e.ruleId === "test-injection")).toBeDefined();
  });

  it("should record and detect provider 5xx errors", () => {
    const mgr = createManager();
    alertStore.upsertRule({
      id: "test-5xx",
      name: "5xx Errors",
      kind: "provider_5xx_repeated",
      enabled: true,
      severity: "critical",
      threshold: 3,
      windowMinutes: 5,
      channels: ["console"],
      cooldownMinutes: 10,
    });

    mgr.recordProvider5xx();
    mgr.recordProvider5xx();
    mgr.recordProvider5xx();
    mgr["evaluate"]();

    const events = alertStore.listFiringEvents();
    expect(events.find(e => e.ruleId === "test-5xx")).toBeDefined();
  });

  it("should record and detect rate limit quota exceeded", () => {
    const mgr = createManager();
    alertStore.upsertRule({
      id: "test-quota",
      name: "Quota Exceeded",
      kind: "rate_limit_quota",
      enabled: true,
      severity: "warning",
      threshold: 5,
      windowMinutes: 10,
      channels: ["console"],
      cooldownMinutes: 15,
    });

    for (let i = 0; i < 6; i++) mgr.recordRateLimitQuota();
    mgr["evaluate"]();

    const events = alertStore.listFiringEvents();
    expect(events.find(e => e.ruleId === "test-quota")).toBeDefined();
  });

  it("should detect critical proxy latency (>2s)", () => {
    const mgr = createManager();
    alertStore.upsertRule({
      id: "test-latency-critical",
      name: "Latency Critical",
      kind: "proxy_latency_critical",
      enabled: true,
      severity: "critical",
      threshold: 2000,
      windowMinutes: 5,
      channels: ["console"],
      cooldownMinutes: 10,
    });

    mgr.recordLatency(2500);
    mgr.recordLatency(3000);
    mgr["evaluate"]();

    const events = alertStore.listFiringEvents();
    expect(events.find(e => e.ruleId === "test-latency-critical")).toBeDefined();
  });

  it("should not fire when below threshold", () => {
    const mgr = createManager();
    alertStore.upsertRule({
      id: "test-no-fire",
      name: "No Fire",
      kind: "prompt_injection",
      enabled: true,
      severity: "critical",
      threshold: 5,
      windowMinutes: 10,
      channels: ["console"],
      cooldownMinutes: 5,
    });

    mgr.recordPromptInjection(); // only 1, threshold is 5
    mgr["evaluate"]();

    const events = alertStore.listFiringEvents();
    expect(events.find(e => e.ruleId === "test-no-fire")).toBeUndefined();
  });
});

describe("Escalation System", () => {
  let db: Database.Database;
  let alertStore: AlertStore;
  let logger: any;

  beforeEach(() => {
    db = Database(":memory:");
    db.exec(`
      CREATE TABLE IF NOT EXISTS request_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        transformed_count INTEGER NOT NULL DEFAULT 0
      );
    `);
    alertStore = new AlertStore(db);
    alertStore.initialize();
    logger = pino({ level: "silent" });
  });

  it("should escalate unacknowledged critical alerts", () => {
    const mgr = new AlertManager(
      {
        enabled: true,
        channels: ["console"],
        escalation: {
          enabled: true,
          escalateAfterMinutes: 0, // immediate for testing
          maxRepetitions: 3,
        },
      },
      alertStore,
      logger,
      { getLeakCount: () => 0 }
    );

    // Insert a firing critical event in the past
    const eventId = alertStore.insertEvent({
      ruleId: "leak-threshold",
      ruleName: "Test Critical",
      severity: "critical",
      status: "firing",
      message: "Test critical alert",
      value: 5,
      threshold: 1,
      firedAt: new Date(Date.now() - 120_000).toISOString(), // 2 min ago
    });

    // Run escalation check
    mgr["checkEscalations"]();

    // Escalation count should have incremented
    expect(mgr["escalationCounts"].get(eventId)).toBe(1);
  });

  it("should not escalate acknowledged alerts", () => {
    const mgr = new AlertManager(
      {
        enabled: true,
        channels: ["console"],
        escalation: {
          enabled: true,
          escalateAfterMinutes: 0,
          maxRepetitions: 3,
        },
      },
      alertStore,
      logger,
      { getLeakCount: () => 0 }
    );

    const eventId = alertStore.insertEvent({
      ruleId: "leak-threshold",
      ruleName: "Test Ack",
      severity: "critical",
      status: "firing",
      message: "Test ack alert",
      value: 5,
      threshold: 1,
      firedAt: new Date(Date.now() - 120_000).toISOString(),
    });

    alertStore.acknowledgeEvent(eventId, "admin");
    mgr["checkEscalations"]();

    expect(mgr["escalationCounts"].get(eventId)).toBeUndefined();
  });

  it("should respect maxRepetitions", () => {
    const mgr = new AlertManager(
      {
        enabled: true,
        channels: ["console"],
        escalation: {
          enabled: true,
          escalateAfterMinutes: 0,
          maxRepetitions: 2,
        },
      },
      alertStore,
      logger,
      { getLeakCount: () => 0 }
    );

    const eventId = alertStore.insertEvent({
      ruleId: "leak-threshold",
      ruleName: "Test Max",
      severity: "critical",
      status: "firing",
      message: "Test max reps",
      value: 5,
      threshold: 1,
      firedAt: new Date(Date.now() - 300_000).toISOString(),
    });

    // Set count to max already
    mgr["escalationCounts"].set(eventId, 2);
    mgr["checkEscalations"]();

    // Should still be 2 (not incremented)
    expect(mgr["escalationCounts"].get(eventId)).toBe(2);
  });
});
