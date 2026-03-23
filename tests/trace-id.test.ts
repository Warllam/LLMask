import { describe, it, expect } from "vitest";
import { getTraceId } from "../../src/shared/trace-id";

function mockRequest(overrides: {
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  id?: string;
}): any {
  return {
    headers: overrides.headers ?? {},
    body: overrides.body,
    id: overrides.id ?? "req-fallback-001"
  };
}

describe("getTraceId", () => {
  it("uses x-request-id header when present", () => {
    const req = mockRequest({ headers: { "x-request-id": "trace-from-header" } });
    expect(getTraceId(req)).toBe("trace-from-header");
  });

  it("ignores empty x-request-id header", () => {
    const req = mockRequest({
      headers: { "x-request-id": "  " },
      id: "fallback-id"
    });
    expect(getTraceId(req)).toBe("fallback-id");
  });

  it("derives session ID from first user message (Chat Completions)", () => {
    const req = mockRequest({
      body: {
        messages: [
          { role: "system", content: "You are helpful" },
          { role: "user", content: "Find the bug in InvoiceService" }
        ]
      }
    });
    const traceId = getTraceId(req);
    expect(traceId).toMatch(/^sess-[a-f0-9]{12}$/);
  });

  it("derives same session ID for same first user message", () => {
    const body = {
      messages: [
        { role: "user", content: "Find the bug" },
        { role: "assistant", content: "I'll look" },
        { role: "user", content: "Also check tests" }
      ]
    };
    const req1 = mockRequest({ body });
    const req2 = mockRequest({ body });
    expect(getTraceId(req1)).toBe(getTraceId(req2));
  });

  it("derives session ID from Responses API input", () => {
    const req = mockRequest({
      body: {
        input: [
          { role: "user", content: "Review this code" }
        ]
      }
    });
    const traceId = getTraceId(req);
    expect(traceId).toMatch(/^sess-[a-f0-9]{12}$/);
  });

  it("supports content as array of blocks", () => {
    const req = mockRequest({
      body: {
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Hello from block" }]
          }
        ]
      }
    });
    const traceId = getTraceId(req);
    expect(traceId).toMatch(/^sess-[a-f0-9]{12}$/);
  });

  it("falls back to request.id when no body", () => {
    const req = mockRequest({ id: "auto-id-42" });
    expect(getTraceId(req)).toBe("auto-id-42");
  });

  it("falls back to request.id when body has no messages", () => {
    const req = mockRequest({ body: { model: "gpt-4" }, id: "auto-id-99" });
    expect(getTraceId(req)).toBe("auto-id-99");
  });
});
