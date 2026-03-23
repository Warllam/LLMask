import { describe, it, expect } from "vitest";
import { matchesOrigin, parseCorsConfig } from "../../../src/modules/security/cors";

describe("matchesOrigin", () => {
  it("matches exact origin", () => {
    expect(matchesOrigin("https://example.com", ["https://example.com"])).toBe(true);
  });

  it("rejects non-matching origin", () => {
    expect(matchesOrigin("https://evil.com", ["https://example.com"])).toBe(false);
  });

  it("allows wildcard *", () => {
    expect(matchesOrigin("https://anything.com", ["*"])).toBe(true);
  });

  it("matches glob patterns", () => {
    expect(matchesOrigin("http://localhost:3000", ["http://localhost:*"])).toBe(true);
    expect(matchesOrigin("http://localhost:8080", ["http://localhost:*"])).toBe(true);
    expect(matchesOrigin("http://example.com:3000", ["http://localhost:*"])).toBe(false);
  });

  it("returns false for empty list", () => {
    expect(matchesOrigin("https://x.com", [])).toBe(false);
  });
});

describe("parseCorsConfig", () => {
  it("parses CORS_ORIGIN", () => {
    const config = parseCorsConfig({ CORS_ORIGIN: "https://a.com,https://b.com" });
    expect(config.origins).toEqual(["https://a.com", "https://b.com"]);
  });

  it("defaults to * in non-production", () => {
    const config = parseCorsConfig({});
    expect(config.origins).toEqual(["*"]);
  });

  it("defaults to empty in production", () => {
    const config = parseCorsConfig({ NODE_ENV: "production" });
    expect(config.origins).toEqual([]);
  });

  it("parses credentials", () => {
    const config = parseCorsConfig({ CORS_CREDENTIALS: "true" });
    expect(config.credentials).toBe(true);
  });

  it("parses methods", () => {
    const config = parseCorsConfig({ CORS_METHODS: "GET,POST" });
    expect(config.methods).toEqual(["GET", "POST"]);
  });
});
