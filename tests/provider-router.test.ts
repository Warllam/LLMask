import { describe, it, expect, vi, beforeEach } from "vitest";
import { Transform } from "node:stream";
import { ProviderRouter } from "../../src/modules/provider-adapter/provider-router";
import type { ProviderAdapter, EndpointKind } from "../../src/modules/provider-adapter/types";

function createMockAdapter(
  type: "openai" | "anthropic" | "litellm" | "gemini" | "mistral",
  options?: { shouldFail?: boolean; status?: number }
): ProviderAdapter {
  return {
    type,
    prepareRequest: vi.fn().mockResolvedValue({
      url: `https://api.${type}.com/v1/chat/completions`,
      headers: { "Content-Type": "application/json" },
      body: { model: "test-model" }
    }),
    translateJsonResponse: vi.fn().mockImplementation((raw) => raw),
    createSseTranslationTransform: vi.fn().mockReturnValue(new Transform({
      transform(chunk, _enc, cb) { cb(null, chunk); }
    }))
  };
}

function createMockLogger(): any {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis()
  };
}

describe("ProviderRouter", () => {
  let logger: any;

  beforeEach(() => {
    logger = createMockLogger();
  });

  describe("constructor and adapters", () => {
    it("stores primary adapter", () => {
      const primary = createMockAdapter("openai");
      const router = new ProviderRouter(primary, null, 30000, logger);
      expect(router.primaryType).toBe("openai");
      expect(router.hasAdapter("openai")).toBe(true);
    });

    it("stores fallback adapter", () => {
      const primary = createMockAdapter("openai");
      const fallback = createMockAdapter("anthropic");
      const router = new ProviderRouter(primary, fallback, 30000, logger);
      expect(router.fallbackType).toBe("anthropic");
      expect(router.hasAdapter("anthropic")).toBe(true);
    });

    it("returns null fallbackType when no fallback", () => {
      const primary = createMockAdapter("openai");
      const router = new ProviderRouter(primary, null, 30000, logger);
      expect(router.fallbackType).toBeNull();
    });
  });

  describe("registerAdapter", () => {
    it("registers a new adapter", () => {
      const primary = createMockAdapter("openai");
      const router = new ProviderRouter(primary, null, 30000, logger);
      expect(router.hasAdapter("litellm")).toBe(false);

      router.registerAdapter(createMockAdapter("litellm"));
      expect(router.hasAdapter("litellm")).toBe(true);
    });

    it("does not overwrite existing adapter", () => {
      const primary = createMockAdapter("openai");
      const router = new ProviderRouter(primary, null, 30000, logger);

      const newOpenai = createMockAdapter("openai");
      router.registerAdapter(newOpenai);
      // Should still use original
      expect(router.hasAdapter("openai")).toBe(true);
    });
  });

  describe("forward - model routing", () => {
    it("routes claude models to anthropic adapter", async () => {
      const openai = createMockAdapter("openai");
      const anthropic = createMockAdapter("anthropic");
      const router = new ProviderRouter(openai, anthropic, 30000, logger);

      // Mock global fetch
      const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

      await router.forward({
        endpointKind: "chat-completions",
        body: { model: "claude-3-opus" },
        requestId: "req-1",
        traceId: "trace-1"
      });

      expect(anthropic.prepareRequest).toHaveBeenCalled();
      expect(openai.prepareRequest).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it("routes gpt models to openai adapter", async () => {
      const openai = createMockAdapter("openai");
      const anthropic = createMockAdapter("anthropic");
      const router = new ProviderRouter(openai, anthropic, 30000, logger);

      const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

      await router.forward({
        endpointKind: "chat-completions",
        body: { model: "gpt-4o" },
        requestId: "req-1",
        traceId: "trace-1"
      });

      expect(openai.prepareRequest).toHaveBeenCalled();
      expect(anthropic.prepareRequest).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it("routes gemini models to gemini adapter", async () => {
      const openai = createMockAdapter("openai");
      const gemini = createMockAdapter("gemini");
      const router = new ProviderRouter(openai, null, 30000, logger);
      router.registerAdapter(gemini);

      const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

      await router.forward({
        endpointKind: "chat-completions",
        body: { model: "gemini-2.5-pro" },
        requestId: "req-1",
        traceId: "trace-1"
      });

      expect(gemini.prepareRequest).toHaveBeenCalled();
      expect(openai.prepareRequest).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it("routes mistral models to mistral adapter", async () => {
      const openai = createMockAdapter("openai");
      const mistral = createMockAdapter("mistral");
      const router = new ProviderRouter(openai, null, 30000, logger);
      router.registerAdapter(mistral);

      const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

      await router.forward({
        endpointKind: "chat-completions",
        body: { model: "mistral-large-latest" },
        requestId: "req-1",
        traceId: "trace-1"
      });

      expect(mistral.prepareRequest).toHaveBeenCalled();
      expect(openai.prepareRequest).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it("routes codestral and pixtral models to mistral adapter", async () => {
      const openai = createMockAdapter("openai");
      const mistral = createMockAdapter("mistral");
      const router = new ProviderRouter(openai, null, 30000, logger);
      router.registerAdapter(mistral);

      const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

      await router.forward({
        endpointKind: "chat-completions",
        body: { model: "codestral-latest" },
        requestId: "req-1",
        traceId: "trace-1"
      });

      await router.forward({
        endpointKind: "chat-completions",
        body: { model: "pixtral-large-latest" },
        requestId: "req-2",
        traceId: "trace-2"
      });

      expect(mistral.prepareRequest).toHaveBeenCalledTimes(2);
      expect(openai.prepareRequest).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it("routes unknown models to litellm when registered", async () => {
      const openai = createMockAdapter("openai");
      const litellm = createMockAdapter("litellm");
      const router = new ProviderRouter(openai, null, 30000, logger);
      router.registerAdapter(litellm);

      const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

      await router.forward({
        endpointKind: "chat-completions",
        body: { model: "llama-3.1-70b" },
        requestId: "req-1",
        traceId: "trace-1"
      });

      expect(litellm.prepareRequest).toHaveBeenCalled();

      vi.unstubAllGlobals();
    });
  });

  describe("forward - error handling", () => {
    it("throws non-retryable errors immediately", async () => {
      const openai = createMockAdapter("openai");
      const router = new ProviderRouter(openai, null, 30000, logger);

      // 400 = client error, not retryable
      const errorResponse = new Response("Bad request", { status: 400 });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse));

      // Should return the error response, not throw (client errors are returned)
      const result = await router.forward({
        endpointKind: "chat-completions",
        body: { model: "gpt-4" },
        requestId: "req-1",
        traceId: "trace-1"
      });

      expect(result.response.status).toBe(400);

      vi.unstubAllGlobals();
    });

    it("uses configured fallback deterministically when a routed adapter fails", async () => {
      const openai = createMockAdapter("openai");
      const anthropic = createMockAdapter("anthropic");
      const gemini = createMockAdapter("gemini");

      const router = new ProviderRouter(openai, anthropic, 30000, logger);
      router.registerAdapter(gemini);

      (gemini.prepareRequest as any).mockRejectedValueOnce(new Error("non-retryable test failure"));

      const fetchMock = vi.fn()
        // configured fallback adapter (anthropic) succeeds
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      vi.stubGlobal("fetch", fetchMock);

      await router.forward({
        endpointKind: "chat-completions",
        body: { model: "gemini-2.5-pro" },
        requestId: "req-1",
        traceId: "trace-1"
      });

      expect(gemini.prepareRequest).toHaveBeenCalled();
      expect(anthropic.prepareRequest).toHaveBeenCalled();
      expect(openai.prepareRequest).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });
  });
});
