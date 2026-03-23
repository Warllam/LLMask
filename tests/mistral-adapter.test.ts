import { describe, it, expect } from "vitest";
import { MistralAdapter } from "../../src/modules/provider-adapter/mistral-adapter";

describe("MistralAdapter", () => {
  const adapter = new MistralAdapter({
    type: "mistral",
    baseUrl: "https://api.mistral.ai",
    apiKey: "test-mistral-key",
  });

  it("has type mistral", () => {
    expect(adapter.type).toBe("mistral");
  });

  describe("prepareRequest", () => {
    it("builds chat-completions URL with Bearer auth", () => {
      const result = adapter.prepareRequest("chat-completions", {
        model: "mistral-large-latest",
        messages: [{ role: "user", content: "hello" }],
      });

      expect(result).toEqual({
        url: "https://api.mistral.ai/v1/chat/completions",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-mistral-key",
        },
        body: {
          model: "mistral-large-latest",
          messages: [{ role: "user", content: "hello" }],
        },
      });
    });

    it("strips trailing slashes from baseUrl", () => {
      const a = new MistralAdapter({
        type: "mistral",
        baseUrl: "https://custom.mistral.ai///",
        apiKey: "k",
      });
      const result = a.prepareRequest("chat-completions", { model: "codestral" });
      expect(result.url).toBe("https://custom.mistral.ai/v1/chat/completions");
    });

    it("defaults to official base URL when empty", () => {
      const a = new MistralAdapter({ type: "mistral", baseUrl: "", apiKey: "k" });
      const result = a.prepareRequest("chat-completions", {});
      expect(result.url).toBe("https://api.mistral.ai/v1/chat/completions");
    });

    it("maps anthropic messages payload to chat/completions payload", () => {
      const result = adapter.prepareRequest("messages", {
        model: "mistral-large-latest",
        system: "system-msg",
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }]
      });

      expect(result.url).toMatch("/v1/chat/completions");
      expect((result.body as any).messages[0]).toEqual({ role: "system", content: "system-msg" });
      expect((result.body as any).messages[1]).toEqual({ role: "user", content: "hello" });
    });
  });

  describe("translateJsonResponse", () => {
    it("passes through response unchanged (OpenAI-compatible)", () => {
      const raw = { id: "cmpl-abc", choices: [{ message: { content: "bonjour" } }] };
      expect(adapter.translateJsonResponse(raw, "chat-completions")).toBe(raw);
    });

    it("maps chat response back to anthropic format for /messages", () => {
      const translated = adapter.translateJsonResponse({
        id: "cmpl-abc",
        model: "mistral-large-latest",
        choices: [{ message: { content: "bonjour" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 12, completion_tokens: 7 }
      }, "messages") as any;

      expect(translated.type).toBe("message");
      expect(translated.content[0].text).toBe("bonjour");
      expect(translated.usage.input_tokens).toBe(12);
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

      transform.write("data: {\"choices\":[]}\n\n");
      transform.end();
      await done;
      expect(Buffer.concat(chunks).toString()).toBe("data: {\"choices\":[]}\n\n");
    });
  });
});
