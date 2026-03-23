import { describe, it, expect, beforeEach } from "vitest";
import {
  parseSecurityConfig,
  AdvancedRateLimiter,
  matchesOrigin,
  validatePromptSize,
  validateContentType,
} from "../../src/shared/security-middleware";

describe("parseSecurityConfig", () => {
  it("returns defaults with empty env", () => {
    const config = parseSecurityConfig({});
    expect(config.rateLimitMax).toBe(100);
    expect(config.rateLimitWindowMs).toBe(60000);
    expect(config.corsOrigins).toEqual(["*"]); // non-production default
    expect(config.maxPromptSize).toBe(102400);
    expect(config.cspEnabled).toBe(true);
  });

  it("parses env overrides", () => {
    const config = parseSecurityConfig({
      RATE_LIMIT_MAX: "50",
      RATE_LIMIT_WINDOW_MS: "30000",
      CORS_ORIGIN: "https://app.example.com",
      MAX_PROMPT_SIZE: "50000",
      CSP_ENABLED: "false",
      CORS_CREDENTIALS: "true",
    });
    expect(config.rateLimitMax).toBe(50);
    expect(config.rateLimitWindowMs).toBe(30000);
    expect(config.corsOrigins).toEqual(["https://app.example.com"]);
    expect(config.maxPromptSize).toBe(50000);
    expect(config.cspEnabled).toBe(false);
    expect(config.corsCredentials).toBe(true);
  });

  it("production mode defaults to empty cors origins", () => {
    const config = parseSecurityConfig({ NODE_ENV: "production" });
    expect(config.corsOrigins).toEqual([]);
  });
});

describe("AdvancedRateLimiter", () => {
  let limiter: AdvancedRateLimiter;

  beforeEach(() => {
    limiter = new AdvancedRateLimiter([
      { path: "/v1/chat/completions", limit: 3, windowMs: 60000 },
      { path: "/health", limit: 5, windowMs: 60000 },
    ]);
  });

  it("allows requests within limit", () => {
    const r1 = limiter.check("/v1/chat/completions", "1.2.3.4");
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);
  });

  it("blocks after exceeding limit", () => {
    for (let i = 0; i < 3; i++) {
      limiter.check("/v1/chat/completions", "1.2.3.4");
    }
    const r = limiter.check("/v1/chat/completions", "1.2.3.4");
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.resetMs).toBeGreaterThan(0);
  });

  it("tracks per-IP independently", () => {
    for (let i = 0; i < 3; i++) {
      limiter.check("/v1/chat/completions", "1.2.3.4");
    }
    const r = limiter.check("/v1/chat/completions", "5.6.7.8");
    expect(r.allowed).toBe(true);
  });

  it("tracks per-API-key when provided", () => {
    for (let i = 0; i < 3; i++) {
      limiter.check("/v1/chat/completions", "1.2.3.4", "key-a");
    }
    // Same IP, different key → allowed
    const r1 = limiter.check("/v1/chat/completions", "1.2.3.4", "key-b");
    expect(r1.allowed).toBe(true);

    // Same key, different IP → blocked
    const r2 = limiter.check("/v1/chat/completions", "9.9.9.9", "key-a");
    expect(r2.allowed).toBe(false);
  });

  it("allows unmatched paths", () => {
    const r = limiter.check("/unknown", "1.2.3.4");
    expect(r.allowed).toBe(true);
  });

  it("cleanup removes stale entries", () => {
    limiter.check("/v1/chat/completions", "1.2.3.4");
    limiter.cleanup();
    // Should not throw
  });
});

describe("matchesOrigin", () => {
  it("matches exact origin", () => {
    expect(matchesOrigin("https://app.example.com", ["https://app.example.com"])).toBe(true);
  });

  it("rejects non-matching origin", () => {
    expect(matchesOrigin("https://evil.com", ["https://app.example.com"])).toBe(false);
  });

  it("wildcard * matches all", () => {
    expect(matchesOrigin("https://anything.com", ["*"])).toBe(true);
  });

  it("wildcard pattern matches", () => {
    expect(matchesOrigin("http://localhost:3000", ["http://localhost:*"])).toBe(true);
    expect(matchesOrigin("http://localhost:8080", ["http://localhost:*"])).toBe(true);
  });

  it("wildcard subdomain matches", () => {
    expect(matchesOrigin("https://app.example.com", ["https://*.example.com"])).toBe(true);
    expect(matchesOrigin("https://evil.com", ["https://*.example.com"])).toBe(false);
  });
});

describe("validatePromptSize", () => {
  it("blocks oversized prompts", async () => {
    const validator = validatePromptSize(100);
    const longContent = "x".repeat(200);
    let blocked = false;
    const fakeRequest = {
      headers: { "content-type": "application/json" },
      body: { messages: [{ content: longContent }] },
    } as any;
    const fakeReply = {
      code: (c: number) => {
        if (c === 413) blocked = true;
        return { send: () => {} };
      },
    } as any;
    await validator(fakeRequest, fakeReply);
    expect(blocked).toBe(true);
  });

  it("allows normal prompts", async () => {
    const validator = validatePromptSize(1000);
    let blocked = false;
    const fakeRequest = {
      headers: { "content-type": "application/json" },
      body: { messages: [{ content: "hello" }] },
    } as any;
    const fakeReply = {
      code: (c: number) => {
        if (c === 413) blocked = true;
        return { send: () => {} };
      },
    } as any;
    await validator(fakeRequest, fakeReply);
    expect(blocked).toBe(false);
  });
});

describe("validateContentType", () => {
  it("blocks unsupported content types", async () => {
    const validator = validateContentType(["application/json"]);
    let statusCode = 0;
    const fakeRequest = {
      method: "POST",
      headers: { "content-type": "text/plain" },
    } as any;
    const fakeReply = {
      code: (c: number) => {
        statusCode = c;
        return { send: () => {} };
      },
    } as any;
    await validator(fakeRequest, fakeReply);
    expect(statusCode).toBe(415);
  });

  it("allows supported content types", async () => {
    const validator = validateContentType(["application/json"]);
    let statusCode = 0;
    const fakeRequest = {
      method: "POST",
      headers: { "content-type": "application/json" },
    } as any;
    const fakeReply = {
      code: (c: number) => {
        statusCode = c;
        return { send: () => {} };
      },
    } as any;
    await validator(fakeRequest, fakeReply);
    expect(statusCode).toBe(0); // no error
  });

  it("skips GET requests", async () => {
    const validator = validateContentType(["application/json"]);
    let statusCode = 0;
    const fakeRequest = {
      method: "GET",
      headers: {},
    } as any;
    const fakeReply = {
      code: (c: number) => {
        statusCode = c;
        return { send: () => {} };
      },
    } as any;
    await validator(fakeRequest, fakeReply);
    expect(statusCode).toBe(0);
  });
});
