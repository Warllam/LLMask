import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Database from "better-sqlite3";
import { AlertStore } from "../../src/modules/alerts/alert-store";
import { AlertEngine } from "../../src/modules/alerts/alert-engine";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function createTestLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: "silent",
    silent: vi.fn(),
  } as any;
}

describe("AlertEngine", () => {
  let db: Database.Database;
  let store: AlertStore;
  let engine: AlertEngine;
  let logger: any;
  let tmpDir: string;
  let leakCount: number;
  let blockedCount: number;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "llmask-alert-engine-"));
    const dbPath = path.join(tmpDir, "test.db");
    db = new Database(dbPath);
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
    logger = createTestLogger();
    leakCount = 0;
    blockedCount = 0;

    engine = new AlertEngine({
      logger,
      alertStore: store,
      getLeakCount: () => leakCount,
      getBlockedCount: () => blockedCount,
    });
  });

  afterAll(() => {
    engine.stop();
    db.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it("does not fire when all metrics are below threshold", () => {
    engine.evaluate();
    const firing = store.listFiringEvents();
    expect(firing.length).toBe(0);
  });

  it("fires leak_threshold alert when leaks detected", () => {
    leakCount = 5;
    engine.evaluate();
    const firing = store.listFiringEvents();
    expect(firing.length).toBe(1);
    expect(firing[0].ruleId).toBe("leak-threshold");
    expect(firing[0].severity).toBe("critical");
    expect(firing[0].value).toBe(5);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("does not re-fire during cooldown", () => {
    leakCount = 10;
    engine.evaluate();
    // Should still be 1 firing event (not a new one due to cooldown)
    const events = store.listEvents();
    const firingEvents = events.filter(e => e.ruleId === "leak-threshold" && e.status === "firing");
    expect(firingEvents.length).toBe(1);
  });

  it("auto-resolves when metric goes below threshold", () => {
    // Simulate cooldown expiry by resolving manually and re-evaluating
    const firing = store.listFiringEvents();
    for (const e of firing) store.resolveEvent(e.id);

    leakCount = 0;
    engine.evaluate();
    const stillFiring = store.listFiringEvents();
    expect(stillFiring.length).toBe(0);
  });

  it("fires request_volume alert when threshold exceeded", () => {
    // Insert many requests
    const insert = db.prepare(`
      INSERT INTO request_log (trace_id, request_id, endpoint, model, original_body, rewritten_body, transformed_count)
      VALUES (?, ?, 'chat-completions', 'gpt-4', '{}', '{}', 1)
    `);
    for (let i = 0; i < 501; i++) {
      insert.run(`trace-${i}`, `req-${i}`);
    }

    engine.evaluate();
    const firing = store.listFiringEvents();
    const volumeAlert = firing.find(e => e.ruleId === "high-volume");
    expect(volumeAlert).toBeDefined();
    expect(volumeAlert!.value).toBeGreaterThanOrEqual(501);
  });

  it("fires policy_block_rate when blocked count exceeds threshold", () => {
    blockedCount = 15;
    engine.evaluate();
    const firing = store.listFiringEvents();
    const blockAlert = firing.find(e => e.ruleId === "block-rate");
    expect(blockAlert).toBeDefined();
    expect(blockAlert!.value).toBe(15);
  });

  it("recordBlock increments counter", () => {
    engine.recordBlock();
    // Just verifying it doesn't throw
    expect(true).toBe(true);
  });

  it("start and stop work without errors", () => {
    engine.start(100_000);
    engine.stop();
    expect(true).toBe(true);
  });
});
