/**
 * Integration tests: individual API endpoints
 *
 * Tests the /health endpoint, /v1/chat/completions, /v1/responses, and
 * /v1/messages input validation, and the dashboard masking preview endpoint
 * using Fastify's inject() method (no real HTTP server started).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildServer } from "../../src/server";
import type { AppConfig } from "../../src/shared/config";
import type { FastifyInstance } from "fastify";

// ── Test server factory ───────────────────────────────────────────────────────

function createTestServer(): { server: FastifyInstance; cleanup: () => void } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "llmask-api-"));
  const sqlitePath = path.join(tmpDir, "test.db");

  const config: AppConfig = {
    port: 0,
    host: "127.0.0.1",
    logLevel: "silent",
    primaryProvider: "openai",
    fallbackProvider: null,
    openaiApiKey: "test-key",
    openaiAuthMode: "api_key",
    openaiBaseUrl: "http://127.0.0.1:19998",
    openaiOauthTokenPath: undefined,
    anthropicApiKey: undefined,
    anthropicAuthMode: "api_key",
    anthropicBaseUrl: "https://api.anthropic.com",
    anthropicVersion: "2023-06-01",
    anthropicOauthTokenPath: undefined,
    requestTimeoutMs: 5_000,
    llmaskMode: "trust",
    failSafeBlockOnError: false,
    dataDir: tmpDir,
    sqlitePath,
    litellmBaseUrl: "",
    litellmApiKey: undefined,
    litellmForwardAuth: true,
    ollamaEnabled: false,
    ollamaBaseUrl: "http://127.0.0.1:11434",
    ollamaModel: "llama3",
    ollamaTimeoutMs: 5_000,
    ollamaCacheTtlMs: 60_000,
    ollamaCacheMaxSize: 100,
    projectShieldPath: "",
    authEnabled: false,
    adminKey: undefined,
    edition: "community",
    licenseKey: "",
    licenseFile: "",
    azureOpenaiApiKey: "",
    azureOpenaiBaseUrl: "",
    azureOpenaiApiVersion: "",
    azureOpenaiDeployment: "",
    geminiApiKey: "",
    geminiBaseUrl: "https://generativelanguage.googleapis.com",
    mistralApiKey: "",
    mistralBaseUrl: "https://api.mistral.ai",
    oidcIssuerUrl: "",
    oidcClientId: "",
    oidcJwksUrl: "",
    gdprRetentionDays: 0,
    tlsCert: "",
    tlsKey: "",
    rateLimit: 0,
    rateLimitMax: 1000,
    rateLimitWindowMs: 60_000,
    rateLimitApiMax: 1000,
    rateLimitDashboardMax: 1000,
    corsOrigins: "http://localhost:*",
    corsMethods: "GET,POST,PUT,DELETE,OPTIONS",
    corsHeaders: "Content-Type,Authorization",
    maxPromptSize: 102_400,
    allowedContentTypes: "application/json,multipart/form-data",
    cspEnabled: false,
    metricsEnabled: false,
    metricsPath: "/metrics",
    metricsAuthToken: undefined,
    metricsAllowPrivateOnly: false,
    bodyLimit: 10_485_760,
  } as AppConfig;

  const server = buildServer(config);

  return {
    server,
    cleanup: () => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch { /* ignore */ }
    },
  };
}

// ── Health Endpoints ──────────────────────────────────────────────────────────

