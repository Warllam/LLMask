import { describe, it, expect } from "vitest";
import { GeminiAdapter } from "../../src/modules/provider-adapter/gemini-adapter";

describe("GeminiAdapter", () => {
  const adapter = new GeminiAdapter({
    type: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKey: "test-gemini-key",
  });

  it("has type gemini", () => {
    expect(adapter.type).toBe("gemini");
  });

  describe("prepareRequest", () => {
    it("builds chat-completions URL with Bearer auth", () => {
      const result = adapter.prepareRequest("chat-completions", {
        model: "gemini-2.5-pro",
        messages: [{ role: "user", content: "hello" }],
      });

      expect(result).toEqual({
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-gemini-key",
        },
        body: {
          model: "gemini-2.5-pro",
          messages: [{ role: "user", content: "hello" }],
        },
      });
    });

    it("strips trailing slashes from baseUrl", () => {
      const a = new GeminiAdapter({
        type: "gemini",
        baseUrl: "https://example.com/v1beta/openai///",
        apiKey: "k",
      });
      const result = a.prepareRequest("chat-completions", { model: "gemini-2.5-flash" });
      expect(result.url).toBe("https://example.com/v1beta/openai/chat/completions");
    });

    it("defaults to official base URL when empty", () => {
      const a = new GeminiAdapter({ type: "gemini", baseUrl: "", apiKey: "k" });
      const result = a.prepareRequest("chat-completions", {});
      expect(result.url).toContain("generativelanguage.googleapis.com");
    });

    it("maps responses payload to chat/completions payload", () => {
      const result = adapter.prepareRequest("responses", {
        model: "gemini-2.5-pro",
        instructions: "system rule",
        input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
        max_output_tokens: 200,
      });

      expect(result.url).toMatch("/chat/completions");
      expect((result.body as any).messages[0]).toEqual({ role: "system", content: "system rule" });
      expect((result.body as any).messages[1]).toEqual({ role: "user", content: "hi" });
      expect((result.body as any).max_tokens).toBe(200);
    });
  });

  describe("translateJsonResponse", () => {
    it("passes through response unchanged (OpenAI-compatible)", () => {
      const raw = { id: "chatcmpl-123", choices: [{ message: { content: "hi" } }] };
      expect(adapter.translateJsonResponse(raw, "chat-completions")).toBe(raw);
    });

    it("maps chat-completions response back to responses format", () => {
      const translated = adapter.translateJsonResponse({
        id: "chatcmpl-123",
        model: "gemini-2.5-pro",
        choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      }, "responses") as any;

      expect(translated.object).toBe("response");
      expect(translated.output[0].content[0].text).toBe("hello");
      expect(translated.usage.input_tokens).toBe(10);
    });
  });

  describe("createSseTranslationTransform", () => {
    it("returns a passthrough transform", async () => {
      const transform = adapter.createSseTranslationTransform("chat-completions");
      const chunks: Buffer[] = [];

      const done = new Promise<void>((resolve) => {
        transform.on("data", (chunk: Buffer) => chunks.push(chunk));
        transform.on("end", () => resolve());
      });

      transform.write("data: test\n\n");
      transform.end();
      await done;
      expect(Buffer.concat(chunks).toString()).toBe("data: test\n\n");
    });
  });
});
