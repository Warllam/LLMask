import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { AlertStore } from "../../src/modules/alerts/alert-store";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("AlertStore", () => {
  let db: Database.Database;
  let store: AlertStore;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "llmask-alert-test-"));
    const dbPath = path.join(tmpDir, "alert-test.db");
    db = new Database(dbPath);
    // Create request_log table (needed by metric queries)
    db.exec(`
      CREATE TABLE IF NOT EXISTS request_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trace_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        model TEXT,
        original_body TEXT NOT NULL,
        rewritten_body TEXT NOT NULL,
        response_body TEXT,
        transformed_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    store = new AlertStore(db);
    store.initialize();
  });

  afterAll(() => {
    db.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  describe("default rules", () => {
    it("seeds 4 default rules on initialize", () => {
      const rules = store.listRules();
      expect(rules.length).toBe(4);
    });

    it("includes leak-threshold rule as critical", () => {
      const rule = store.getRule("leak-threshold");
      expect(rule).not.toBeNull();
      expect(rule!.severity).toBe("critical");
      expect(rule!.kind).toBe("leak_threshold");
      expect(rule!.enabled).toBe(true);
    });

    it("includes high-volume rule", () => {
      const rule = store.getRule("high-volume");
      expect(rule).not.toBeNull();
      expect(rule!.kind).toBe("request_volume");
      expect(rule!.threshold).toBe(500);
    });

    it("does not re-seed on second initialize", () => {
      store.initialize();
      const rules = store.listRules();
      expect(rules.length).toBe(4);
    });
  });

  describe("CRUD rules", () => {
    it("upsert creates a new rule", () => {
      store.upsertRule({
        id: "custom-1",
        name: "Custom alert",
        kind: "sensitive_spike",
        enabled: true,
        severity: "warning",
        threshold: 50,
        windowMinutes: 30,
        channels: ["dashboard", "webhook"],
        cooldownMinutes: 15,
      });
      const rule = store.getRule("custom-1");
      expect(rule).not.toBeNull();
      expect(rule!.name).toBe("Custom alert");
      expect(rule!.channels).toEqual(["dashboard", "webhook"]);
    });

    it("upsert updates an existing rule", () => {
      store.upsertRule({
        id: "custom-1",
        name: "Custom alert updated",
        kind: "sensitive_spike",
        enabled: false,
        severity: "critical",
        threshold: 100,
        windowMinutes: 60,
        channels: ["log"],
        cooldownMinutes: 5,
      });
      const rule = store.getRule("custom-1");
      expect(rule!.name).toBe("Custom alert updated");
      expect(rule!.enabled).toBe(false);
      expect(rule!.severity).toBe("critical");
      expect(rule!.threshold).toBe(100);
    });

    it("delete removes a rule", () => {
      const deleted = store.deleteRule("custom-1");
      expect(deleted).toBe(true);
      expect(store.getRule("custom-1")).toBeNull();
    });

    it("delete returns false for non-existent rule", () => {
      expect(store.deleteRule("nonexistent")).toBe(false);
    });
  });

  describe("events", () => {
    it("insert and list events", () => {
      const id = store.insertEvent({
        ruleId: "leak-threshold",
        ruleName: "Fuite de donnees",
        severity: "critical",
        status: "firing",
        message: "3 fuites detectees",
        value: 3,
        threshold: 1,
        firedAt: new Date().toISOString(),
      });
      expect(id).toBeGreaterThan(0);

      const events = store.listEvents();
      expect(events.length).toBe(1);
      expect(events[0].ruleId).toBe("leak-threshold");
      expect(events[0].status).toBe("firing");
    });

    it("lists firing events", () => {
      const firing = store.listFiringEvents();
      expect(firing.length).toBe(1);
    });

    it("resolves an event", () => {
      const firing = store.listFiringEvents();
      store.resolveEvent(firing[0].id);
      const resolved = store.listEvents();
      expect(resolved[0].status).toBe("resolved");
      expect(resolved[0].resolvedAt).not.toBeNull();
    });

    it("getLastEventForRule returns most recent", () => {
      store.insertEvent({
        ruleId: "leak-threshold",
        ruleName: "Fuite",
        severity: "critical",
        status: "firing",
        message: "5 fuites",
        value: 5,
        threshold: 1,
        firedAt: new Date().toISOString(),
      });
      const last = store.getLastEventForRule("leak-threshold");
      expect(last).not.toBeNull();
      expect(last!.value).toBe(5);
      expect(last!.status).toBe("firing");
    });
  });

  describe("acknowledgement", () => {
    it("acknowledges an event", () => {
      const firing = store.listFiringEvents();
      expect(firing.length).toBeGreaterThan(0);
      store.acknowledgeEvent(firing[0].id, "test-admin");
      const events = store.listEvents();
      const acked = events.find(e => e.id === firing[0].id);
      expect(acked?.acknowledgedAt).not.toBeNull();
      expect(acked?.acknowledgedBy).toBe("test-admin");
    });

    it("bulkAcknowledge acknowledges multiple events", () => {
      // Insert two more events
      const id1 = store.insertEvent({
        ruleId: "leak-threshold", ruleName: "Test", severity: "warning",
        status: "firing", message: "test1", value: 1, threshold: 1,
        firedAt: new Date().toISOString(),
      });
      const id2 = store.insertEvent({
        ruleId: "leak-threshold", ruleName: "Test", severity: "info",
        status: "firing", message: "test2", value: 2, threshold: 1,
        firedAt: new Date().toISOString(),
      });
      const count = store.bulkAcknowledge([id1, id2], "bulk-admin");
      expect(count).toBe(2);
    });

    it("countUnacknowledged returns correct count", () => {
      const count = store.countUnacknowledged();
      expect(typeof count).toBe("number");
    });
  });

  describe("filterEvents", () => {
    it("filters by severity", () => {
      const { events } = store.filterEvents({ severity: "critical" });
      for (const e of events) {
        expect(e.severity).toBe("critical");
      }
    });

    it("filters by status", () => {
      const { events } = store.filterEvents({ status: "firing" });
      for (const e of events) {
        expect(e.status).toBe("firing");
      }
    });

    it("filters by acknowledged status", () => {
      const { events } = store.filterEvents({ status: "acknowledged" });
      for (const e of events) {
        expect(e.acknowledgedAt).not.toBeNull();
      }
    });

    it("supports pagination with limit and offset", () => {
      const { events: page1, total } = store.filterEvents({ limit: 2, offset: 0 });
      expect(page1.length).toBeLessThanOrEqual(2);
      expect(total).toBeGreaterThanOrEqual(page1.length);
    });

    it("returns total count for pagination", () => {
      const { total } = store.filterEvents({});
      expect(total).toBeGreaterThan(0);
    });
  });

  describe("metric queries", () => {
    it("countRequestsInWindow returns 0 when no requests", () => {
      expect(store.countRequestsInWindow(60)).toBe(0);
    });

    it("countRequestsInWindow counts recent requests", () => {
      db.prepare(`
        INSERT INTO request_log (trace_id, request_id, endpoint, model, original_body, rewritten_body, transformed_count)
        VALUES ('t1', 'r1', 'chat-completions', 'gpt-4', '{}', '{}', 3)
      `).run();
      db.prepare(`
        INSERT INTO request_log (trace_id, request_id, endpoint, model, original_body, rewritten_body, transformed_count)
        VALUES ('t2', 'r2', 'chat-completions', 'gpt-4', '{}', '{}', 0)
      `).run();
      expect(store.countRequestsInWindow(60)).toBe(2);
    });

    it("countTransformsInWindow returns correct totals", () => {
      const { total, withTransforms } = store.countTransformsInWindow(60);
      expect(total).toBe(2);
      expect(withTransforms).toBe(1);
    });
  });
});
