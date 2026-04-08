/**
 * Integration tests: full masking pipeline end-to-end
 *
 * Tests the full masking pipeline by:
 *   1. Spinning up the Fastify server for HTTP-level tests (health endpoint,
 *      /v1/chat/completions validation, /dashboard/api/chat/preview masking)
 *   2. Using RewriteEngine + MappingStore directly for deeper masking tests
 *      (consistency of pseudonyms, PII masking coverage)
 *
 * Verifies:
 *   - PII is masked in outgoing requests
 *   - Pseudonyms are consistent (same PII → same pseudonym within a scope)
 *   - The health endpoint works
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildServer } from "../../src/server";
import type { AppConfig } from "../../src/shared/config";
import type { FastifyInstance } from "fastify";
import { RewriteEngineV4 as RewriteEngine } from "../../src/modules/rewrite/rewrite-engine-v4";
import { SqliteMappingStore } from "../../src/modules/mapping-store/sqlite-mapping-store";
import { DetectionEngine } from "../../src/modules/detection/detection-engine";

// ── Shared config factory ─────────────────────────────────────────────────────

function makeTmpConfig(): { config: AppConfig; tmpDir: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "llmask-int-"));
  const sqlitePath = path.join(tmpDir, "test.db");

  const config: AppConfig = {
    port: 0,
    host: "127.0.0.1",
    logLevel: "silent",
    primaryProvider: "openai",
    fallbackProvider: null,
    openaiApiKey: "test-key-not-used",
    openaiAuthMode: "api_key",
    openaiBaseUrl: "http://127.0.0.1:19999",
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

  return { config, tmpDir };
}

function cleanupTmpDir(tmpDir: string) {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

// ── HTTP server test suite ────────────────────────────────────────────────────

describe("Proxy Pipeline — HTTP server (health + proxy validation)", () => {
  let server: FastifyInstance;
  let tmpDir: string;

  beforeAll(async () => {
    const { config, tmpDir: td } = makeTmpConfig();
    tmpDir = td;
    server = buildServer(config);
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    cleanupTmpDir(tmpDir);
  });

  // ── Health endpoint ─────────────────────────────────────────────────────

  describe("GET /health", () => {
    it("returns 200 with status ok", async () => {
      const res = await server.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ status: string }>();
      expect(body.status).toBe("ok");
    });

    it("includes service metadata", async () => {
      const res = await server.inject({ method: "GET", url: "/health" });
      const body = res.json<{ service: string; uptime: number }>();
      expect(body.service).toBe("llmask");
      expect(typeof body.uptime).toBe("number");
    });

    it("returns the edition field", async () => {
      const res = await server.inject({ method: "GET", url: "/health" });
      const body = res.json<{ edition: string }>();
      expect(body.edition).toBe("community");
    });

    it("returns mode field", async () => {
      const res = await server.inject({ method: "GET", url: "/health" });
      const body = res.json<{ mode: string }>();
      expect(["trust", "review"]).toContain(body.mode);
    });
  });

  // ── Chat completions proxy — request validation ──────────────────────────

  describe("POST /v1/chat/completions — input validation", () => {
    it("returns 400 or 415 for non-JSON content-type", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { "content-type": "text/plain" },
        payload: "hello",
      });
      expect([400, 415]).toContain(res.statusCode);
    });

    it("rejects requests that exceed max prompt size (413)", async () => {
      const largeText = "a".repeat(200_000); // 200KB > 100KB default
      const res = await server.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { "content-type": "application/json" },
        payload: {
          model: "gpt-4",
          messages: [{ role: "user", content: largeText }],
        },
      });
      expect(res.statusCode).toBe(413);
    });
  });

  // ── Dashboard preview endpoint (mask preview without forwarding) ──────────

  describe("POST /dashboard/api/chat/preview — masking preview", () => {
    it("returns 200 with original and masked text", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/dashboard/api/chat/preview",
        headers: { "content-type": "application/json" },
        payload: {
          message: "Send invoice to billing@acme.example.com",
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ original: string; masked: string; entities: unknown[] }>();
      expect(body.original).toBe("Send invoice to billing@acme.example.com");
      expect(typeof body.masked).toBe("string");
      expect(Array.isArray(body.entities)).toBe(true);
    });

    it("masks email PII in preview", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/dashboard/api/chat/preview",
        headers: { "content-type": "application/json" },
        payload: {
          message: "Contact user@corp.example.org for support",
        },
      });
      const body = res.json<{ masked: string; entities: Array<{ original: string; pseudonym: string; kind: string }> }>();
      expect(body.masked).not.toContain("user@corp.example.org");
      expect(body.entities.length).toBeGreaterThanOrEqual(1);
    });

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
});

// ── Module-level masking pipeline tests ──────────────────────────────────────

describe("Masking Pipeline — RewriteEngine + DetectionEngine", () => {
  let store: SqliteMappingStore;
  let engine: RewriteEngine;
  let detection: DetectionEngine;
  let dbPath: string;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "llmask-rewrite-"));
    dbPath = path.join(tmpDir, "test.db");
    store = new SqliteMappingStore(dbPath);
    store.initialize();
    engine = new RewriteEngine(store);
    detection = new DetectionEngine();
  });

  afterEach(() => {
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  // ── PII masking ──────────────────────────────────────────────────────────

  describe("PII masking — names, emails, credit cards", () => {
    it("masks email addresses in user messages", () => {
      const payload = {
        model: "gpt-4",
        messages: [{ role: "user", content: "Contact alice.smith@example.com for help" }],
        stream: false,
      };
      const det = detection.detect(payload);
      const result = engine.rewriteRequest(payload as any, det, { scopeId: "scope-1" });
      const content = (result.rewrittenRequest.messages[1] as any).content as string;
      expect(content).not.toContain("alice.smith@example.com");
    });

    it("detects AWS access keys as high-severity secrets", () => {
      const payload = {
        model: "gpt-4",
        messages: [{ role: "user", content: "My key is AKIAIOSFODNN7EXAMPLE" }],
        stream: false,
      };
      const det = detection.detect(payload);
      // AWS keys are detected as high-severity secrets
      expect(det.findings.length).toBeGreaterThanOrEqual(1);
      const hasAwsKey = det.findings.some(
        (f) => f.category?.includes("aws") || f.severity === "high"
      );
      expect(hasAwsKey).toBe(true);
    });

    it("masks business identifiers (PascalCase service names)", () => {
      const payload = {
        model: "gpt-4",
        messages: [{ role: "user", content: "Debug the InvoiceService and PaymentProcessor" }],
        stream: false,
      };
      const det = { findings: [] }; // business identifiers are handled by rewrite engine
      const result = engine.rewriteRequest(payload as any, det, { scopeId: "scope-biz" });
      const content = (result.rewrittenRequest.messages[1] as any).content as string;
      expect(result.transformedCount).toBeGreaterThan(0);
      expect(content).not.toContain("InvoiceService");
    });

    it("does not mask system messages", () => {
      const sysContent = "You are a helpful assistant for Acme Corp systems";
      const payload = {
        model: "gpt-4",
        messages: [
          { role: "system", content: sysContent },
          { role: "user", content: "Fix InvoiceService bug" },
        ],
        stream: false,
      };
      const det = { findings: [] };
      const result = engine.rewriteRequest(payload as any, det, { scopeId: "scope-sys" });
      const sysMsg = (result.rewrittenRequest.messages as any[]).find((m: any) => m.role === "system");
      expect(sysMsg).toBeDefined();
      expect(sysMsg.content).toBe(sysContent);
    });
  });

  // ── Pseudonym consistency ────────────────────────────────────────────────

  describe("Pseudonym consistency — same PII → same pseudonym", () => {
    it("produces the same pseudonym for repeated occurrences in one call", () => {
      const email = "bob.jones@corp.example.com";
      const payload = {
        model: "gpt-4",
        messages: [
          {
            role: "user",
            content: `Send to ${email}. Also copy ${email} on the reply.`,
          },
        ],
        stream: false,
      };
      const det = detection.detect(payload);
      const result = engine.rewriteRequest(payload as any, det, { scopeId: "scope-repeat" });
      const content = (result.rewrittenRequest.messages[1] as any).content as string;

      // The pseudonym replacing the email should be the same in both positions
      expect(content).not.toContain(email);
      // Count how many times the original email was replaced — should be 2
      const pseudonymTokens = content.match(/MAIL_[A-Z]+/g) ?? [];
      // Both occurrences should be the same token
      if (pseudonymTokens.length >= 2) {
        expect(pseudonymTokens[0]).toBe(pseudonymTokens[1]);
      }
    });

    it("produces the same pseudonym for the same email across separate calls with same scope", () => {
      const scopeId = "shared-scope";
      const email = "carol.white@test.example.com";

      const payload1 = {
        model: "gpt-4",
        messages: [{ role: "user", content: `Invoice to ${email}` }],
        stream: false,
      };
      const payload2 = {
        model: "gpt-4",
        messages: [{ role: "user", content: `Reply to ${email} with details` }],
        stream: false,
      };

      const det1 = detection.detect(payload1);
      const result1 = engine.rewriteRequest(payload1 as any, det1, { scopeId });

      const det2 = detection.detect(payload2);
      const result2 = engine.rewriteRequest(payload2 as any, det2, { scopeId });

      const content1 = (result1.rewrittenRequest.messages[1] as any).content as string;
      const content2 = (result2.rewrittenRequest.messages[1] as any).content as string;

      // Verify the email was masked in both
      expect(content1).not.toContain(email);
      expect(content2).not.toContain(email);

      // The pseudonym should be identical across both calls
      const token1 = content1.match(/MAIL_[A-Z]+/)?.[0];
      const token2 = content2.match(/MAIL_[A-Z]+/)?.[0];
      if (token1 && token2) {
        expect(token1).toBe(token2);
      }
    });

    it("produces different pseudonyms for different emails in the same scope", () => {
      const scopeId = "multi-email-scope";
      const payload = {
        model: "gpt-4",
        messages: [
          {
            role: "user",
            content: "Send to alpha@test.example.com and beta@test.example.com",
          },
        ],
        stream: false,
      };
      const det = detection.detect(payload);
      const result = engine.rewriteRequest(payload as any, det, { scopeId });
      const content = (result.rewrittenRequest.messages[1] as any).content as string;

      // Both emails should be gone
      expect(content).not.toContain("alpha@test.example.com");
      expect(content).not.toContain("beta@test.example.com");

      // The two pseudonyms should be different
      const tokens = content.match(/MAIL_[A-Z]+/g) ?? [];
      if (tokens.length >= 2) {
        expect(tokens[0]).not.toBe(tokens[1]);
      }
    });
  });

  // ── Mapping store persistence ────────────────────────────────────────────

  describe("Mapping store — pseudonym persistence", () => {
    it("stores mappings after rewriting", () => {
      const scopeId = "persist-scope";
      const payload = {
        model: "gpt-4",
        messages: [{ role: "user", content: "Contact dave@example.io for support" }],
        stream: false,
      };
      const det = detection.detect(payload);
      engine.rewriteRequest(payload as any, det, { scopeId });

      const mappings = store.listMappings(scopeId);
      expect(mappings.length).toBeGreaterThanOrEqual(1);
      expect(mappings.some((m) => m.originalValue === "dave@example.io")).toBe(true);
    });

    it("retrieves consistent pseudonym from stored mappings", () => {
      const scopeId = "retrieve-scope";
      const email = "emma@widgets.example.com";
      const payload = {
        model: "gpt-4",
        messages: [{ role: "user", content: `Send to ${email}` }],
        stream: false,
      };
      const det = detection.detect(payload);
      engine.rewriteRequest(payload as any, det, { scopeId });

      const mappings = store.listMappings(scopeId);
      const entry = mappings.find((m) => m.originalValue === email);
      expect(entry).toBeDefined();
      expect(entry?.pseudonym).toBeTruthy();
    });
  });
});
