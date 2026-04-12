/**
 * LLMask Masking Engine — Real-world Benchmark Demo
 *
 * Runs the masking engine against realistic sample projects containing
 * hardcoded secrets, PII, and internal infrastructure references.
 *
 * Strategies tested:
 *   aggressive   — Full NER + PII + secrets: masks identifiers, names, endpoints, everything
 *   code-aware   — Secrets (regex+entropy) + PII only, preserves code structure/identifiers
 *   values-only  — Regex: replaces only string literal values in credential assignment contexts
 *   pii-only     — Only PII: emails, phone numbers, person names (FR)
 *
 * Usage:  npx tsx tests/masking-demo.ts
 */

import path from "node:path";
import fs from "node:fs";
import { InMemoryMappingStore } from "../src/modules/mapping-store/in-memory-mapping-store";
import { RewriteEngineV4 } from "../src/modules/rewrite/rewrite-engine-v4";
import { DetectionEngine } from "../src/modules/detection/detection-engine";
import { detectPii } from "../src/modules/detection/pii-patterns";
import type { ChatCompletionsRequest } from "../src/contracts/openai";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Strategy = "aggressive" | "code-aware" | "values-only" | "pii-only";

interface MaskResult {
  original: string;
  masked: string;
  transformedCount: number;
  detectedCount: number;
  preservedCount: number;
}

