#!/usr/bin/env tsx
/**
 * LLMask Benchmark Runner
 *
 * Usage:
 *   npx tsx benchmarks/runner.ts --strategy aggressive --prompt benchmarks/prompts/01-velocity-template.json
 *   npx tsx benchmarks/runner.ts --strategy all --prompt benchmarks/prompts/01-velocity-template.json
 *   npx tsx benchmarks/runner.ts --all
 *   npx tsx benchmarks/runner.ts --all --dry-run
 *   npx tsx benchmarks/runner.ts --all --include-baseline
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "fs";
import { join, basename } from "path";
import { parseArgs } from "util";

import { STRATEGIES, STRATEGY_IDS } from "./strategies";
import type { MaskingStrategy } from "./strategies";
import { applyMasking } from "./masker";
import {
  computeFullScore,
  computeBaselineScore,
  type PromptSpec,
  type BenchmarkScore,
} from "./scorer";

// ─── Config ─────────────────────────────────────────────────────────────────

const BENCHMARK_MODE = process.env.BENCHMARK_MODE || "direct";
const LLMASK_PROXY_URL = process.env.LLMASK_PROXY_URL || "http://localhost:8787";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

function getAnthropicAuth(): { header: string; value: string } {
  if (process.env.ANTHROPIC_API_KEY) {
    return { header: "x-api-key", value: process.env.ANTHROPIC_API_KEY };
  }
  // Try OAuth token from Claude CLI
  try {
    const creds = JSON.parse(readFileSync(join(homedir(), ".claude", ".credentials.json"), "utf-8"));
    const token = creds?.claudeAiOauth?.accessToken;
    if (token) return { header: "Authorization", value: `Bearer ${token}` };
  } catch {}
  return { header: "", value: "" };
}
const anthropicAuth = getAnthropicAuth();
const BENCHMARK_MODEL = process.env.BENCHMARK_MODEL || "claude-3-haiku-20240307";
const BENCHMARK_CONCURRENCY = parseInt(process.env.BENCHMARK_CONCURRENCY || "2", 10);

import { fileURLToPath } from "url";
const __benchdir = fileURLToPath(new URL(".", import.meta.url));
const PROMPTS_DIR = join(__benchdir, "prompts");
const RESULTS_DIR = join(__benchdir, "results");

// ─── CLI Parsing ────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    strategy: { type: "string", short: "s" },
    prompt: { type: "string", short: "p" },
    all: { type: "boolean" },
    "dry-run": { type: "boolean" },
    "include-baseline": { type: "boolean" },
    verbose: { type: "boolean", short: "v" },
    help: { type: "boolean", short: "h" },
  },
  strict: true,
});

if (args.help) {
  console.log(`
LLMask Benchmark Runner

Usage:
  npx tsx benchmarks/runner.ts --all                          Run all strategies × all prompts
  npx tsx benchmarks/runner.ts --strategy aggressive --all    Run one strategy × all prompts
  npx tsx benchmarks/runner.ts --all --dry-run                Show masking results without LLM calls
  npx tsx benchmarks/runner.ts -s pii-only -p prompts/01-velocity-template.json
  npx tsx benchmarks/runner.ts --all --include-baseline       Include unmasked baseline

Environment:
  BENCHMARK_MODE=proxy|direct    Use LLMask proxy or direct Anthropic API (default: direct)
  ANTHROPIC_API_KEY=sk-...       Required for direct mode
  BENCHMARK_MODEL=...            Model to use (default: claude-sonnet-4-20250514)
  LLMASK_PROXY_URL=...           Proxy URL (default: http://localhost:8787)
`);
  process.exit(0);
}

// ─── Prompt Loading ─────────────────────────────────────────────────────────

function loadPrompt(promptPath: string): PromptSpec {
  // Handle absolute paths on both Unix (/...) and Windows (C:\... or C:/...)
  const isAbsolute = promptPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(promptPath);
  const resolved = isAbsolute ? promptPath : join(process.cwd(), promptPath);
  return JSON.parse(readFileSync(resolved, "utf-8"));
}

function loadAllPrompts(): PromptSpec[] {
  const files = readdirSync(PROMPTS_DIR).filter((f) => f.endsWith(".json")).sort();
  return files.map((f) => loadPrompt(join(PROMPTS_DIR, f)));
}

// ─── LLM Calls ─────────────────────────────────────────────────────────────

async function callLLM(prompt: string): Promise<{ content: string; tokensUsed: number; latencyMs: number }> {
  const start = Date.now();

  if (BENCHMARK_MODE === "proxy") {
    // Use LLMask proxy (OpenAI-compatible)
    const response = await fetch(`${LLMASK_PROXY_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: BENCHMARK_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 4096,
      }),
    });
    if (!response.ok) throw new Error(`Proxy error: ${response.status} ${await response.text()}`);
    const data = await response.json() as any;
    return {
      content: data.choices[0].message.content,
      tokensUsed: data.usage?.total_tokens ?? 0,
      latencyMs: Date.now() - start,
    };
  } else {
    // Direct Anthropic API
    if (!anthropicAuth.value) {
      throw new Error("No Anthropic credentials found. Set ANTHROPIC_API_KEY or install Claude CLI (claude) and login.");
    }
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [anthropicAuth.header]: anthropicAuth.value,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
      },
      body: JSON.stringify({
        model: BENCHMARK_MODEL,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) throw new Error(`Anthropic error: ${response.status} ${await response.text()}`);
    const data = await response.json() as any;
    const content = data.content.map((b: any) => b.text).join("");
    return {
      content,
      tokensUsed: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      latencyMs: Date.now() - start,
    };
  }
}

// ─── Concurrency Limiter ────────────────────────────────────────────────────

async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  const pending: Promise<void>[] = [];

  for (let i = 0; i < items.length; i++) {
    const promise = fn(items[i]).then((r) => { results[i] = r; });
    pending.push(promise);
    if (pending.length >= concurrency) {
      await Promise.race(pending);
      // Remove settled promises
      for (let j = pending.length - 1; j >= 0; j--) {
        const settled = await Promise.race([pending[j].then(() => true), Promise.resolve(false)]);
        if (settled) pending.splice(j, 1);
      }
    }
  }
  await Promise.all(pending);
  return results;
}

// ─── Single Benchmark Run ───────────────────────────────────────────────────

interface RunResult {
  score: BenchmarkScore;
  maskedPrompt: string;
  llmResponse: string;
  latencyMs: number;
  tokensUsed: number;
}

async function runSingleBenchmark(
  spec: PromptSpec,
  strategy: MaskingStrategy,
  dryRun: boolean,
  verbose: boolean,
): Promise<RunResult> {
  // Apply masking
  const maskResult = applyMasking(spec, strategy);

  if (verbose) {
    console.log(`\n  ── Masked prompt preview (${strategy.id}) ──`);
    console.log(maskResult.maskedPrompt.slice(0, 500) + "...\n");
  }

  if (dryRun) {
    // Score masking quality without calling LLM
    const score = computeFullScore(spec, maskResult.maskedPrompt, maskResult, "[DRY RUN - no LLM response]");
    score.strategyId = strategy.id;
    score.responseQuality = -1; // Not measured
    return {
      score,
      maskedPrompt: maskResult.maskedPrompt,
      llmResponse: "[DRY RUN]",
      latencyMs: 0,
      tokensUsed: 0,
    };
  }

  // Call LLM with masked prompt
  const llmResult = await callLLM(maskResult.maskedPrompt);

  // Score
  const score = computeFullScore(spec, maskResult.maskedPrompt, maskResult, llmResult.content);
  score.strategyId = strategy.id;

  return {
    score,
    maskedPrompt: maskResult.maskedPrompt,
    llmResponse: llmResult.content,
    latencyMs: llmResult.latencyMs,
    tokensUsed: llmResult.tokensUsed,
  };
}

async function runBaseline(
  spec: PromptSpec,
  dryRun: boolean,
): Promise<RunResult> {
  if (dryRun) {
    return {
      score: { ...computeBaselineScore(spec, "[DRY RUN]"), responseQuality: -1 },
      maskedPrompt: spec.prompt,
      llmResponse: "[DRY RUN]",
      latencyMs: 0,
      tokensUsed: 0,
    };
  }

  const llmResult = await callLLM(spec.prompt);
  const score = computeBaselineScore(spec, llmResult.content);

  return {
    score,
    maskedPrompt: spec.prompt,
    llmResponse: llmResult.content,
    latencyMs: llmResult.latencyMs,
    tokensUsed: llmResult.tokensUsed,
  };
}

// ─── Output Formatting ─────────────────────────────────────────────────────

function printComparisonTable(results: RunResult[]) {
  // Group by prompt
  const byPrompt = new Map<string, RunResult[]>();
  for (const r of results) {
    const key = r.score.promptId;
    if (!byPrompt.has(key)) byPrompt.set(key, []);
    byPrompt.get(key)!.push(r);
  }

  console.log("\n" + "═".repeat(110));
  console.log("  LLMask Benchmark Results");
  console.log("═".repeat(110));

  // Summary table across all prompts
  const strategyAverages = new Map<string, { privacy: number[]; semantic: number[]; quality: number[]; leakage: number[] }>();

  for (const [promptId, runs] of byPrompt) {
    console.log(`\n┌─ ${promptId} ${"─".repeat(Math.max(0, 95 - promptId.length))}┐`);
    console.log(`│ ${"Strategy".padEnd(18)} │ ${"Privacy".padEnd(9)} │ ${"Semantic".padEnd(10)} │ ${"Quality".padEnd(9)} │ ${"Leakage".padEnd(9)} │ ${"Latency".padEnd(9)} │ ${"Tokens".padEnd(8)} │`);
    console.log(`├${"─".repeat(20)}┼${"─".repeat(11)}┼${"─".repeat(12)}┼${"─".repeat(11)}┼${"─".repeat(11)}┼${"─".repeat(11)}┼${"─".repeat(10)}┤`);

    for (const r of runs) {
      const s = r.score;
      const sid = s.strategyId.padEnd(18);
      const priv = s.privacy === -1 ? "N/A".padEnd(9) : colorScore(s.privacy, true).padEnd(9);
      const sem = colorScore(s.semanticPreservation).padEnd(10);
      const qual = s.responseQuality === -1 ? "N/A".padEnd(9) : colorScore(s.responseQuality).padEnd(9);
      const leak = s.leakageRisk === -1 ? "N/A".padEnd(9) : colorScore(100 - s.leakageRisk).padEnd(9);
      const lat = r.latencyMs > 0 ? `${(r.latencyMs / 1000).toFixed(1)}s`.padEnd(9) : "N/A".padEnd(9);
      const tok = r.tokensUsed > 0 ? `${r.tokensUsed}`.padEnd(8) : "N/A".padEnd(8);

      console.log(`│ ${sid} │ ${priv} │ ${sem} │ ${qual} │ ${leak} │ ${lat} │ ${tok} │`);

      // Accumulate averages
      if (!strategyAverages.has(s.strategyId)) {
        strategyAverages.set(s.strategyId, { privacy: [], semantic: [], quality: [], leakage: [] });
      }
      const avg = strategyAverages.get(s.strategyId)!;
      if (s.privacy >= 0) avg.privacy.push(s.privacy);
      avg.semantic.push(s.semanticPreservation);
      if (s.responseQuality >= 0) avg.quality.push(s.responseQuality);
      if (s.leakageRisk >= 0) avg.leakage.push(s.leakageRisk);
    }
    console.log(`└${"─".repeat(20)}┴${"─".repeat(11)}┴${"─".repeat(12)}┴${"─".repeat(11)}┴${"─".repeat(11)}┴${"─".repeat(11)}┴${"─".repeat(10)}┘`);
  }

  // Print overall summary
  console.log("\n" + "═".repeat(80));
  console.log("  Overall Averages");
  console.log("═".repeat(80));
  console.log(`  ${"Strategy".padEnd(18)} │ ${"Privacy".padEnd(9)} │ ${"Semantic".padEnd(10)} │ ${"Quality".padEnd(9)} │ ${"Leakage".padEnd(9)} │`);
  console.log(`  ${"─".repeat(18)} ┼ ${"─".repeat(9)} ┼ ${"─".repeat(10)} ┼ ${"─".repeat(9)} ┼ ${"─".repeat(9)} ┤`);

  for (const [sid, avg] of strategyAverages) {
    const mean = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : -1;
    const priv = mean(avg.privacy);
    const sem = mean(avg.semantic);
    const qual = mean(avg.quality);
    const leak = mean(avg.leakage);

    console.log(
      `  ${sid.padEnd(18)} │ ${priv >= 0 ? colorScore(priv, true).padEnd(9) : "N/A".padEnd(9)} │ ` +
      `${colorScore(sem).padEnd(10)} │ ${qual >= 0 ? colorScore(qual).padEnd(9) : "N/A".padEnd(9)} │ ` +
      `${leak >= 0 ? colorScore(100 - leak).padEnd(9) : "N/A".padEnd(9)} │`
    );
  }
  console.log("");
}

function colorScore(score: number, invertColor = false): string {
  // ANSI colors for terminal output
  const val = invertColor ? score : score;
  const icon = val >= 80 ? "🟢" : val >= 50 ? "🟡" : "🔴";
  return `${icon} ${score}`;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const dryRun = args["dry-run"] ?? false;
  const verbose = args.verbose ?? false;
  const includeBaseline = args["include-baseline"] ?? false;

  // Determine which prompts to run
  let prompts: PromptSpec[];
  if (args.all || (!args.prompt && !args.strategy)) {
    prompts = loadAllPrompts();
  } else if (args.prompt) {
    prompts = [loadPrompt(args.prompt)];
  } else {
    prompts = loadAllPrompts();
  }

  // Determine which strategies to run
  let strategyIds: string[];
  if (args.all || args.strategy === "all" || !args.strategy) {
    strategyIds = STRATEGY_IDS;
  } else {
    if (!STRATEGIES[args.strategy]) {
      console.error(`Unknown strategy: ${args.strategy}. Available: ${STRATEGY_IDS.join(", ")}`);
      process.exit(1);
    }
    strategyIds = [args.strategy];
  }

  console.log(`🔬 LLMask Benchmark`);
  console.log(`   Mode: ${BENCHMARK_MODE} | Model: ${BENCHMARK_MODEL} | Dry run: ${dryRun}`);
  console.log(`   Strategies: ${strategyIds.join(", ")}`);
  console.log(`   Prompts: ${prompts.map((p) => p.id).join(", ")}`);
  console.log("");

  // Build run list
  const runs: Array<{ spec: PromptSpec; strategy: MaskingStrategy | null }> = [];
  for (const spec of prompts) {
    if (includeBaseline) {
      runs.push({ spec, strategy: null }); // null = baseline
    }
    for (const sid of strategyIds) {
      runs.push({ spec, strategy: STRATEGIES[sid] });
    }
  }

  // Execute
  const allResults: RunResult[] = [];
  let completed = 0;

  for (const run of runs) {
    const label = run.strategy ? `${run.strategy.id} × ${run.spec.id}` : `baseline × ${run.spec.id}`;
    process.stdout.write(`  [${++completed}/${runs.length}] ${label}...`);

    try {
      const result = run.strategy
        ? await runSingleBenchmark(run.spec, run.strategy, dryRun, verbose)
        : await runBaseline(run.spec, dryRun);
      allResults.push(result);
      console.log(` ✓`);
    } catch (err: any) {
      console.log(` ✗ ${err.message}`);
      // Push a failed result
      allResults.push({
        score: {
          strategyId: run.strategy?.id ?? "baseline",
          promptId: run.spec.id,
          privacy: -1,
          semanticPreservation: -1,
          responseQuality: -1,
          leakageRisk: -1,
          details: {
            sensitiveElementsMasked: [],
            sensitiveElementsLeaked: [],
            expectedElementsFound: [],
            expectedElementsMissing: [],
            codeStructurePreserved: false,
            maskingArtifacts: [],
          },
        },
        maskedPrompt: "",
        llmResponse: `ERROR: ${err.message}`,
        latencyMs: 0,
        tokensUsed: 0,
      });
    }
  }

  // Print results table
  printComparisonTable(allResults);

  // Save results
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const resultFile = join(RESULTS_DIR, `benchmark-${timestamp}.json`);

  const output = {
    timestamp: new Date().toISOString(),
    config: {
      mode: BENCHMARK_MODE,
      model: BENCHMARK_MODEL,
      dryRun,
      strategies: strategyIds,
      prompts: prompts.map((p) => p.id),
    },
    results: allResults.map((r) => ({
      score: r.score,
      latencyMs: r.latencyMs,
      tokensUsed: r.tokensUsed,
      maskedPromptLength: r.maskedPrompt.length,
      responseLength: r.llmResponse.length,
    })),
  };

  writeFileSync(resultFile, JSON.stringify(output, null, 2));
  console.log(`📁 Results saved to: ${resultFile}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
