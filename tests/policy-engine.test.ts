import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../../src/modules/policy/policy-engine";
import type { DetectionResult } from "../../src/modules/detection/detection-engine";

describe("PolicyEngine", () => {
  const engine = new PolicyEngine();

  it("returns 'warn' for high severity findings (rewrite, no block)", () => {
    const detection: DetectionResult = {
      findings: [{ category: "secret.cloud.aws", severity: "high", matchPreview: "AKIAIOMX..." }]
    };
    const decision = engine.evaluate(detection);
    expect(decision.action).toBe("warn");
    expect(decision.reason).toContain("High-severity");
  });

  it("returns 'warn' for medium severity findings", () => {
    const detection: DetectionResult = {
      findings: [{ category: "secret.auth.jwt", severity: "medium", matchPreview: "eyJhbGci..." }]
    };
    const decision = engine.evaluate(detection);
    expect(decision.action).toBe("warn");
    expect(decision.reason).toContain("Medium-severity");
  });

  it("returns 'rewrite' when no findings", () => {
    const detection: DetectionResult = { findings: [] };
    const decision = engine.evaluate(detection);
    expect(decision.action).toBe("rewrite");
    expect(decision.reason).toContain("Default POC");
  });

  it("returns 'rewrite' for low severity only", () => {
    const detection: DetectionResult = {
      findings: [{ category: "secret.cloud.heroku", severity: "low", matchPreview: "abcdef12..." }]
    };
    const decision = engine.evaluate(detection);
    expect(decision.action).toBe("rewrite");
  });

  it("returns 'warn' when mixed high and medium findings", () => {
    const detection: DetectionResult = {
      findings: [
        { category: "secret.auth.jwt", severity: "medium", matchPreview: "eyJhbGci..." },
        { category: "secret.cloud.aws", severity: "high", matchPreview: "AKIAIOMX..." }
      ]
    };
    const decision = engine.evaluate(detection);
    expect(decision.action).toBe("warn");
  });
});