interface FileResult {
  project: string;
  file: string;
  strategy: Strategy;
  result: MaskResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy: aggressive — full engine (NER + PII + secrets + entropy)
// ─────────────────────────────────────────────────────────────────────────────

function maskAggressive(content: string, scopeId: string): MaskResult {
  const store = new InMemoryMappingStore();
  store.initialize();
  const engine = new RewriteEngineV4(store);
  const detector = new DetectionEngine();

  const payload: ChatCompletionsRequest = {
    model: "gpt-4o",
    messages: [{ role: "user", content }],
  };

  const detection = detector.detect(payload);
  const piiMatches = detectPii(content);
  const detectedCount = detection.findings.length + piiMatches.length;

  const result = engine.rewriteRequest(payload, detection, { scopeId });

  // The engine may prepend a developer hint message; find the user message
  const userMsg = result.rewrittenRequest.messages.find((m) => m.role === "user");
  const masked = typeof userMsg?.content === "string" ? userMsg.content : content;

  return {
    original: content,
    masked,
    transformedCount: result.transformedCount,
    detectedCount,
    preservedCount: Math.max(0, detectedCount - result.transformedCount),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy: code-aware — secret patterns + PII, no code-identifier masking
// Preserves function names, class names, variable names; replaces only values
// ─────────────────────────────────────────────────────────────────────────────

// Matches: key = "value", key: "value", key: 'value', KEY=value (env files)
const SECRET_ASSIGNMENT_RE =
  /(?<key>(?:password|passwd|secret|token|api_key|apikey|api[_-]?secret|access_key|secret_access_key|private_key|credential|auth_token|webhook|jwt|signing_key|encryption_key|client_secret|app_secret|master_key|hmac|db_pass(?:word)?|database_url|mongodb[_-]?uri|redis[_-]?url|dsn|connection_string|slack|stripe|sendgrid|firebase|amplitude|mixpanel|segment|onesignal|sentry|launchdarkly|monitoring_api|pagerduty)\s*[:=]\s*["']?)([^"'\n]{6,})["']?/gi;

// Also catch URLs with embedded credentials
const CREDENTIAL_URL_RE = /(?:postgres|mysql|mongodb|redis):\/\/[^@\s"']+:[^@\s"']+@[^\s"']+/gi;

function maskCodeAware(content: string): MaskResult {
  const detector = new DetectionEngine();
  const piiMatches = detectPii(content);

  const payload: ChatCompletionsRequest = {
    model: "gpt-4o",
    messages: [{ role: "user", content }],
  };
  const detection = detector.detect(payload);
  const detectedCount = detection.findings.length + piiMatches.length;

  let masked = content;
  let transformedCount = 0;

  // Replace credential-bearing URLs (postgres://user:pass@host...)
  masked = masked.replace(CREDENTIAL_URL_RE, (match) => {
    transformedCount++;
    return match.replace(
      /(:\/\/[^@\s"']+:)([^@\s"']+)(@)/,
      "://$1[CREDENTIAL_REDACTED]$3"
    );
  });

  // Replace secret assignment values
  const seen = new Set<string>();
  masked = masked.replace(SECRET_ASSIGNMENT_RE, (match, _key, value) => {
    const v = String(value).trim().replace(/["']/g, "");
    if (v.length < 6 || seen.has(v)) return match;
    seen.add(v);
    transformedCount++;
    return match.replace(v, "[SECRET_REDACTED]");
  });

  // Replace PII matches (in reverse index order to preserve positions)
  const sortedPii = [...piiMatches].sort((a, b) => b.index - a.index);
  for (const m of sortedPii) {
    const prefix = m.kind === "email" ? "MAIL" : m.kind === "phone" ? "TEL" : "PER";
    masked =
      masked.slice(0, m.index) +
      `[${prefix}_REDACTED]` +
      masked.slice(m.index + m.value.length);
    transformedCount++;
  }

  return {
    original: content,
    masked,
    transformedCount,
    detectedCount,
    preservedCount: Math.max(0, detectedCount - transformedCount),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy: values-only — only string literal values in assignment contexts
// No NER, no PII. Purely structural: finds key="value" and hides the value.
// ─────────────────────────────────────────────────────────────────────────────

// Broad assignment value matcher: any quoted string value in a key=value context
const ANY_ASSIGNMENT_VALUE_RE =
  /(?<=(?:password|passwd|secret|token|api[_-]?key|access_key|secret_key|private_key|credential|auth_token|webhook|jwt|signing|encryption_key|client_secret|app_secret|hmac|db_pass(?:word)?)\s*[:=]\s*)["']([^"'\n]{4,})["']/gi;

// Env file values: KEY=value (no quotes)
const ENV_VALUE_RE =
  /^((?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|ACCESS_KEY|SECRET_KEY|PRIVATE_KEY|AUTH_TOKEN|WEBHOOK|JWT|DB_PASS(?:WORD)?|DATABASE_URL|REDIS_URL|MONGODB_URI|STRIPE|SENDGRID|AWS_SECRET|SLACK)[^\n=]*)=([^\n#]{4,})/gm;

function maskValuesOnly(content: string): MaskResult {
  const detector = new DetectionEngine();
  const payload: ChatCompletionsRequest = {
    model: "gpt-4o",
    messages: [{ role: "user", content }],
  };
  const detection = detector.detect(payload);
  const piiMatches = detectPii(content);
  const detectedCount = detection.findings.length + piiMatches.length;

  let masked = content;
  let transformedCount = 0;

  // Replace quoted values in assignment contexts
  masked = masked.replace(ANY_ASSIGNMENT_VALUE_RE, (_match, value) => {
    if (String(value).trim().length < 4) return _match;
    transformedCount++;
    return `"[VALUE_REDACTED]"`;
  });

  // Replace env file values
  masked = masked.replace(ENV_VALUE_RE, (match, key, value) => {
    if (String(value).trim().length < 4) return match;
    transformedCount++;
    return `${key}=[VALUE_REDACTED]`;
  });

  return {
    original: content,
    masked,
    transformedCount,
    detectedCount,
    preservedCount: Math.max(0, detectedCount - transformedCount),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy: pii-only — only person names, emails, phone numbers
// ─────────────────────────────────────────────────────────────────────────────

function maskPiiOnly(content: string): MaskResult {
  const detector = new DetectionEngine();
  const payload: ChatCompletionsRequest = {
    model: "gpt-4o",
    messages: [{ role: "user", content }],
  };
  const detection = detector.detect(payload);
  const piiMatches = detectPii(content);
  const detectedCount = detection.findings.length + piiMatches.length;

  let masked = content;
  let transformedCount = piiMatches.length;

  // Apply PII replacements in reverse index order
  const sorted = [...piiMatches].sort((a, b) => b.index - a.index);
  for (const m of sorted) {
    let replacement: string;
    switch (m.kind) {
      case "email":
        replacement = "PER_MAIL_REDACTED@example.com";
        break;
      case "phone":
        replacement = "+XX XX XX XX XX";
        break;
      case "per":
        replacement = "PERSON_NAME_REDACTED";
        break;
      default:
        replacement = `[${m.kind.toUpperCase()}_REDACTED]`;
    }
    masked =
      masked.slice(0, m.index) + replacement + masked.slice(m.index + m.value.length);
  }

  return {
    original: content,
    masked,
    transformedCount,
    detectedCount,
    preservedCount: Math.max(0, detectedCount - transformedCount),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Run a strategy on content
// ─────────────────────────────────────────────────────────────────────────────

function runStrategy(strategy: Strategy, content: string, scopeId: string): MaskResult {
  switch (strategy) {
    case "aggressive":
      return maskAggressive(content, scopeId);
    case "code-aware":
      return maskCodeAware(content);
    case "values-only":
      return maskValuesOnly(content);
    case "pii-only":
      return maskPiiOnly(content);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sample project file list
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_DIR = path.join(__dirname, "sample-projects");

const SAMPLE_FILES: Array<{ project: string; relativePath: string }> = [
  // webapp
  { project: "webapp", relativePath: "webapp/src/config.ts" },
  { project: "webapp", relativePath: "webapp/src/users/service.ts" },
  { project: "webapp", relativePath: "webapp/.env" },
  { project: "webapp", relativePath: "webapp/src/api/clients.ts" },
  // data-pipeline
  { project: "data-pipeline", relativePath: "data-pipeline/config/database.yml" },
  { project: "data-pipeline", relativePath: "data-pipeline/src/etl/transform.py" },
  { project: "data-pipeline", relativePath: "data-pipeline/scripts/deploy.sh" },
  // mobile-app
  { project: "mobile-app", relativePath: "mobile-app/src/constants.ts" },
  { project: "mobile-app", relativePath: "mobile-app/src/services/auth.ts" },
  { project: "mobile-app", relativePath: "mobile-app/src/utils/analytics.ts" },
];

const STRATEGIES: Strategy[] = ["aggressive", "code-aware", "values-only", "pii-only"];

// ─────────────────────────────────────────────────────────────────────────────
// Diff helper — show changed lines with context
// ─────────────────────────────────────────────────────────────────────────────

function buildDiff(original: string, masked: string, maxChanges = 8): string {
  const origLines = original.split("\n");
  const maskLines = masked.split("\n");
  const lines: string[] = [];
  let changeCount = 0;

  for (let i = 0; i < Math.max(origLines.length, maskLines.length); i++) {
    const o = origLines[i] ?? "";
    const m = maskLines[i] ?? "";
    if (o !== m && changeCount < maxChanges) {
      lines.push(`  - ${o.trimEnd()}`);
      lines.push(`  + ${m.trimEnd()}`);
      changeCount++;
    }
  }

  if (changeCount === 0) {
    lines.push("  (no changes — strategy did not match any content in this file)");
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate summary table
// ─────────────────────────────────────────────────────────────────────────────

interface ProjectTotals {
  detected: number;
  masked: number;
  preserved: number;
}

function buildSummaryTable(results: FileResult[]): string {
  const strategies = STRATEGIES;
  const projects = ["webapp", "data-pipeline", "mobile-app"];

  // Aggregate by project × strategy
  const totals = new Map<string, ProjectTotals>();
  for (const strategy of strategies) {
    for (const project of projects) {
      const key = `${strategy}::${project}`;
      const group = results.filter((r) => r.strategy === strategy && r.project === project);
      totals.set(key, {
        detected: group.reduce((s, r) => s + r.result.detectedCount, 0),
        masked: group.reduce((s, r) => s + r.result.transformedCount, 0),
        preserved: group.reduce((s, r) => s + r.result.preservedCount, 0),
      });
    }
  }

  const colW = 22;
  const header =
    `| ${"Strategy".padEnd(12)} | ${"Project".padEnd(16)} | ${"Detected".padEnd(8)} | ${"Masked".padEnd(6)} | ${"Preserved".padEnd(9)} |`;
  const sep =
    `|${"-".repeat(14)}|${"-".repeat(18)}|${"-".repeat(10)}|${"-".repeat(8)}|${"-".repeat(11)}|`;

  const rows: string[] = [header, sep];

  for (const strategy of strategies) {
    for (const project of projects) {
      const t = totals.get(`${strategy}::${project}`)!;
      rows.push(
        `| ${strategy.padEnd(12)} | ${project.padEnd(16)} | ${String(t.detected).padEnd(8)} | ${String(t.masked).padEnd(6)} | ${String(t.preserved).padEnd(9)} |`
      );
    }
  }

  return rows.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Before/after examples section
// ─────────────────────────────────────────────────────────────────────────────

function buildExamplesSection(results: FileResult[]): string {
  // Pick the most interesting file per strategy (highest transformedCount)
  const sections: string[] = [];

  for (const strategy of STRATEGIES) {
    const strategyResults = results.filter((r) => r.strategy === strategy);
    const best = strategyResults.sort((a, b) => b.result.transformedCount - a.result.transformedCount)[0];
    if (!best) continue;

    sections.push(`### Strategy: \`${strategy}\``);
    sections.push(
      `**Most sensitive file**: \`${best.file}\` — ${best.result.transformedCount} elements masked`
    );
    sections.push("");
    sections.push("```diff");
    sections.push(buildDiff(best.result.original, best.result.masked, 10));
    sections.push("```");
    sections.push("");
  }

  return sections.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Recommendations
// ─────────────────────────────────────────────────────────────────────────────

const RECOMMENDATIONS = `
## Recommendations

| Use Case | Recommended Strategy | Reason |
|---|---|---|
| Sharing code with external LLM (GPT-4, Claude) | \`aggressive\` | Maximum privacy — masks identifiers, infrastructure names, all PII and secrets before any data leaves the perimeter |
| Internal code review with LLM assistance | \`code-aware\` | Preserves code structure and identifier names so the LLM can reason about architecture, while hiding actual credential values and personal data |
| Audit / compliance check of codebase secrets | \`values-only\` | Fast regex scan — reliably redacts credentials in .env and config files without false-positives on code identifiers |
| GDPR / data subject access requests | \`pii-only\` | Focused exclusively on personal data (names, emails, phones) — minimal disruption to non-PII content, ideal for privacy audits |

### When to use each strategy

**\`aggressive\`**
- Best for: sending code to external AI services (GPT-4, Claude, Copilot)
- Tradeoff: LLM may struggle with pseudonymized class/function names
- Ideal when: data privacy is paramount and the LLM doesn't need to understand your architecture

**\`code-aware\`**
- Best for: AI-assisted debugging, internal code Q&A with on-premise LLMs
- Tradeoff: Internal infrastructure names (hostnames, service names) are preserved
- Ideal when: you want the LLM to understand code structure but not credential values

**\`values-only\`**
- Best for: pre-commit hooks, CI secret scanning, .env file audits
- Tradeoff: No PII coverage — person names and emails in comments will not be masked
- Ideal when: you need high-confidence secret detection with zero false positives on code

**\`pii-only\`**
- Best for: GDPR compliance, code review of data processing code
- Tradeoff: Secrets (API keys, DB passwords) are NOT masked
- Ideal when: the concern is personal data exposure, not credential leakage
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("LLMask Masking Engine — Benchmark Demo");
  console.log("=".repeat(60));

  const allResults: FileResult[] = [];
  let fileIdx = 0;

  for (const { project, relativePath } of SAMPLE_FILES) {
    const filePath = path.join(SAMPLE_DIR, relativePath);
    const content = fs.readFileSync(filePath, "utf-8");
    const shortName = relativePath;

    for (const strategy of STRATEGIES) {
      const scopeId = `demo-${strategy}-${fileIdx}`;
      process.stdout.write(`  [${strategy.padEnd(12)}] ${shortName.padEnd(48)} `);

      const result = runStrategy(strategy, content, scopeId);

      allResults.push({ project, file: shortName, strategy, result });
      console.log(`detected=${result.detectedCount} masked=${result.transformedCount}`);
    }
    fileIdx++;
    console.log();
  }

  // ── Build markdown report ────────────────────────────────────
  const summaryTable = buildSummaryTable(allResults);
  const examplesSection = buildExamplesSection(allResults);

  // Per-file breakdown
  const perFileRows: string[] = [
    "| Project | File | Strategy | Detected | Masked | Preserved |",
    "|---|---|---|---|---|---|",
  ];
  for (const r of allResults) {
    perFileRows.push(
      `| ${r.project} | \`${r.file.split("/").slice(1).join("/")}\` | \`${r.strategy}\` | ${r.result.detectedCount} | ${r.result.transformedCount} | ${r.result.preservedCount} |`
    );
  }

  const report = `# LLMask Masking Benchmark Results

> Generated: ${new Date().toISOString()}
> Engine: RewriteEngineV4 + DetectionEngine + PII patterns
> Sample projects: webapp, data-pipeline, mobile-app
> Strategies: aggressive, code-aware, values-only, pii-only

---

## Summary: Strategy × Project

${summaryTable}

---

## Per-File Breakdown

${perFileRows.join("\n")}

---

## Before / After Examples (most sensitive file per strategy)

${examplesSection}

---

${RECOMMENDATIONS}
`;

  const reportPath = path.join(__dirname, "masking-benchmark-results.md");
  fs.writeFileSync(reportPath, report, "utf-8");

  console.log("=".repeat(60));
  console.log(`\nSummary table:\n`);
  console.log(summaryTable);
  console.log(`\nReport saved to: ${reportPath}`);
}

main().catch((err: unknown) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