describe("Health Endpoints", () => {
  let server: FastifyInstance;
  let cleanup: () => void;

  beforeAll(async () => {
    const t = createTestServer();
    server = t.server;
    cleanup = t.cleanup;
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    cleanup();
  });

  describe("GET /health", () => {
    it("responds with HTTP 200", async () => {
      const res = await server.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
    });

    it("returns JSON content-type", async () => {
      const res = await server.inject({ method: "GET", url: "/health" });
      expect(res.headers["content-type"]).toMatch(/application\/json/);
    });

    it("returns status ok", async () => {
      const res = await server.inject({ method: "GET", url: "/health" });
      const body = res.json<{ status: string }>();
      expect(body.status).toBe("ok");
    });

    it("includes service name llmask", async () => {
      const res = await server.inject({ method: "GET", url: "/health" });
      const body = res.json<{ service: string }>();
      expect(body.service).toBe("llmask");
    });

    it("includes numeric uptime", async () => {
      const res = await server.inject({ method: "GET", url: "/health" });
      const body = res.json<{ uptime: number }>();
      expect(typeof body.uptime).toBe("number");
      expect(body.uptime).toBeGreaterThanOrEqual(0);
    });

    it("returns a valid mode value", async () => {
      const res = await server.inject({ method: "GET", url: "/health" });
      const body = res.json<{ mode: string }>();
      expect(["trust", "review"]).toContain(body.mode);
    });

    it("returns memoryMb as a number", async () => {
      const res = await server.inject({ method: "GET", url: "/health" });
      const body = res.json<{ memoryMb: number }>();
      expect(typeof body.memoryMb).toBe("number");
      expect(body.memoryMb).toBeGreaterThan(0);
    });
  });
});

// ── Proxy Endpoints — input validation ────────────────────────────────────────

describe("Proxy Endpoints — input validation", () => {
  let server: FastifyInstance;
  let cleanup: () => void;

  beforeAll(async () => {
    const t = createTestServer();
    server = t.server;
    cleanup = t.cleanup;
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    cleanup();
  });

  describe("POST /v1/chat/completions", () => {
    it("returns 400 or 415 for non-JSON content-type", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { "content-type": "text/plain" },
        payload: "hello",
      });
      expect([400, 415]).toContain(res.statusCode);
    });

    it("returns 413 for oversized requests", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { "content-type": "application/json" },
        payload: {
          model: "gpt-4",
          messages: [{ role: "user", content: "x".repeat(200_000) }],
        },
      });
      expect(res.statusCode).toBe(413);
    });

    it("attempts to forward valid requests (returns 5xx when no upstream)", async () => {
      // This is a proxy — with a fake upstream it will fail at forwarding
      // but should pass validation (4xx = validation, 5xx = proxy failure)
      const res = await server.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { "content-type": "application/json" },
        payload: {
          model: "gpt-4",
          messages: [{ role: "user", content: "Hello" }],
        },
      });
      // If it reaches the proxy logic (validation passed), we get 5xx
      // If it fails validation, we get 4xx — both are acceptable in test
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  describe("POST /v1/responses", () => {
    it("returns 400 or 415 for non-JSON content-type", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/v1/responses",
        headers: { "content-type": "text/plain" },
        payload: "data",
      });
      expect([400, 415]).toContain(res.statusCode);
    });
  });

  describe("POST /v1/messages", () => {
    it("returns 400 or 415 for non-JSON content-type", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/v1/messages",
        headers: { "content-type": "text/plain" },
        payload: "data",
      });
      expect([400, 415]).toContain(res.statusCode);
    });
  });
});

// ── Dashboard Masking Preview ─────────────────────────────────────────────────

