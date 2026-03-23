import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Transform } from "node:stream";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ResponseRemapEngine } from "../../src/modules/remap/response-remap-engine";
import { SqliteMappingStore } from "../../src/modules/mapping-store/sqlite-mapping-store";

function collectStream(transform: Transform, chunks: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    let result = "";
    transform.on("data", (chunk: Buffer) => {
      result += chunk.toString("utf8");
    });
    transform.on("end", () => resolve(result));
    transform.on("error", reject);

    for (const chunk of chunks) {
      transform.write(Buffer.from(chunk, "utf8"));
    }
    transform.end();
  });
}

describe("ResponseRemapEngine", () => {
  let store: SqliteMappingStore;
  let engine: ResponseRemapEngine;
  let dbPath: string;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "llmask-remap-"));
    dbPath = path.join(tmpDir, "test.db");
    store = new SqliteMappingStore(dbPath);
    store.initialize();
    engine = new ResponseRemapEngine(store);
  });

  afterEach(() => {
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {}
  });

  describe("remapJsonResponse", () => {
    it("replaces pseudonyms with original values", () => {
      store.upsertMappings("scope-1", [
        { kind: "svc", originalValue: "InvoiceService", pseudonym: "svc_01" },
        { kind: "tbl", originalValue: "merchants", pseudonym: "tbl_01" }
      ]);

      const response = {
        choices: [{
          message: { role: "assistant", content: "The svc_01 uses tbl_01 table" }
        }]
      };

      const result = engine.remapJsonResponse(response, "scope-1") as any;
      expect(result.choices[0].message.content).toBe("The InvoiceService uses merchants table");
    });

    it("returns payload unchanged when no mappings", () => {
      const response = { choices: [{ message: { content: "Hello" } }] };
      const result = engine.remapJsonResponse(response, "scope-empty");
      expect(result).toEqual(response);
    });

    it("handles deeply nested objects", () => {
      store.upsertMappings("scope-deep", [
        { kind: "idn", originalValue: "calculateVat", pseudonym: "idn_01" }
      ]);

      const response = {
        nested: { deeper: { text: "Call idn_01 method" } }
      };

      const result = engine.remapJsonResponse(response, "scope-deep") as any;
      expect(result.nested.deeper.text).toBe("Call calculateVat method");
    });

    it("handles arrays", () => {
      store.upsertMappings("scope-arr", [
        { kind: "svc", originalValue: "PaymentService", pseudonym: "svc_01" }
      ]);

      const response = ["svc_01 is good", "svc_01 is fast"];
      const result = engine.remapJsonResponse(response, "scope-arr") as string[];
      expect(result[0]).toBe("PaymentService is good");
      expect(result[1]).toBe("PaymentService is fast");
    });

    it("replaces longest pseudonyms first (no substring conflicts)", () => {
      store.upsertMappings("scope-len", [
        { kind: "idn", originalValue: "short", pseudonym: "idn_1" },
        { kind: "idn", originalValue: "longIdentifier", pseudonym: "idn_10" }
      ]);

      const response = { text: "Use idn_10 not idn_1" };
      const result = engine.remapJsonResponse(response, "scope-len") as any;
      expect(result.text).toBe("Use longIdentifier not short");
    });
  });

  describe("createSseTransform", () => {
    it("replaces pseudonyms in SSE stream", async () => {
      store.upsertMappings("scope-sse", [
        { kind: "svc", originalValue: "InvoiceService", pseudonym: "svc_01" }
      ]);

      const transform = engine.createSseTransform("scope-sse");
      const result = await collectStream(transform, [
        'data: {"content":"The svc_01 class"}\n\n'
      ]);

      expect(result).toContain("InvoiceService");
    });

    it("handles pseudonym split across chunks", async () => {
      store.upsertMappings("scope-split", [
        { kind: "svc", originalValue: "InvoiceService", pseudonym: "svc_01" }
      ]);

      const transform = engine.createSseTransform("scope-split");
      const result = await collectStream(transform, [
        'data: {"content":"The sv',
        'c_01 class"}\n\n'
      ]);

      expect(result).toContain("InvoiceService");
    });

    it("passes through when no mappings", async () => {
      const transform = engine.createSseTransform("scope-none");
      const input = 'data: {"content":"hello"}\n\n';
      const result = await collectStream(transform, [input]);
      expect(result).toBe(input);
    });
  });

  describe("createEventLevelSseTransform", () => {
    it("remaps content delta events", async () => {
      store.upsertMappings("scope-evt", [
        { kind: "svc", originalValue: "PaymentGateway", pseudonym: "svc_01" }
      ]);

      const transform = engine.createEventLevelSseTransform("scope-evt");
      const events = [
        'data: {"choices":[{"delta":{"content":"The svc_01 handles payments"}}]}\n',
        'data: [DONE]\n'
      ];

      const result = await collectStream(transform, events);
      expect(result).toContain("PaymentGateway");
      expect(result).not.toContain("svc_01");
    });

    it("handles cross-event pseudonym splits (BPE tokenizer issue)", async () => {
      store.upsertMappings("scope-bpe", [
        { kind: "idn", originalValue: "calculateTotal", pseudonym: "idn_08" }
      ]);

      const transform = engine.createEventLevelSseTransform("scope-bpe");
      // Simulate BPE tokenizer splitting "idn_08" across events
      const events = [
        'data: {"choices":[{"delta":{"content":"Call idn"}}]}\n',
        'data: {"choices":[{"delta":{"content":"_08 method"}}]}\n',
        'data: [DONE]\n'
      ];

      const result = await collectStream(transform, events);
      expect(result).toContain("calculateTotal");
    });

    it("provides getCapturedText method", async () => {
      store.upsertMappings("scope-cap", [
        { kind: "svc", originalValue: "OrderService", pseudonym: "svc_01" }
      ]);

      const transform = engine.createEventLevelSseTransform("scope-cap");
      await collectStream(transform, [
        'data: {"choices":[{"delta":{"content":"The svc_01 is running"}}]}\n',
        'data: [DONE]\n'
      ]);

      const captured = transform.getCapturedText();
      expect(captured).toContain("OrderService");
    });

    it("deep remaps non-content events immediately", async () => {
      store.upsertMappings("scope-noncontent", [
        { kind: "svc", originalValue: "MyService", pseudonym: "svc_01" }
      ]);

      const transform = engine.createEventLevelSseTransform("scope-noncontent");
      const events = [
        'data: {"choices":[{"delta":{"role":"assistant"}}]}\n',
        'data: {"choices":[{"delta":{"content":"svc_01 works"}}]}\n',
        'data: [DONE]\n'
      ];

      const result = await collectStream(transform, events);
      expect(result).toContain("MyService");
    });
  });
});
