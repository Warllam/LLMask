import { describe, it, expect, vi, beforeEach } from "vitest";
import { LlmEntityExtractor } from "../../src/modules/llm-extractor/llm-entity-extractor";
import { EntityCache } from "../../src/modules/llm-extractor/entity-cache";

describe("LlmEntityExtractor", () => {
  const baseConfig = {
    ollamaBaseUrl: "http://localhost:11434",
    model: "qwen2.5:3b",
    timeoutMs: 2000,
    enabled: true
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty when disabled", async () => {
    const extractor = new LlmEntityExtractor({ ...baseConfig, enabled: false });
    const result = await extractor.extract("PaymentService handles invoices");
    expect(result.entities).toEqual([]);
    expect(result.durationMs).toBe(0);
  });

  it("parses valid Ollama JSON array response", async () => {
    const mockResponse = [
      { name: "PaymentService", kind: "svc", reason: "internal service" },
      { name: "merchant_accounts", kind: "tbl", reason: "business table" }
    ];

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: JSON.stringify(mockResponse) })
    } as Response);

    const extractor = new LlmEntityExtractor(baseConfig);
    const result = await extractor.extract("PaymentService queries merchant_accounts");

    expect(result.entities).toHaveLength(2);
    expect(result.entities[0]).toEqual({ name: "PaymentService", kind: "svc", reason: "internal service" });
    expect(result.entities[1]).toEqual({ name: "merchant_accounts", kind: "tbl", reason: "business table" });
    expect(result.fromCache).toBe(false);
  });

  it("parses { entities: [...] } wrapper format", async () => {
    const mockResponse = {
      entities: [{ name: "InvoiceProcessor", kind: "svc", reason: "internal" }]
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: JSON.stringify(mockResponse) })
    } as Response);

    const extractor = new LlmEntityExtractor(baseConfig);
    const result = await extractor.extract("InvoiceProcessor runs daily");

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].name).toBe("InvoiceProcessor");
  });

  it("normalizes invalid kind to idn", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: JSON.stringify([{ name: "Foo", kind: "unknown_kind", reason: "" }]) })
    } as Response);

    const extractor = new LlmEntityExtractor(baseConfig);
    const result = await extractor.extract("Foo bar");

    expect(result.entities[0].kind).toBe("idn");
  });

  it("returns empty on invalid JSON from LLM", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: "this is not json at all" })
    } as Response);

    const extractor = new LlmEntityExtractor(baseConfig);
    const result = await extractor.extract("some text");

    expect(result.entities).toEqual([]);
  });

  it("returns empty on fetch failure (fail open)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("connection refused"));

    const extractor = new LlmEntityExtractor(baseConfig);
    const result = await extractor.extract("some text");

    expect(result.entities).toEqual([]);
  });

  it("returns empty on non-ok HTTP response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal server error"
    } as Response);

    const extractor = new LlmEntityExtractor(baseConfig);
    const result = await extractor.extract("some text");

    expect(result.entities).toEqual([]);
  });

  it("uses cache on second call with same text", async () => {
    const mockResponse = [{ name: "TestService", kind: "svc", reason: "test" }];

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ response: JSON.stringify(mockResponse) })
    } as Response);

    const cache = new EntityCache();
    const extractor = new LlmEntityExtractor(baseConfig, cache);

    const result1 = await extractor.extract("TestService does stuff");
    expect(result1.fromCache).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const result2 = await extractor.extract("TestService does stuff");
    expect(result2.fromCache).toBe(true);
    expect(result2.entities).toEqual(result1.entities);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // no second call
  });

  it("filters out entries with name shorter than 2 chars", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        response: JSON.stringify([
          { name: "A", kind: "idn", reason: "too short" },
          { name: "ValidName", kind: "svc", reason: "ok" }
        ])
      })
    } as Response);

    const extractor = new LlmEntityExtractor(baseConfig);
    const result = await extractor.extract("A and ValidName");

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].name).toBe("ValidName");
  });
});

describe("EntityCache", () => {
  it("stores and retrieves entities", () => {
    const cache = new EntityCache();
    const entities = [{ name: "Foo", kind: "svc" as const, reason: "test" }];

    cache.set("hello world", entities);
    expect(cache.get("hello world")).toEqual(entities);
    expect(cache.size).toBe(1);
  });

  it("returns null for unknown text", () => {
    const cache = new EntityCache();
    expect(cache.get("unknown")).toBeNull();
  });

  it("expires entries after TTL", () => {
    const cache = new EntityCache(100); // 100ms TTL
    const entities = [{ name: "Foo", kind: "svc" as const, reason: "test" }];

    cache.set("text", entities);
    expect(cache.get("text")).toEqual(entities);

    // Simulate TTL expiry by manipulating the internal cache
    const hash = Array.from((cache as any).cache.keys())[0];
    (cache as any).cache.get(hash).createdAt = Date.now() - 200;

    expect(cache.get("text")).toBeNull();
  });

  it("evicts oldest entry when at max capacity", () => {
    const cache = new EntityCache(60000, 2); // max 2 entries
    const e1 = [{ name: "A", kind: "svc" as const, reason: "" }];
    const e2 = [{ name: "B", kind: "svc" as const, reason: "" }];
    const e3 = [{ name: "C", kind: "svc" as const, reason: "" }];

    cache.set("text1", e1);
    cache.set("text2", e2);
    expect(cache.size).toBe(2);

    cache.set("text3", e3); // should evict text1
    expect(cache.size).toBe(2);
    expect(cache.get("text1")).toBeNull();
    expect(cache.get("text2")).toEqual(e2);
    expect(cache.get("text3")).toEqual(e3);
  });

  it("clears all entries", () => {
    const cache = new EntityCache();
    cache.set("a", []);
    cache.set("b", []);
    expect(cache.size).toBe(2);

    cache.clear();
    expect(cache.size).toBe(0);
  });
});
