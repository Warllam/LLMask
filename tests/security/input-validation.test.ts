import { describe, it, expect } from "vitest";
import { sanitizeString, sanitizeBody, createChatCompletionSchema } from "../../../src/modules/security/input-validation";

describe("sanitizeString", () => {
  it("removes null bytes", () => {
    expect(sanitizeString("hello\x00world")).toBe("helloworld");
  });

  it("preserves newlines and tabs", () => {
    expect(sanitizeString("hello\n\tworld")).toBe("hello\n\tworld");
  });

  it("removes control chars", () => {
    expect(sanitizeString("a\x01b\x02c")).toBe("abc");
  });
});

describe("sanitizeBody", () => {
  it("deep-sanitizes objects", () => {
    const result = sanitizeBody({ msg: "hi\x00", nested: { val: "ok\x01" } });
    expect(result).toEqual({ msg: "hi", nested: { val: "ok" } });
  });

  it("handles arrays", () => {
    const result = sanitizeBody(["a\x00", "b\x01"]);
    expect(result).toEqual(["a", "b"]);
  });

  it("passes through numbers/booleans", () => {
    expect(sanitizeBody(42)).toBe(42);
    expect(sanitizeBody(true)).toBe(true);
    expect(sanitizeBody(null)).toBe(null);
  });
});

describe("createChatCompletionSchema", () => {
  const schema = createChatCompletionSchema({ maxPromptSize: 1024 });

  it("validates a correct request", () => {
    const result = schema.safeParse({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects disallowed model", () => {
    const result = schema.safeParse({
      model: "evil-model",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty messages", () => {
    const result = schema.safeParse({
      model: "gpt-4o",
      messages: [],
    });
    expect(result.success).toBe(false);
  });

  it("allows any model when allowAnyModel is true", () => {
    const permissive = createChatCompletionSchema({ maxPromptSize: 1024, allowAnyModel: true });
    const result = permissive.safeParse({
      model: "my-custom-model",
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(result.success).toBe(true);
  });

  it("validates temperature range", () => {
    const result = schema.safeParse({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
      temperature: 3,
    });
    expect(result.success).toBe(false);
  });
});
