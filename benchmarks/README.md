# LLMask Benchmark Framework

Evaluates different masking strategies and their impact on LLM response quality.

## Problem

LLMask's current rewrite engine masks aggressively — including variable names, function names, and technical identifiers that aren't sensitive but are critical for LLM comprehension. This degrades response quality.

## Masking Strategies Compared

| Strategy | What gets masked | What's preserved |
|----------|-----------------|------------------|
| **aggressive** | Everything: identifiers, values, names, IPs, all entities | Nothing — maximum privacy, minimum context |
| **values-only** | Data values (strings, IPs, keys, PII) | Variable/function/method names, code structure |
| **pii-only** | Only PII & secrets (emails, phones, API keys, names) | All code identifiers, non-sensitive values |
| **code-aware** | Full masking on natural language; light masking inside code blocks | Code structure + identifiers inside code fences |

## Test Cases

8 diverse prompts covering:
1. Velocity template + SQL schema adaptation
2. Python refactoring with company-specific names
3. SQL query optimization with real table/column names
4. DevOps Docker/K8s config with internal hostnames
5. Code review with proprietary function names
6. Natural language email drafting with PII
7. Mixed code + PII explanation task
8. JavaScript/TypeScript API integration

## Metrics

- **Privacy Score** (0-100): How much sensitive data is protected
- **Semantic Preservation** (0-100): How much context remains for the LLM
- **Response Quality** (0-100): Correctness/completeness vs unmasked baseline
- **Leakage Risk** (0-100): What sensitive info could leak (lower = safer)

## Usage

```bash
# Run a single benchmark
npx tsx benchmarks/runner.ts --strategy aggressive --prompt benchmarks/prompts/01-velocity-template.json

# Run all strategies against one prompt
npx tsx benchmarks/runner.ts --strategy all --prompt benchmarks/prompts/01-velocity-template.json

# Run everything
npx tsx benchmarks/runner.ts --all

# Use direct Anthropic API instead of LLMask proxy
BENCHMARK_MODE=direct ANTHROPIC_API_KEY=sk-... npx tsx benchmarks/runner.ts --all

# Dry run (apply masking, show what would be sent, don't call LLM)
npx tsx benchmarks/runner.ts --all --dry-run
```

## Configuration

Environment variables:
- `BENCHMARK_MODE`: `proxy` (default, uses localhost:8787) or `direct` (Anthropic API)
- `ANTHROPIC_API_KEY`: Required for direct mode
- `LLMASK_PROXY_URL`: Override proxy URL (default: `http://localhost:8787`)
- `BENCHMARK_MODEL`: Model to use (default: `claude-sonnet-4-20250514`)
- `BENCHMARK_CONCURRENCY`: Max parallel LLM calls (default: `2`)

## Output

Results are saved as JSON in `benchmarks/results/` and a comparison table is printed to stdout.
