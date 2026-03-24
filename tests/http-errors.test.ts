import { describe, it, expect } from "vitest";
import { openAiError } from "../src/shared/http-errors";

describe("openAiError", () => {
  it("creates error with status code and message", () => {
    const result = openAiError(400, "Bad request", "invalid_request_error");
    expect(result.statusCode).toBe(400);
    expect(result.body.error.message).toBe("Bad request");
    expect(result.body.error.type).toBe("invalid_request_error");
    expect(result.body.error.code).toBeUndefined();
  });

  it("includes optional code", () => {
    const result = openAiError(403, "Blocked", "access_error", "POLICY_BLOCKED");
    expect(result.statusCode).toBe(403);
    expect(result.body.error.code).toBe("POLICY_BLOCKED");
  });

  it("creates 502 server error", () => {
    const result = openAiError(502, "Upstream error", "server_error", "LLMASK_FAIL_SAFE");
    expect(result.statusCode).toBe(502);
    expect(result.body.error.type).toBe("server_error");
  });
});
