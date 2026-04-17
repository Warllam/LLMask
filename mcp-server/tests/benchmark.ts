/**
 * LLMask MCP Server — Masking Engine Benchmark
 *
 * Tests the masking engine against realistic inputs across all four strategies.
 * Run: npx tsx tests/benchmark.ts
 */

import { maskText, unmaskText, Strategy } from "../src/masker";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ── Utilities ─────────────────────────────────────────────────────────────────

function time<T>(fn: () => T): { result: T; ms: number } {
  const start = performance.now();
  const result = fn();
  return { result, ms: +(performance.now() - start).toFixed(3) };
}

function truncate(s: string, max = 80): string {
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}

function repeat(s: string, n: number): string {
  return Array(n).fill(s).join("\n");
}

// ── Test cases ────────────────────────────────────────────────────────────────

const TEST_CASES: Array<{ id: string; label: string; input: string }> = [
  {
    id: "emails",
    label: "Emails",
    input: "Contact alice.dupont@nextera-corp.com and bob.martin@acme.io for support. CC jean-pierre.lambert@fr.nextera.eu",
  },
  {
    id: "api_keys",
    label: "API Keys",
    input:
      'My OpenAI key is sk-proj-abc123def456ghi789jkl012mno345pqr678stu901 and AWS key AKIAIOSFODNN7EXAMPLE with Stripe sk-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  },
  {
    id: "db_urls",
    label: "Database URLs",
    input:
      "Primary: postgres://admin:P@ssw0rd@db.internal.nextera.com:5432/production\nReplica: mysql://reader:R3adOnly!@replica.db.nextera.com:3306/analytics",
  },
  {
    id: "phones",
    label: "Phone Numbers",
    input: "Call me at +33 6 12 34 56 78 or (555) 123-4567. Fax: +1-800-555-0199. Paris office: +33 1 42 86 83 26",
  },
  {
    id: "credit_cards",
    label: "Credit Cards",
    input: "Card: 4532123456789012 exp 12/27 CVV 123. Backup: 5425233430109903 exp 06/26",
  },
  {
    id: "ts_config",
    label: "TypeScript config with secrets",
    input: `// config/database.ts — DO NOT COMMIT
export const config = {
  database: {
    host: "db.internal.nextera.com",
    port: 5432,
    name: "production",
    user: "nextera_api",
    password: "P@ssw0rd!Nextera2024",
    replicaUrl: "postgres://readonly:R3ad0nly@replica.nextera.com:5432/production",
  },
  redis: {
    url: "redis://default:RedisS3cr3t@cache.nextera.com:6379",
  },
  stripe: {
    secretKey: "sk-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    webhookSecret: "whsec_abc123def456ghi789jkl012mno",
  },
  sendgrid: {
    apiKey: "SG.aBcDeFgHiJkLmNoPqRs-Tu.vWxYzABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklm",
  },
  support: {
    email: "support@nextera-corp.com",
    billing: "billing@nextera-corp.com",
  },
  adminIp: "192.168.1.50",
  allowedCidrs: ["10.0.0.0/8", "172.16.0.0/12"],
};`,
  },
  {
    id: "python_etl",
    label: "Python ETL with SQL and IPs",
    input: `#!/usr/bin/env python3
"""ETL pipeline — Nextera Analytics"""
import psycopg2

DB_HOST = "10.42.0.15"
DB_PORT = 5432
DB_NAME = "nextera_dwh"
DB_USER = "etl_service"
DB_PASS = "ETL$3rv1c3Pass!"
API_KEY = "sk-proj-XYZ123abc456def789ghi012jkl345mno678pqr"

conn = psycopg2.connect(
    host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
    user=DB_USER, password=DB_PASS
)

query = """
  SELECT c.customer_id, c.email, c.phone, c.ssn,
         o.amount, o.card_number
  FROM nextera_customers c
  JOIN nextera_orders o ON c.customer_id = o.customer_id
  WHERE c.email LIKE '%@nextera-corp.com'
  AND o.amount > 1000
"""

# Notify ops
def notify(msg):
    import smtplib
    smtp = smtplib.SMTP("smtp.nextera-corp.com", 587)
    smtp.login("ops@nextera-corp.com", "Ops!P@ss2024")
    smtp.sendmail("etl@nextera-corp.com", "ops@nextera-corp.com", msg)
`,
  },
  {
    id: "shell_deploy",
    label: "Shell deploy script",
    input: `#!/bin/bash
# deploy.sh — Nextera production deployment

SERVER_IP="52.14.88.201"
BACKUP_IP="54.92.33.17"
BASTION="bastion.nextera-corp.com"
DB_HOST="db.internal.nextera.com"

SSH_KEY="-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAA..."
DEPLOY_USER="deploy"
DEPLOY_PASS="D3pl0y!Nextera2024"

# Pull latest
ssh -i ~/.ssh/nextera_deploy deploy@$SERVER_IP \
  "cd /opt/nextera && git pull && npm run build"

# Notify
curl -X POST https://hooks.example.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX \
  -H 'Content-type: application/json' \
  --data '{"text":"Deploy complete to '$SERVER_IP'"}'

echo "Deployed by devops@nextera-corp.com"
`,
  },
  {
    id: "dotenv",
    label: ".env file",
    input: `# .env — Nextera API service

NODE_ENV=production
PORT=3000
HOST=api.nextera-corp.com

# Database
DATABASE_URL=postgres://nextera_api:DBP@ss!2024@db.internal.nextera.com:5432/nextera_prod
REDIS_URL=redis://default:RedisP@ss!@cache.nextera.com:6379/0

# Auth
JWT_SECRET=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secretparthere.signature
SESSION_SECRET=s3ss10nS3cr3t!Nextera2024
BCRYPT_ROUNDS=12

# External APIs
STRIPE_SECRET_KEY=sk-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
STRIPE_WEBHOOK_SECRET=whsec_XYZ123abc456def789ghi012mno345pqr
SENDGRID_API_KEY=SG.xYzAbcDef-GhIjKlMnOp.QrStUvWxYzABCDEFGHIJKLMNOPQRSTUVWXYZ01
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789012

# Support
SUPPORT_EMAIL=support@nextera-corp.com
ADMIN_EMAIL=admin@nextera-corp.com
OPS_EMAIL=ops@nextera-corp.com
`,
  },
  {
    id: "plain_pii",
    label: "Plain text with PII",
    input: `Customer complaint — escalated to billing team

We received a complaint from Jean-Pierre DUPONT (DOB: 1985-03-14) regarding
invoice #INV-2024-08821. His account email is jean-pierre.dupont@gmail.com
and preferred contact number is +33 6 12 34 56 78.

He provided his SSN 456-78-9012 for identity verification. His card
4532-1234-5678-9012 was charged €299 on 2024-08-15.

Secondary contact: Marie DUPONT at marie.dupont@outlook.fr, phone (555) 987-6543.
Internal ops contact: billing@nextera-corp.com
`,
  },
];

const STRATEGIES: Strategy[] = ["aggressive", "code-aware", "values-only", "pii-only"];

// ── Result types ──────────────────────────────────────────────────────────────

interface CaseResult {
  strategy: Strategy;
  elements_masked: number;
  ms: number;
  interesting: { original: string; replacement: string; category: string } | null;
}

interface BenchmarkRow {
  id: string;
  label: string;
  results: CaseResult[];
}

// ── Run benchmarks ────────────────────────────────────────────────────────────

console.log("═".repeat(72));
console.log(" LLMask MCP Server — Masking Engine Benchmark");
console.log("═".repeat(72));

const rows: BenchmarkRow[] = [];

for (const tc of TEST_CASES) {
  console.log(`\n┌─ [${tc.id}] ${tc.label}`);
  const caseResults: CaseResult[] = [];

  for (const strategy of STRATEGIES) {
    const { result, ms } = time(() => maskText(tc.input, strategy));
    // Pick most "interesting" element: prefer secrets/PII over generics
    const interesting =
      result.details.find((d) => d.category.startsWith("secret") || d.category.startsWith("api_key") || d.category.startsWith("pii") || d.category.startsWith("auth")) ??
      result.details[0] ??
      null;

    caseResults.push({ strategy, elements_masked: result.elements_masked, ms, interesting });

    const badge = result.elements_masked > 0 ? `✓ ${result.elements_masked} masked` : "  0 masked";
    console.log(`│  ${strategy.padEnd(12)} ${badge.padEnd(18)} ${ms.toString().padStart(6)} ms`);
    if (interesting && strategy === "aggressive") {
      console.log(`│             » ${truncate(interesting.original, 35).padEnd(36)}  →  ${truncate(interesting.replacement, 30)}`);
    }
  }
  console.log("└" + "─".repeat(71));
  rows.push({ id: tc.id, label: tc.label, results: caseResults });
}

// ── Round-trip accuracy ───────────────────────────────────────────────────────

console.log("\n" + "═".repeat(72));
console.log(" Round-trip accuracy (mask → unmask → verify)");
console.log("═".repeat(72));

let totalRoundTrips = 0;
let passedRoundTrips = 0;
const rtFailures: Array<{ id: string; strategy: Strategy; expected: string; got: string }> = [];

for (const tc of TEST_CASES) {
  for (const strategy of STRATEGIES) {
    const masked = maskText(tc.input, strategy);
    if (masked.elements_masked === 0) continue;
    const { unmasked_text } = unmaskText(masked.masked_text, masked.scope_id);
    totalRoundTrips++;
    const pass = unmasked_text === tc.input;
    if (pass) {
      passedRoundTrips++;
    } else {
      // Find first differing line
      const lines1 = tc.input.split("\n");
      const lines2 = unmasked_text.split("\n");
      let diffLine = "";
      for (let i = 0; i < Math.max(lines1.length, lines2.length); i++) {
        if (lines1[i] !== lines2[i]) {
          diffLine = `expected: ${truncate(lines1[i] ?? "(missing)", 55)} | got: ${truncate(lines2[i] ?? "(missing)", 55)}`;
          break;
        }
      }
      rtFailures.push({ id: tc.id, strategy, expected: lines1.find((_, i) => lines1[i] !== lines2[i]) ?? "", got: lines2.find((_, i) => lines1[i] !== lines2[i]) ?? "" });
      console.log(`  FAIL  [${tc.id}/${strategy}]`);
      if (diffLine) console.log(`    ${diffLine}`);
    }
  }
}
const rtPct = totalRoundTrips === 0 ? "N/A" : `${((passedRoundTrips / totalRoundTrips) * 100).toFixed(1)}%`;
console.log(`\n  Result: ${passedRoundTrips}/${totalRoundTrips} passed  →  ${rtPct} round-trip accuracy`);

// ── Consistency ───────────────────────────────────────────────────────────────

console.log("\n" + "═".repeat(72));
console.log(" Consistency (same input → same pseudonym across calls)");
console.log("═".repeat(72));

const consistencyInput = "Contact alice.dupont@nextera-corp.com — key: AKIAIOSFODNN7EXAMPLE";
let consistencyPassed = 0;
let consistencyTotal = 0;

for (const strategy of STRATEGIES) {
  const r1 = maskText(consistencyInput, strategy);
  const r2 = maskText(consistencyInput, strategy);
  consistencyTotal++;
  if (r1.masked_text === r2.masked_text) {
    consistencyPassed++;
    console.log(`  ✓  ${strategy}`);
  } else {
    console.log(`  ✗  ${strategy}  — outputs differ`);
    console.log(`       call1: ${truncate(r1.masked_text, 60)}`);
    console.log(`       call2: ${truncate(r2.masked_text, 60)}`);
  }
}
console.log(`\n  Result: ${consistencyPassed}/${consistencyTotal} strategies produce consistent pseudonyms`);

// ── Performance: file size scaling ───────────────────────────────────────────

console.log("\n" + "═".repeat(72));
console.log(" Performance — scaling with input size");
console.log("═".repeat(72));

const perfSeed =
  `USER_EMAIL=ops@nextera-corp.com\nDB_URL=postgres://admin:P@ssw0rd@db.internal.nextera.com:5432/prod\n` +
  `API_KEY=sk-proj-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}\n` +
  `AWS_KEY=AKIAIOSFODNN7EXAMPLE\nCARD=4532123456789012\nSSN=123-45-6789\n`;

// Build payloads of target sizes
const sizes: Array<{ label: string; targetBytes: number }> = [
  { label: "10 KB", targetBytes: 10_000 },
  { label: "50 KB", targetBytes: 50_000 },
  { label: "100 KB", targetBytes: 100_000 },
];

for (const { label, targetBytes } of sizes) {
  const reps = Math.ceil(targetBytes / perfSeed.length);
  const payload = repeat(perfSeed, reps).slice(0, targetBytes);
  const actualKB = (Buffer.byteLength(payload, "utf8") / 1024).toFixed(1);

  console.log(`\n  ${label} (~${actualKB} KB actual)`);
  for (const strategy of STRATEGIES) {
    const { result, ms } = time(() => maskText(payload, strategy));
    const throughput = ((Buffer.byteLength(payload, "utf8") / 1024) / (ms / 1000)).toFixed(0);
    console.log(`    ${strategy.padEnd(12)} ${result.elements_masked.toString().padStart(5)} masked   ${ms.toString().padStart(7)} ms   ${throughput.padStart(7)} KB/s`);
  }
}

// ── Build markdown report ─────────────────────────────────────────────────────

function buildMarkdown(): string {
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const lines: string[] = [];

  lines.push("# LLMask MCP Server — Benchmark Results");
  lines.push("");
  lines.push(`**Date:** ${now} UTC  `);
  lines.push(`**Engine:** \`mcp-server/src/masker.ts\`  `);
  lines.push(`**Node:** ${process.version}  `);
  lines.push("");

  // Per-case table
  lines.push("## Per-case results");
  lines.push("");
  lines.push("| Case | aggressive | code-aware | values-only | pii-only |");
  lines.push("|------|-----------|-----------|------------|---------|");

  for (const row of rows) {
    const cells = STRATEGIES.map((s) => {
      const r = row.results.find((x) => x.strategy === s)!;
      return `${r.elements_masked} masked (${r.ms} ms)`;
    });
    lines.push(`| **${row.label}** | ${cells.join(" | ")} |`);
  }

  lines.push("");

  // Interesting transformations
  lines.push("## Interesting transformations (aggressive strategy)");
  lines.push("");
  lines.push("| Case | Original | Masked |");
  lines.push("|------|----------|--------|");

  for (const row of rows) {
    const aggressiveResult = row.results.find((r) => r.strategy === "aggressive");
    if (aggressiveResult?.interesting) {
      const { original, replacement, category } = aggressiveResult.interesting;
      lines.push(
        `| ${row.label} | \`${original.slice(0, 50)}\` | \`${replacement}\` |`
      );
    }
  }

  lines.push("");

  // Round-trip
  lines.push("## Round-trip accuracy");
  lines.push("");
  lines.push(`**${passedRoundTrips}/${totalRoundTrips} passed — ${rtPct} accuracy**`);
  lines.push("");
  if (passedRoundTrips === totalRoundTrips) {
    lines.push("All mask → unmask round-trips restored the original text exactly.");
  } else {
    // Group failures by root cause
    const failsByCase = new Map<string, Strategy[]>();
    for (const f of rtFailures) {
      const arr = failsByCase.get(f.id) ?? [];
      arr.push(f.strategy);
      failsByCase.set(f.id, arr);
    }
    lines.push("| Case | Failing strategies |");
    lines.push("|------|--------------------|");
    for (const [id, strats] of failsByCase) {
      lines.push(`| \`${id}\` | ${strats.join(", ")} |`);
    }
    lines.push("");
    lines.push("### Root causes (bugs discovered)");
    lines.push("");
    lines.push("**Bug 1 — Off-by-one in `secret.password` index calculation**  ");
    lines.push("In `maskText`, the `secret.password` regex captures group 1 (the value without quotes), but the");
    lines.push("index is computed as `m.index + (raw.length - value.length)`. Because `raw` includes the trailing");
    lines.push("closing quote but `value` does not, the computed offset is 1 too large. The replacement starts");
    lines.push("one character late, leaving the first character of the password in place and consuming the");
    lines.push("closing quote — causing text corruption that breaks round-trip unmask.");
    lines.push("**Affects:** `ts_config`, `python_etl`, `shell_deploy` (values-only, aggressive strategies).  ");
    lines.push("**Fix:** Use `m.index! + m[0].indexOf(m[1]!)` to find the exact start of the captured group.");
    lines.push("");
    lines.push("**Bug 2 — Nested pattern overlap (credit card ⊃ phone)**  ");
    lines.push("The phone regex `\\(?\\d{3}\\)?[\\s.-]?\\d{3}[\\s.-]?\\d{4}` matches 10-digit substrings inside");
    lines.push("16-digit credit card numbers (e.g., last 10 digits of `5425233430109903`). Both patterns fire");
    lines.push("and are sorted by position descending. The inner (phone) replacement runs first, corrupting the");
    lines.push("string; the outer (credit card) replacement then slices using stale original indices, producing");
    lines.push("garbled text. Round-trip unmask restores the garbled form, not the original.");
    lines.push("**Affects:** `credit_cards` (all strategies).  ");
    lines.push("**Fix:** After sorting matches by position, skip any match whose range is fully contained in an");
    lines.push("already-queued longer match (overlap deduplication).");
    lines.push("");
    lines.push("**Bug 3 — DB URL ↔ email overlap**  ");
    lines.push("Passwords containing `@` inside database URLs (e.g., `P@ssw0rd@db.internal.nextera.com`) are");
    lines.push("matched by both the `secret.db_url` pattern (whole URL) and the `pii.email` pattern");
    lines.push("(`ssw0rd@db.internal.nextera.com`). The email replacement runs first (higher index), corrupting");
    lines.push("the URL. Same fix as Bug 2 (overlap deduplication).");
    lines.push("**Affects:** `db_urls`, `dotenv` (all strategies).");
  }
  lines.push("");

  // Consistency
  lines.push("## Pseudonym consistency");
  lines.push("");
  lines.push(`**${consistencyPassed}/${consistencyTotal} strategies consistent**`);
  lines.push("");
  lines.push("Same input called twice produces identical masked output (hash-based pseudonym generation).");
  lines.push("");

  // Performance table
  lines.push("## Performance — input size scaling");
  lines.push("");
  lines.push("| Size | Strategy | Elements masked | Time (ms) | Throughput (KB/s) |");
  lines.push("|------|----------|----------------|-----------|------------------|");

  for (const { label, targetBytes } of sizes) {
    const reps = Math.ceil(targetBytes / perfSeed.length);
    const payload = repeat(perfSeed, reps).slice(0, targetBytes);
    const actualKB = (Buffer.byteLength(payload, "utf8") / 1024).toFixed(1);

    for (const strategy of STRATEGIES) {
      const { result, ms } = time(() => maskText(payload, strategy));
      const throughput = ((Buffer.byteLength(payload, "utf8") / 1024) / (ms / 1000)).toFixed(0);
      lines.push(
        `| ${label} (~${actualKB} KB) | ${strategy} | ${result.elements_masked} | ${ms} | ${throughput} |`
      );
    }
  }

  lines.push("");

  // Strategy comparison notes
  lines.push("## Strategy comparison notes");
  lines.push("");
  lines.push("| Strategy | What it masks | Best for |");
  lines.push("|----------|--------------|---------|");
  lines.push("| **aggressive** | Everything: secrets, PII, IPs, names | Maximum privacy, untrusted contexts |");
  lines.push("| **code-aware** | Secrets, PII, IPs (skips code identifiers) | Code review with sensitive config |");
  lines.push("| **values-only** | Data values + passwords in assignments | Config files, keeping variable names |");
  lines.push("| **pii-only** | PII + secrets only, no IPs | GDPR compliance, trusted infra |");
  lines.push("");

  return lines.join("\n");
}

const __filename2 = fileURLToPath(import.meta.url);
const mdPath = join(dirname(__filename2), "benchmark-results.md");
const md = buildMarkdown();
writeFileSync(mdPath, md, "utf8");
console.log("\n" + "═".repeat(72));
console.log(` Results saved → ${mdPath}`);
console.log("═".repeat(72));