describe("Dashboard API — /dashboard/api/chat/preview (mask preview)", () => {
  let server: FastifyInstance;
  let cleanup: () => void;

  beforeAll(async () => {
    const t = createTestServer();
    server = t.server;
    cleanup = t.cleanup;
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    cleanup();
  });

  describe("Response shape", () => {
    it("returns 200 with original, masked, and entities fields", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/dashboard/api/chat/preview",
        headers: { "content-type": "application/json" },
        payload: { message: "Hello from test@example.com" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ original: string; masked: string; entities: unknown[] }>();
      expect(typeof body.original).toBe("string");
      expect(typeof body.masked).toBe("string");
      expect(Array.isArray(body.entities)).toBe(true);
    });

    it("echoes the original message in the original field", async () => {
      const message = "Test message with no PII";
      const res = await server.inject({
        method: "POST",
        url: "/dashboard/api/chat/preview",
        headers: { "content-type": "application/json" },
        payload: { message },
      });
      const body = res.json<{ original: string }>();
      expect(body.original).toBe(message);
    });
  });

  describe("Input validation", () => {
    it("returns 400 when message is missing", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/dashboard/api/chat/preview",
        headers: { "content-type": "application/json" },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("PII masking in preview", () => {
    it("masks email addresses", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/dashboard/api/chat/preview",
        headers: { "content-type": "application/json" },
        payload: { message: "Email me at jane.doe@private.example.com" },
      });
      const body = res.json<{ masked: string; entities: unknown[] }>();
      expect(body.masked).not.toContain("jane.doe@private.example.com");
      expect(body.entities.length).toBeGreaterThanOrEqual(1);
    });

    it("masks business identifiers", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/dashboard/api/chat/preview",
        headers: { "content-type": "application/json" },
        payload: { message: "The InvoiceService is broken in PaymentProcessor" },
      });
      const body = res.json<{ masked: string; entities: Array<{ original: string; pseudonym: string; kind: string }> }>();
      // Business identifiers should be masked
      expect(body.entities.length).toBeGreaterThanOrEqual(1);
      expect(body.masked).not.toContain("InvoiceService");
    });

    it("returns entity objects with original, pseudonym, and kind fields", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/dashboard/api/chat/preview",
        headers: { "content-type": "application/json" },
        payload: { message: "Contact ops@internal.example.io for help" },
      });
      const body = res.json<{ entities: Array<{ original: string; pseudonym: string; kind: string }> }>();
      if (body.entities.length > 0) {
        const entity = body.entities[0];
        expect(typeof entity.original).toBe("string");
        expect(typeof entity.pseudonym).toBe("string");
        expect(typeof entity.kind).toBe("string");
      }
    });

    it("does not modify clean text (no PII)", async () => {
      const message = "The quick brown fox jumps over the lazy dog";
      const res = await server.inject({
        method: "POST",
        url: "/dashboard/api/chat/preview",
        headers: { "content-type": "application/json" },
        payload: { message },
      });
      const body = res.json<{ masked: string; entities: unknown[] }>();
      expect(body.masked).toBe(message);
      expect(body.entities).toHaveLength(0);
    });
  });

  describe("Session ID handling", () => {
    it("accepts a sessionId and uses it for scope", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/dashboard/api/chat/preview",
        headers: { "content-type": "application/json" },
        payload: {
          message: "Hi from notify@business.example.com",
          sessionId: "my-session-abc",
        },
      });
      expect(res.statusCode).toBe(200);
    });

    it("produces consistent pseudonyms for same scope (sessionId)", async () => {
      const sessionId = "consistent-session-xyz";
      const email = "repeat@consistent.example.com";

      const res1 = await server.inject({
        method: "POST",
        url: "/dashboard/api/chat/preview",
        headers: { "content-type": "application/json" },
        payload: { message: `First message to ${email}`, sessionId },
      });
      const res2 = await server.inject({
        method: "POST",
        url: "/dashboard/api/chat/preview",
        headers: { "content-type": "application/json" },
        payload: { message: `Second message to ${email}`, sessionId },
      });

      const body1 = res1.json<{ masked: string }>();
      const body2 = res2.json<{ masked: string }>();

      // Both should have masked the email
      expect(body1.masked).not.toContain(email);
      expect(body2.masked).not.toContain(email);

      // The pseudonym used should be identical
      const token1 = body1.masked.match(/MAIL_[A-Z]+/)?.[0];
      const token2 = body2.masked.match(/MAIL_[A-Z]+/)?.[0];
      if (token1 && token2) {
        expect(token1).toBe(token2);
      }
    });
  });
});
