import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SlidingWindowRateLimiter, hashKey, extractKey, resolveLimit } from "../../src/modules/security/rate-limiter";

describe("SlidingWindowRateLimiter", () => {
  let limiter: SlidingWindowRateLimiter;

  beforeEach(() => {
    limiter = new SlidingWindowRateLimiter(60_000);
  });

  afterEach(() => {
    limiter.stopAutoCleanup();
  });

  it("allows requests under limit", () => {
    const r = limiter.check("ip:1.2.3.4", 5);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(4);
  });

  it("blocks requests over limit", () => {
    for (let i = 0; i < 3; i++) limiter.check("ip:test", 3);
    const r = limiter.check("ip:test", 3);
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.resetMs).toBeGreaterThan(0);
  });

  it("allows unlimited when limit <= 0", () => {
    const r = limiter.check("key", 0);
    expect(r.allowed).toBe(true);
  });

  it("cleans up expired entries", () => {
    vi.useFakeTimers();
    limiter.check("ip:old", 10);
    expect(limiter.size).toBe(1);
    vi.advanceTimersByTime(61_000);
    limiter.cleanup();
    expect(limiter.size).toBe(0);
    vi.useRealTimers();
  });

  it("separates keys", () => {
    for (let i = 0; i < 3; i++) limiter.check("ip:a", 3);
    const r = limiter.check("ip:b", 3);
    expect(r.allowed).toBe(true);
  });
});

describe("hashKey", () => {
  it("returns consistent 16-char hex", () => {
    const h = hashKey("test-key");
    expect(h).toHaveLength(16);
    expect(hashKey("test-key")).toBe(h);
  });
});

describe("extractKey", () => {
  it("extracts from x-llmask-key", () => {
    const req = { headers: { "x-llmask-key": "abc" }, ip: "1.2.3.4" } as any;
    const { key, isApiKey } = extractKey(req);
    expect(isApiKey).toBe(true);
    expect(key).toContain("apikey:");
  });

  it("falls back to IP", () => {
    const req = { headers: {}, ip: "1.2.3.4" } as any;
    const { key, isApiKey } = extractKey(req);
    expect(isApiKey).toBe(false);
    expect(key).toBe("ip:1.2.3.4");
  });

  it("extracts from Authorization Bearer", () => {
    const req = { headers: { authorization: "Bearer my-token" }, ip: "1.1.1.1" } as any;
    const { isApiKey } = extractKey(req);
    expect(isApiKey).toBe(true);
  });
});

describe("resolveLimit", () => {
  it("matches route prefix", () => {
    const limits = { "/v1/chat": 30, "/dashboard": 120 };
    expect(resolveLimit("/v1/chat/completions", limits, 60)).toBe(30);
    expect(resolveLimit("/dashboard/stats", limits, 60)).toBe(120);
    expect(resolveLimit("/health", limits, 60)).toBe(60);
  });
});
