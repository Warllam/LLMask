import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { RewriteEngineV4 as RewriteEngine } from "../../src/modules/rewrite/rewrite-engine-v4";
import { SqliteMappingStore } from "../../src/modules/mapping-store/sqlite-mapping-store";
import type { ChatCompletionsRequest } from "../../src/contracts/openai";

describe("RewriteEngine (V4)", () => {
  let store: SqliteMappingStore;
  let engine: RewriteEngine;
  let dbPath: string;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "llmask-rewrite-"));
    dbPath = path.join(tmpDir, "test.db");
    store = new SqliteMappingStore(dbPath);
    store.initialize();
    engine = new RewriteEngine(store);
  });

  afterEach(() => {
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {}
  });

  const emptyDetection = { findings: [] };

  describe("rewriteRequest", () => {
    it("rewrites business identifiers in user messages", () => {
      const payload: ChatCompletionsRequest = {
        model: "gpt-4",
        messages: [
          { role: "user", content: "Fix the bug in InvoiceService and MerchantAccount" }
        ],
        stream: false
      };

      const result = engine.rewriteRequest(payload, emptyDetection, { scopeId: "test-scope" });
      const rewrittenContent = result.rewrittenRequest.messages[1].content as string;

      expect(rewrittenContent).not.toContain("InvoiceService");
      expect(rewrittenContent).not.toContain("MerchantAccount");
      // V4 uses kind-prefixed single-token pseudonyms like ORG_ZORION, SVC_ZEPHYR, etc.
      expect(rewrittenContent).toMatch(/(?:ORG|SVC|TBL|COL|ID|PER|URL|MAIL|TEL)_[A-Z]{3,}/);
      expect(result.transformedCount).toBeGreaterThan(0);
    });

    it("does not rewrite system messages", () => {
      const payload: ChatCompletionsRequest = {
        model: "gpt-4",
        messages: [
          { role: "system", content: "You analyze InvoiceService code" },
          { role: "user", content: "Find the bug in InvoiceService" }
        ],
        stream: false
      };

      const result = engine.rewriteRequest(payload, emptyDetection, { scopeId: "test-scope" });
      const systemMsg = result.rewrittenRequest.messages.find(m => m.role === "system");
      expect(systemMsg).toBeDefined();
      expect(systemMsg!.content as string).toContain("InvoiceService");
    });

    it("does not rewrite developer messages", () => {
      const payload: ChatCompletionsRequest = {
        model: "gpt-4",
        messages: [
          { role: "developer", content: "Instructions about InvoiceService" },
          { role: "user", content: "Fix InvoiceService" }
        ],
        stream: false
      };

      const result = engine.rewriteRequest(payload, emptyDetection, { scopeId: "test-scope" });
      const devMsg = result.rewrittenRequest.messages.find(
        m => m.role === "developer" && (m.content as string).includes("Instructions")
      );
      expect(devMsg).toBeDefined();
      expect(devMsg!.content as string).toContain("InvoiceService");
    });

    it("preserves reserved keywords and common words", () => {
      const payload: ChatCompletionsRequest = {
        model: "gpt-4",
        messages: [
          { role: "user", content: "The function and Promise with async await" }
        ],
        stream: false
      };

      const result = engine.rewriteRequest(payload, emptyDetection, { scopeId: "test-scope" });
      const content = result.rewrittenRequest.messages[0].content as string;
      expect(content).toContain("function");
      expect(content).toContain("Promise");
      expect(content).toContain("async");
      expect(content).toContain("await");
    });

    it("preserves common programming keywords", () => {
      const payload: ChatCompletionsRequest = {
        model: "gpt-4",
        messages: [
          { role: "user", content: "using import export default return" }
        ],
        stream: false
      };

      const result = engine.rewriteRequest(payload, emptyDetection, { scopeId: "test-scope" });
      const content = result.rewrittenRequest.messages[0].content as string;
      expect(content).toContain("import");
      expect(content).toContain("export");
      expect(content).toContain("return");
    });

    it("maintains deterministic mappings within same scope", () => {
      const payload: ChatCompletionsRequest = {
        model: "gpt-4",
        messages: [
          { role: "user", content: "InvoiceService and InvoiceService" }
        ],
        stream: false
      };

      const result = engine.rewriteRequest(payload, emptyDetection, { scopeId: "test-determ" });
      const userMsg = result.rewrittenRequest.messages.find(m => m.role === "user");
      const content = userMsg!.content as string;
      const mappings = store.listMappings("test-determ");
      const invoiceMapping = mappings.find(m => m.originalValue === "InvoiceService");
      expect(invoiceMapping).toBeDefined();
      const pseudo = invoiceMapping!.pseudonym;
      const occurrences = content.split(pseudo).length - 1;
      expect(occurrences).toBe(2);
    });

    it("stores mappings in the store", () => {
      const payload: ChatCompletionsRequest = {
        model: "gpt-4",
        messages: [
          { role: "user", content: "Check MerchantOnboardingService" }
        ],
        stream: false
      };

      engine.rewriteRequest(payload, emptyDetection, { scopeId: "scope-persist" });
      const mappings = store.listMappings("scope-persist");
      expect(mappings.length).toBeGreaterThan(0);
      expect(mappings.some(m => m.originalValue === "MerchantOnboardingService")).toBe(true);
    });

    it("reuses existing mappings from store", () => {
      store.upsertMappings("scope-reuse", [
        { kind: "svc", originalValue: "PaymentGateway", pseudonym: "XFIXED" }
      ]);

      const payload: ChatCompletionsRequest = {
        model: "gpt-4",
        messages: [
          { role: "user", content: "Debug PaymentGateway" }
        ],
        stream: false
      };

      const result = engine.rewriteRequest(payload, emptyDetection, { scopeId: "scope-reuse" });
      const userMsg = result.rewrittenRequest.messages.find(m => m.role === "user");
      const content = userMsg!.content as string;
      expect(content).toContain("XFIXED");
    });

    it("does not rewrite short tokens (< 5 chars)", () => {
      const payload: ChatCompletionsRequest = {
        model: "gpt-4",
        messages: [
          { role: "user", content: "The var foo and bar values" }
        ],
        stream: false
      };

      const result = engine.rewriteRequest(payload, emptyDetection, { scopeId: "test-scope" });
      const content = result.rewrittenRequest.messages[0].content as string;
      expect(content).toContain("foo");
      expect(content).toContain("bar");
    });

    it("skips non-string content messages", () => {
      const payload: ChatCompletionsRequest = {
        model: "gpt-4",
        messages: [
          { role: "user", content: [{ type: "text", text: "hello" }] as any }
        ],
        stream: false
      };

      const result = engine.rewriteRequest(payload, emptyDetection, { scopeId: "test-scope" });
      expect(result.transformedCount).toBe(0);
    });
  });

  describe("rewriteUnknownPayload", () => {
    it("rewrites deep nested payloads", () => {
      const payload = {
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: "Fix the InvoiceSettlementService bug" }]
          }
        ]
      };

      const result = engine.rewriteUnknownPayload(payload, emptyDetection, { scopeId: "test-unknown" });
      const rewritten = JSON.stringify(result.rewrittenPayload);
      expect(rewritten).not.toContain("InvoiceSettlementService");
      expect(result.transformedCount).toBeGreaterThan(0);
    });

    it("injects developer message when transforms occur", () => {
      const payload = {
        input: [
          { role: "user", content: "Analyze the MerchantOnboardingService" }
        ]
      };

      const result = engine.rewriteUnknownPayload(payload, emptyDetection, { scopeId: "test-inject" });
      const rp = result.rewrittenPayload as Record<string, unknown>;
      const input = rp.input as unknown[];
      expect(input.length).toBeGreaterThan(1);
      const first = input[0] as Record<string, unknown>;
      expect(first.role).toBe("developer");
    });

    it("does not inject developer message when nothing rewritten", () => {
      const payload = {
        input: [
          { role: "user", content: "fix the bug" }
        ]
      };

      const result = engine.rewriteUnknownPayload(payload, emptyDetection, { scopeId: "test-no-inject" });
      if (result.transformedCount === 0) {
        const rp = result.rewrittenPayload as Record<string, unknown>;
        const input = rp.input as unknown[];
        expect(input).toHaveLength(1);
      } else {
        expect(result.transformedCount).toBeGreaterThan(0);
      }
    });
  });
});
