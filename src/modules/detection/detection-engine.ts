import { SECRET_PATTERNS } from "./secret-patterns";
import { shannonEntropy } from "./entropy";

export type DetectionFinding = {
  category: string;
  severity: "low" | "medium" | "high";
  matchPreview: string;
};

export type DetectionResult = {
  findings: DetectionFinding[];
};

/**
 * Generic high-entropy detection in assignment contexts.
 * Matches patterns like: password="xK9f...", api_key: "abc123...", etc.
 */
const ASSIGNMENT_CONTEXT_RE =
  /(?:password|passwd|secret|token|apikey|api_key|auth_token|access_key|private_key|credential)\s*[:=]\s*["']([A-Za-z0-9/+=_.-]{8,})["']/gi;

const MIN_ENTROPY = 4.5;
const MIN_SECRET_LENGTH = 8;

export class DetectionEngine {
  detect(payload: unknown): DetectionResult {
    const serialized = JSON.stringify(payload);
    const findings: DetectionFinding[] = [];
    const seen = new Set<string>();

    // Pass 1: Run all categorized secret patterns
    for (const pattern of SECRET_PATTERNS) {
      // Reset regex state (global flag)
      pattern.regex.lastIndex = 0;

      for (const match of serialized.matchAll(pattern.regex)) {
        const preview = `${match[0].slice(0, 8)}...`;
        if (seen.has(preview)) continue;
        seen.add(preview);

        findings.push({
          category: `secret.${pattern.category}`,
          severity: pattern.severity,
          matchPreview: preview
        });
      }
    }

    // Pass 2: Generic entropy-based detection in assignment contexts
    for (const match of serialized.matchAll(ASSIGNMENT_CONTEXT_RE)) {
      const secretValue = match[1];
      if (secretValue.length < MIN_SECRET_LENGTH) continue;

      const entropy = shannonEntropy(secretValue);
      if (entropy < MIN_ENTROPY) continue;

      const preview = `${match[0].slice(0, 12)}...`;
      if (seen.has(preview)) continue;
      seen.add(preview);

      findings.push({
        category: "secret.generic.high_entropy",
        severity: "medium",
        matchPreview: preview
      });
    }

    return { findings };
  }
}
