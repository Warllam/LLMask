import type { DetectionResult } from "../detection/detection-engine";

export type PolicyAction = "shadow" | "rewrite" | "warn" | "block";

export type PolicyDecision = {
  action: PolicyAction;
  reason: string;
};

export class PolicyEngine {
  evaluate(detection: DetectionResult): PolicyDecision {
    if (detection.findings.some((finding) => finding.severity === "high")) {
      return {
        action: "warn",
        reason: "High-severity secret-like pattern detected — proceeding with rewrite"
      };
    }

    if (detection.findings.some((finding) => finding.severity === "medium")) {
      return {
        action: "warn",
        reason: "Medium-severity secret-like pattern detected — proceeding with rewrite"
      };
    }

    return {
      action: "rewrite",
      reason: "Default POC behavior"
    };
  }
}
