import { describe, it, expect } from "vitest";
import { chatCompletionsRequestSchema, responsesRequestSchema } from "../../src/contracts/openai";

describe("chatCompletionsRequestSchema", () => {
  it("parses valid request", () => {
    const result = chatCompletionsRequestSchema.parse({
      model: "gpt-4",
      messages: [{ role: "user", content: "Hello" }]
    });
    expect(result.model).toBe("gpt-4");
    expect(result.messages).toHaveLength(1);
    expect(result.stream).toBe(false);
  });

  it("defaults stream to false", () => {
    const result = chatCompletionsRequestSchema.parse({
      model: "gpt-4",
      messages: [{ role: "user" }]
    });
    expect(result.stream).toBe(false);
  });

  it("accepts stream = true", () => {
    const result = chatCompletionsRequestSchema.parse({
      model: "gpt-4",
      messages: [{ role: "user" }],
      stream: true
    });
    expect(result.stream).toBe(true);
  });

  it("passes through extra properties", () => {
    const result = chatCompletionsRequestSchema.parse({
      model: "gpt-4",
      messages: [{ role: "user" }],
      temperature: 0.7,
      max_tokens: 100
    });
    expect((result as any).temperature).toBe(0.7);
    expect((result as any).max_tokens).toBe(100);
  });

  it("rejects empty model", () => {
    expect(() =>
      chatCompletionsRequestSchema.parse({
        model: "",
        messages: [{ role: "user" }]
      })
    ).toThrow();
  });

  it("rejects empty messages", () => {
    expect(() =>
      chatCompletionsRequestSchema.parse({
        model: "gpt-4",
        messages: []
      })
    ).toThrow();
  });

  it("rejects missing messages", () => {
    expect(() =>
      chatCompletionsRequestSchema.parse({
        model: "gpt-4"
      })
    ).toThrow();
  });
});

describe("responsesRequestSchema", () => {
  it("parses valid request", () => {
    const result = responsesRequestSchema.parse({
      model: "o3",
      input: [{ role: "user", content: "Hello" }]
    });
    expect(result.model).toBe("o3");
    expect(result.stream).toBe(false);
  });

  it("passes through input and extra fields", () => {
    const result = responsesRequestSchema.parse({
      model: "o3",
      input: [{ role: "user" }],
      temperature: 0.5
    });
    expect((result as any).input).toBeDefined();
    expect((result as any).temperature).toBe(0.5);
  });

  it("rejects missing model", () => {
    expect(() => responsesRequestSchema.parse({})).toThrow();
  });
});
