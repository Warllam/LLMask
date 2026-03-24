import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SqliteMappingStore } from "../src/modules/mapping-store/sqlite-mapping-store";

describe("SqliteMappingStore", () => {
  let store: SqliteMappingStore;
  let dbPath: string;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "llmask-test-"));
    dbPath = path.join(tmpDir, "test.db");
    store = new SqliteMappingStore(dbPath);
    store.initialize();
  });

  afterEach(() => {
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {}
  });

  describe("initialize", () => {
    it("creates database file", () => {
      expect(fs.existsSync(dbPath)).toBe(true);
    });

    it("can be called multiple times (idempotent)", () => {
      expect(() => store.initialize()).not.toThrow();
    });
  });

  describe("upsertMappings + listMappings", () => {
    it("inserts and retrieves mappings", () => {
      store.upsertMappings("scope-1", [
        { kind: "svc", originalValue: "InvoiceService", pseudonym: "svc_01" },
        { kind: "tbl", originalValue: "merchants", pseudonym: "tbl_01" }
      ]);

      const mappings = store.listMappings("scope-1");
      expect(mappings).toHaveLength(2);
      expect(mappings[0].originalValue).toBe("InvoiceService");
      expect(mappings[0].pseudonym).toBe("svc_01");
      expect(mappings[0].kind).toBe("svc");
      expect(mappings[0].scopeId).toBe("scope-1");
    });

    it("returns empty array for unknown scope", () => {
      expect(store.listMappings("unknown")).toHaveLength(0);
    });

    it("upserts on conflict (same originalValue)", () => {
      store.upsertMappings("scope-1", [
        { kind: "svc", originalValue: "InvoiceService", pseudonym: "svc_01" }
      ]);
      store.upsertMappings("scope-1", [
        { kind: "idn", originalValue: "InvoiceService", pseudonym: "idn_99" }
      ]);

      const mappings = store.listMappings("scope-1");
      expect(mappings).toHaveLength(1);
      expect(mappings[0].pseudonym).toBe("idn_99");
      expect(mappings[0].kind).toBe("idn");
    });

    it("handles empty entries array", () => {
      expect(() => store.upsertMappings("scope-1", [])).not.toThrow();
    });

    it("isolates scopes", () => {
      store.upsertMappings("scope-A", [
        { kind: "svc", originalValue: "ServiceA", pseudonym: "svc_01" }
      ]);
      store.upsertMappings("scope-B", [
        { kind: "svc", originalValue: "ServiceB", pseudonym: "svc_01" }
      ]);

      expect(store.listMappings("scope-A")).toHaveLength(1);
      expect(store.listMappings("scope-B")).toHaveLength(1);
      expect(store.listMappings("scope-A")[0].originalValue).toBe("ServiceA");
    });
  });

  describe("listScopes", () => {
    it("lists all scopes with counts", () => {
      store.upsertMappings("scope-1", [
        { kind: "svc", originalValue: "A", pseudonym: "svc_01" },
        { kind: "svc", originalValue: "B", pseudonym: "svc_02" }
      ]);
      store.upsertMappings("scope-2", [
        { kind: "tbl", originalValue: "C", pseudonym: "tbl_01" }
      ]);

      const scopes = store.listScopes();
      expect(scopes).toHaveLength(2);
      const scope1 = scopes.find(s => s.scopeId === "scope-1");
      expect(scope1?.entryCount).toBe(2);
    });
  });

  describe("listRecentMappings", () => {
    it("returns recent mappings with limit", () => {
      store.upsertMappings("scope-1", [
        { kind: "svc", originalValue: "A", pseudonym: "svc_01" },
        { kind: "svc", originalValue: "B", pseudonym: "svc_02" },
        { kind: "svc", originalValue: "C", pseudonym: "svc_03" }
      ]);

      const recent = store.listRecentMappings(2);
      expect(recent).toHaveLength(2);
    });
  });

  describe("request log", () => {
    it("inserts and retrieves request log", () => {
      const logId = store.insertRequestLog({
        traceId: "trace-1",
        requestId: "req-1",
        endpoint: "chat-completions",
        model: "gpt-4",
        originalBody: '{"messages":[]}',
        rewrittenBody: '{"messages":[]}',
        transformedCount: 5
      });

      expect(logId).toBeGreaterThan(0);

      const log = store.getRequestLog(logId);
      expect(log).not.toBeNull();
      expect(log!.traceId).toBe("trace-1");
      expect(log!.endpoint).toBe("chat-completions");
      expect(log!.model).toBe("gpt-4");
      expect(log!.transformedCount).toBe(5);
      expect(log!.responseBody).toBeNull();
    });

    it("returns null for unknown log id", () => {
      expect(store.getRequestLog(999)).toBeNull();
    });

    it("updates response body", () => {
      const logId = store.insertRequestLog({
        traceId: "trace-1",
        requestId: "req-1",
        endpoint: "chat-completions",
        model: "gpt-4",
        originalBody: "{}",
        rewrittenBody: "{}",
        transformedCount: 0
      });

      store.updateResponseBody(logId, "The assistant response text");
      const log = store.getRequestLog(logId);
      expect(log!.responseBody).toBe("The assistant response text");
    });

    it("lists request logs with limit", () => {
      for (let i = 0; i < 5; i++) {
        store.insertRequestLog({
          traceId: "trace-1",
          requestId: `req-${i}`,
          endpoint: "chat-completions",
          model: "gpt-4",
          originalBody: "{}",
          rewrittenBody: "{}",
          transformedCount: i
        });
      }

      const logs = store.listRequestLogs(3);
      expect(logs).toHaveLength(3);
    });
  });

  describe("sessions", () => {
    it("lists sessions grouped by traceId", () => {
      store.insertRequestLog({
        traceId: "trace-A",
        requestId: "req-1",
        endpoint: "chat-completions",
        model: "gpt-4",
        originalBody: JSON.stringify({ messages: [{ role: "user", content: "Hello" }] }),
        rewrittenBody: "{}",
        transformedCount: 2
      });
      store.insertRequestLog({
        traceId: "trace-A",
        requestId: "req-2",
        endpoint: "chat-completions",
        model: "gpt-4",
        originalBody: "{}",
        rewrittenBody: "{}",
        transformedCount: 3
      });

      const sessions = store.listSessions(10);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].traceId).toBe("trace-A");
      expect(sessions[0].requestCount).toBe(2);
      expect(sessions[0].totalTransforms).toBe(5);
    });

    it("lists request logs by traceId", () => {
      store.insertRequestLog({
        traceId: "trace-X",
        requestId: "req-1",
        endpoint: "responses",
        model: "o3",
        originalBody: "{}",
        rewrittenBody: "{}",
        transformedCount: 1
      });

      const logs = store.listRequestLogsByTraceId("trace-X");
      expect(logs).toHaveLength(1);
      expect(logs[0].endpoint).toBe("responses");
    });
  });

  describe("getStats", () => {
    it("returns aggregated stats", () => {
      store.upsertMappings("scope-1", [
        { kind: "svc", originalValue: "A", pseudonym: "svc_01" },
        { kind: "tbl", originalValue: "B", pseudonym: "tbl_01" },
        { kind: "svc", originalValue: "C", pseudonym: "svc_02" }
      ]);
      store.insertRequestLog({
        traceId: "t1",
        requestId: "r1",
        endpoint: "chat-completions",
        model: "gpt-4",
        originalBody: "{}",
        rewrittenBody: "{}",
        transformedCount: 10
      });

      const stats = store.getStats();
      expect(stats.totalMappings).toBe(3);
      expect(stats.totalRequests).toBe(1);
      expect(stats.totalTransforms).toBe(10);
      expect(stats.mappingsByKind.svc).toBe(2);
      expect(stats.mappingsByKind.tbl).toBe(1);
      expect(stats.requestsByEndpoint["chat-completions"]).toBe(1);
      expect(stats.topTokens.length).toBeGreaterThan(0);
    });

    it("returns zeros when empty", () => {
      const stats = store.getStats();
      expect(stats.totalMappings).toBe(0);
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalTransforms).toBe(0);
    });
  });
});
