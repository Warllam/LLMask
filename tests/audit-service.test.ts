import { describe, it, expect, vi } from "vitest";
import { AuditService } from "../../src/modules/audit/audit-service";

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

describe("AuditService", () => {
  it("records event via logger.info", () => {
    const logger = createMockLogger();
    const audit = new AuditService(logger);

    audit.record({
      eventName: "llmask.proxy.request.received.v1",
      requestId: "req-1",
      traceId: "trace-1",
      data: { stream: true }
    });

    expect(logger.info).toHaveBeenCalledTimes(1);
    const [logObj, logMsg] = logger.info.mock.calls[0];
    expect(logObj.audit).toBe(true);
    expect(logObj.eventName).toBe("llmask.proxy.request.received.v1");
    expect(logObj.requestId).toBe("req-1");
    expect(logObj.data.stream).toBe(true);
    expect(logMsg).toBe("llmask.proxy.request.received.v1");
  });

  it("includes optional fields when provided", () => {
    const logger = createMockLogger();
    const audit = new AuditService(logger);

    audit.record({
      eventName: "llmask.policy.decision.made.v1",
      policyAction: "block",
      provider: "openai"
    });

    const [logObj] = logger.info.mock.calls[0];
    expect(logObj.policyAction).toBe("block");
    expect(logObj.provider).toBe("openai");
  });
});
