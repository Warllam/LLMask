/**
 * LLMask Masking Effectiveness Test
 *
 * Does masked code still produce useful LLM responses?
 * Tests the code-aware strategy: secrets/PII are replaced, code structure preserved.
 *
 * Usage:  npx tsx tests/masking-effectiveness-test.ts
 */

import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { InMemoryMappingStore } from "../src/modules/mapping-store/in-memory-mapping-store";
import { RewriteEngineV4 } from "../src/modules/rewrite/rewrite-engine-v4";
import { DetectionEngine } from "../src/modules/detection/detection-engine";
import { detectPii } from "../src/modules/detection/pii-patterns";
import type { ChatCompletionsRequest } from "../src/contracts/openai";

// ─────────────────────────────────────────────────────────────────────────────
// Code-aware masking (same logic as masking-demo.ts)
// ─────────────────────────────────────────────────────────────────────────────

const SECRET_ASSIGNMENT_RE =
  /(?<key>(?:password|passwd|secret|token|api_key|apikey|api[_-]?secret|access_key|secret_access_key|private_key|credential|auth_token|webhook|jwt|signing_key|encryption_key|client_secret|app_secret|master_key|hmac|db_pass(?:word)?|database_url|mongodb[_-]?uri|redis[_-]?url|dsn|connection_string|slack|stripe|sendgrid|firebase|amplitude|mixpanel|segment|onesignal|sentry|launchdarkly|monitoring_api|pagerduty)\s*[:=]\s*["']?)([^"'\n]{6,})["']?/gi;

const CREDENTIAL_URL_RE = /(?:postgres|mysql|mongodb|redis):\/\/[^@\s"']+:[^@\s"']+@[^\s"']+/gi;

function maskCodeAware(content: string): { masked: string; count: number } {
  const piiMatches = detectPii(content);
  let masked = content;
  let count = 0;

  // Replace credential-bearing URLs
  masked = masked.replace(CREDENTIAL_URL_RE, (match) => {
    count++;
    return match.replace(/(:\/\/[^@\s"']+:)([^@\s"']+)(@)/, "://$1[CREDENTIAL_REDACTED]$3");
  });

  // Replace secret assignment values
  const seen = new Set<string>();
  masked = masked.replace(SECRET_ASSIGNMENT_RE, (match, _key, value) => {
    const v = String(value).trim().replace(/["']/g, "");
    if (v.length < 6 || seen.has(v)) return match;
    seen.add(v);
    count++;
    return match.replace(v, "[SECRET_REDACTED]");
  });

  // Replace PII in reverse order (preserve indices)
  const sortedPii = [...piiMatches].sort((a, b) => b.index - a.index);
  for (const m of sortedPii) {
    const prefix = m.kind === "email" ? "MAIL" : m.kind === "phone" ? "TEL" : "PER";
    masked = masked.slice(0, m.index) + `[${prefix}_REDACTED]` + masked.slice(m.index + m.value.length);
    count++;
  }

  return { masked, count };
}

// ─────────────────────────────────────────────────────────────────────────────
// Claude CLI invocation
// ─────────────────────────────────────────────────────────────────────────────

function resolveClaudeInvocation(): { bin: string; scriptPrefix: string[] } {
  if (process.platform !== "win32") {
    return { bin: "claude", scriptPrefix: [] };
  }
  const appData = process.env["APPDATA"];
  if (appData) {
    const cliScript = path.join(
      appData, "npm", "node_modules", "@anthropic-ai", "claude-code", "cli.js"
    );
    if (fs.existsSync(cliScript)) {
      return { bin: process.execPath, scriptPrefix: [cliScript] };
    }
  }
  return { bin: "claude", scriptPrefix: [] };
}

function callClaude(prompt: string, label: string): string {
  const { bin, scriptPrefix } = resolveClaudeInvocation();

  // Strip Claude Desktop host env vars so the subprocess makes direct API calls
  const subEnv: NodeJS.ProcessEnv = { ...process.env };
  delete subEnv["CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST"];
  delete subEnv["CLAUDE_CODE_ENTRYPOINT"];
  delete subEnv["CLAUDECODE"];

  console.log(`  → Calling Claude for [${label}]...`);

  const result = spawnSync(bin, [...scriptPrefix, "--print", prompt], {
    encoding: "utf-8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: 180_000,
    env: subEnv,
  });

  if (result.error) {
    throw new Error(`Claude spawn error (${label}): ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.trim() ?? "";
    throw new Error(`Claude exited ${result.status} (${label}): ${stderr.slice(0, 400)}`);
  }

  return result.stdout.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Quality assessment heuristics
// ─────────────────────────────────────────────────────────────────────────────

// Keywords that indicate a useful security/code review response
const SECURITY_KEYWORDS = [
  "hardcoded", "secret", "environment variable", "vault", "rotation",
  "credential", "plaintext", "encrypt", "hash", "injection", "sanitize",
  "parameterized", "prepared statement", "pii", "gdpr", "logging",
  "config", "env", ".env", "exposure", "leak", "sensitive",
];

const OPTIMIZATION_KEYWORDS = [
  "sql injection", "parameterized", "prepared statement", "index", "batch",
  "performance", "optimize", "async", "connection pool", "sanitize",
  "query", "pandas", "chunk", "cache", "memory",
];

function scoreResponse(response: string, keywords: string[]): number {
  const lower = response.toLowerCase();
  const matched = keywords.filter((k) => lower.includes(k));
  return matched.length;
}

function extractTopics(response: string): string[] {
  const lower = response.toLowerCase();
  const topics: string[] = [];

  if (lower.includes("hardcoded") || lower.includes("hard-coded")) topics.push("hardcoded credentials");
  if (lower.includes("environment variable") || lower.includes(".env")) topics.push("use env vars");
  if (lower.includes("vault") || lower.includes("secrets manager")) topics.push("secrets manager");
  if (lower.includes("sql injection") || lower.includes("parameterized")) topics.push("SQL injection");
  if (lower.includes("logging") || lower.includes("log")) topics.push("PII in logs");
  if (lower.includes("encrypt") || lower.includes("hash")) topics.push("encryption/hashing");
  if (lower.includes("rotation") || lower.includes("rotate")) topics.push("key rotation");
  if (lower.includes("connection pool") || lower.includes("pool")) topics.push("connection pooling");
  if (lower.includes("gdpr") || lower.includes("pii") || lower.includes("personal")) topics.push("GDPR/PII compliance");
  if (lower.includes("least privilege") || lower.includes("permission")) topics.push("least privilege");

  return topics;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test cases
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_DIR = path.join(__dirname, "sample-projects");

interface TestCase {
  label: string;
  file: string;
  prompt: string;
  keywords: string[];
}

const TEST_CASES: TestCase[] = [
  {
    label: "webapp/src/config.ts — security review",
    file: "webapp/src/config.ts",
    prompt: "Review this config file. What security issues do you see? Suggest improvements.",
    keywords: SECURITY_KEYWORDS,
  },
  {
    label: "data-pipeline/src/etl/transform.py — SQL injection + optimization",
    file: "data-pipeline/src/etl/transform.py",
    prompt: "Optimize this ETL script and fix any SQL injection risks. Be specific about the issues.",
    keywords: OPTIMIZATION_KEYWORDS,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

interface TestResult {
  testCase: TestCase;
  original: string;
  masked: string;
  maskedCount: number;
  responseOriginal: string;
  responseMasked: string;
  scoreOriginal: number;
  scoreMasked: number;
  topicsOriginal: string[];
  topicsMasked: string[];
  topicsPreserved: string[];
  topicsLost: string[];
  qualityRetained: number; // 0–100%
}

async function main(): Promise<void> {
  console.log("LLMask Masking Effectiveness Test");
  console.log("=".repeat(60));
  console.log("Strategy: code-aware (secrets + PII masked, code structure preserved)");
  console.log();

  const results: TestResult[] = [];

  for (const tc of TEST_CASES) {
    console.log(`\n[TEST] ${tc.label}`);
    console.log("-".repeat(60));

    const filePath = path.join(SAMPLE_DIR, tc.file);
    const original = fs.readFileSync(filePath, "utf-8");
    const { masked, count: maskedCount } = maskCodeAware(original);

    console.log(`  File: ${tc.file} (${original.split("\n").length} lines, ${maskedCount} elements masked)`);

    const promptOriginal = `${tc.prompt}\n\n\`\`\`\n${original}\n\`\`\``;
    const promptMasked = `${tc.prompt}\n\n\`\`\`\n${masked}\n\`\`\``;

    let responseOriginal = "";
    let responseMasked = "";

    try {
      responseOriginal = callClaude(promptOriginal, "ORIGINAL");
    } catch (err) {
      responseOriginal = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }

    try {
      responseMasked = callClaude(promptMasked, "MASKED");
    } catch (err) {
      responseMasked = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }

    const scoreOriginal = scoreResponse(responseOriginal, tc.keywords);
    const scoreMasked = scoreResponse(responseMasked, tc.keywords);
    const topicsOriginal = extractTopics(responseOriginal);
    const topicsMasked = extractTopics(responseMasked);
    const topicsPreserved = topicsOriginal.filter((t) => topicsMasked.includes(t));
    const topicsLost = topicsOriginal.filter((t) => !topicsMasked.includes(t));
    const qualityRetained =
      scoreOriginal > 0 ? Math.round((scoreMasked / scoreOriginal) * 100) : 100;

    console.log(
      `  Score: original=${scoreOriginal} masked=${scoreMasked} retained=${qualityRetained}%`
    );
    console.log(`  Topics preserved: [${topicsPreserved.join(", ") || "none"}]`);
    if (topicsLost.length > 0)
      console.log(`  Topics lost:      [${topicsLost.join(", ")}]`);

    results.push({
      testCase: tc,
      original,
      masked,
      maskedCount,
      responseOriginal,
      responseMasked,
      scoreOriginal,
      scoreMasked,
      topicsOriginal,
      topicsMasked,
      topicsPreserved,
      topicsLost,
      qualityRetained,
    });
  }

  // ── Build markdown report ──────────────────────────────────────────────────
  const report = buildReport(results);
  const reportPath = path.join(__dirname, "masking-effectiveness-report.md");
  fs.writeFileSync(reportPath, report, "utf-8");

  console.log("\n" + "=".repeat(60));
  console.log(`\nReport saved to: ${reportPath}`);

  // Summary table to stdout
  console.log("\n## Effectiveness Summary\n");
  console.log(
    "| File | Elements masked | Score original | Score masked | Quality retained |"
  );
  console.log("|---|---|---|---|---|");
  for (const r of results) {
    console.log(
      `| ${r.testCase.file} | ${r.maskedCount} | ${r.scoreOriginal} | ${r.scoreMasked} | ${r.qualityRetained}% |`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Report builder
// ─────────────────────────────────────────────────────────────────────────────

function truncate(text: string, maxLines = 40): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join("\n") + `\n... (${lines.length - maxLines} more lines)`;
}

function buildReport(results: TestResult[]): string {
  const lines: string[] = [];

  lines.push("# LLMask Masking Effectiveness Report");
  lines.push("");
  lines.push(`> Generated: ${new Date().toISOString()}`);
  lines.push("> Strategy tested: **code-aware** (secrets + PII replaced, code identifiers preserved)");
  lines.push("> Question: Can Claude still give equally useful advice on masked code?");
  lines.push("");
  lines.push("---");
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push("");
  lines.push(
    "| Test | Elements masked | Keywords (original) | Keywords (masked) | Quality retained |"
  );
  lines.push("|---|---|---|---|---|");
  for (const r of results) {
    const verdict = r.qualityRetained >= 80 ? "✅" : r.qualityRetained >= 60 ? "⚠️" : "❌";
    lines.push(
      `| ${r.testCase.file} | ${r.maskedCount} | ${r.scoreOriginal} | ${r.scoreMasked} | ${r.qualityRetained}% ${verdict} |`
    );
  }
  lines.push("");
  lines.push("**Verdict key:** ✅ ≥80% quality retained · ⚠️ 60–79% · ❌ <60%");
  lines.push("");
  lines.push("---");
  lines.push("");

  // Detailed results per test
  for (const r of results) {
    lines.push(`## Test: \`${r.testCase.file}\``);
    lines.push("");
    lines.push(`**Prompt:** ${r.testCase.prompt}`);
    lines.push(`**Elements masked by code-aware strategy:** ${r.maskedCount}`);
    lines.push("");

    // Before/after code diff
    lines.push("### Code: Before vs After Masking");
    lines.push("");
    lines.push("**Original (first 40 lines):**");
    lines.push("```");
    lines.push(truncate(r.original, 40));
    lines.push("```");
    lines.push("");
    lines.push("**After code-aware masking (first 40 lines):**");
    lines.push("```");
    lines.push(truncate(r.masked, 40));
    lines.push("```");
    lines.push("");

    // Claude responses
    lines.push("### Claude's Response: Original Code");
    lines.push("");
    lines.push(r.responseOriginal);
    lines.push("");

    lines.push("### Claude's Response: Masked Code");
    lines.push("");
    lines.push(r.responseMasked);
    lines.push("");

    // Analysis
    lines.push("### Analysis");
    lines.push("");
    lines.push(
      `- **Quality score:** ${r.scoreMasked}/${r.scoreOriginal} relevant keywords matched → **${r.qualityRetained}% quality retained**`
    );
    lines.push(
      `- **Topics preserved:** ${r.topicsPreserved.length > 0 ? r.topicsPreserved.map((t) => `\`${t}\``).join(", ") : "none detected"}`
    );
    if (r.topicsLost.length > 0) {
      lines.push(
        `- **Topics lost after masking:** ${r.topicsLost.map((t) => `\`${t}\``).join(", ")}`
      );
    } else {
      lines.push("- **Topics lost after masking:** none");
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // Overall conclusion
  const avgRetained =
    results.length > 0
      ? Math.round(results.reduce((s, r) => s + r.qualityRetained, 0) / results.length)
      : 0;

  const allPreserved = results.flatMap((r) => r.topicsPreserved);
  const allLost = results.flatMap((r) => r.topicsLost);
  const uniquePreserved = [...new Set(allPreserved)];
  const uniqueLost = [...new Set(allLost)];

  lines.push("## Overall Conclusion");
  lines.push("");
  lines.push(
    `Average quality retained across all tests: **${avgRetained}%**`
  );
  lines.push("");

  if (avgRetained >= 80) {
    lines.push(
      "**Result: code-aware masking preserves LLM response quality.** " +
        "Claude identifies the same security issues and optimization opportunities " +
        "whether it sees the original secrets or `[SECRET_REDACTED]` placeholders. " +
        "The presence of a credential is enough to trigger a security observation — " +
        "the actual value is irrelevant to the advice."
    );
  } else if (avgRetained >= 60) {
    lines.push(
      "**Result: code-aware masking mostly preserves LLM response quality**, " +
        "with some degradation. Claude identifies most issues on masked code, " +
        "but a few topics are missed, likely because the masking obscured enough " +
        "context for Claude to deprioritize certain recommendations."
    );
  } else {
    lines.push(
      "**Result: masking significantly degrades LLM response quality.** " +
        "The code-aware strategy may be too aggressive for this use case. " +
        "Consider using values-only strategy instead."
    );
  }

  lines.push("");
  lines.push("### Topics consistently identified on masked code");
  if (uniquePreserved.length > 0) {
    for (const t of uniquePreserved) {
      lines.push(`- ✅ \`${t}\``);
    }
  } else {
    lines.push("- (none detected via keyword heuristic)");
  }
  lines.push("");
  if (uniqueLost.length > 0) {
    lines.push("### Topics that required seeing the actual secrets");
    for (const t of uniqueLost) {
      lines.push(`- ⚠️ \`${t}\` — Claude only identified this with the unmasked version`);
    }
  }
  lines.push("");
  lines.push("### Why code-aware masking works well for security review");
  lines.push("");
  lines.push(
    "Security advisors don't need to *read* a password to know it shouldn't be hardcoded. " +
      "The structure `password: \"[SECRET_REDACTED]\"` carries the same information as " +
      "`password: \"P@ss123!\"` from a security standpoint: *there is a hardcoded credential here*. " +
      "Code-aware masking preserves:"
  );
  lines.push("");
  lines.push("- Variable and function names (so Claude understands what the code does)");
  lines.push("- Code structure and architecture patterns");
  lines.push("- The *presence* of credential assignments (triggers security advice)");
  lines.push("- SQL column names and table references (triggers SQL injection advice)");
  lines.push("- PII-handling patterns like `customer_ssn`, `customer_email` in queries");
  lines.push("");
  lines.push(
    "What is hidden: actual credential values, email addresses, phone numbers, person names — " +
      "the exact data that would be dangerous to send to an external LLM API."
  );

  return lines.join("\n");
}

main().catch((err: unknown) => {
  console.error("Test failed:", err);
  process.exit(1);
});
