# LLMask MCP Server — Benchmark Results

**Date:** 2026-04-17 11:55:08 UTC  
**Engine:** `mcp-server/src/masker.ts`  
**Node:** v24.13.1  

## Per-case results

| Case | aggressive | code-aware | values-only | pii-only |
|------|-----------|-----------|------------|---------|
| **Emails** | 3 masked (1.111 ms) | 3 masked (0.623 ms) | 3 masked (0.081 ms) | 3 masked (0.024 ms) |
| **API Keys** | 2 masked (0.055 ms) | 2 masked (0.028 ms) | 2 masked (0.016 ms) | 2 masked (0.012 ms) |
| **Database URLs** | 3 masked (0.035 ms) | 3 masked (0.025 ms) | 3 masked (0.031 ms) | 3 masked (0.019 ms) |
| **Phone Numbers** | 2 masked (0.016 ms) | 2 masked (0.01 ms) | 2 masked (0.009 ms) | 2 masked (0.008 ms) |
| **Credit Cards** | 4 masked (0.397 ms) | 4 masked (0.024 ms) | 4 masked (0.012 ms) | 4 masked (0.01 ms) |
| **TypeScript config with secrets** | 14 masked (0.537 ms) | 10 masked (0.062 ms) | 11 masked (0.049 ms) | 7 masked (0.024 ms) |
| **Python ETL with SQL and IPs** | 5 masked (0.068 ms) | 4 masked (0.059 ms) | 3 masked (0.021 ms) | 2 masked (0.014 ms) |
| **Shell deploy script** | 5 masked (0.031 ms) | 4 masked (0.022 ms) | 3 masked (0.016 ms) | 2 masked (0.011 ms) |
| **.env file** | 14 masked (0.075 ms) | 13 masked (0.06 ms) | 10 masked (0.03 ms) | 10 masked (0.025 ms) |
| **Plain text with PII** | 7 masked (0.029 ms) | 5 masked (0.02 ms) | 5 masked (0.016 ms) | 5 masked (0.013 ms) |

## Interesting transformations (aggressive strategy)

| Case | Original | Masked |
|------|----------|--------|
| Emails | `jean-pierre.lambert@fr.nextera.eu` | `opal.orbit@masked.example` |
| API Keys | `sk-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` | `[OPENAI-REDACTED-f40e]` |
| Database URLs | `mysql://reader:R3adOnly!@replica.db.nextera.com:33` | `[DB_URL-REDACTED-d7b5]` |
| Phone Numbers | `+1-800-555-0199` | `+1-555-1774` |
| Credit Cards | `3430109903` | `+1-555-3595` |
| TypeScript config with secrets | `billing@nextera-corp.com` | `fern.trail@masked.example` |
| Python ETL with SQL and IPs | `etl@nextera-corp.com` | `rose.maple@masked.example` |
| Shell deploy script | `devops@nextera-corp.com` | `teal.quill@masked.example` |
| .env file | `ops@nextera-corp.com` | `crisp.prism@masked.example` |
| Plain text with PII | `billing@nextera-corp.com` | `fern.trail@masked.example` |

## Round-trip accuracy

**20/40 passed — 50.0% accuracy**

| Case | Failing strategies |
|------|--------------------|
| `db_urls` | aggressive, code-aware, values-only, pii-only |
| `credit_cards` | aggressive, code-aware, values-only, pii-only |
| `ts_config` | aggressive, code-aware, values-only, pii-only |
| `python_etl` | aggressive, values-only |
| `shell_deploy` | aggressive, values-only |
| `dotenv` | aggressive, code-aware, values-only, pii-only |

### Root causes (bugs discovered)

**Bug 1 — Off-by-one in `secret.password` index calculation**  
In `maskText`, the `secret.password` regex captures group 1 (the value without quotes), but the
index is computed as `m.index + (raw.length - value.length)`. Because `raw` includes the trailing
closing quote but `value` does not, the computed offset is 1 too large. The replacement starts
one character late, leaving the first character of the password in place and consuming the
closing quote — causing text corruption that breaks round-trip unmask.
**Affects:** `ts_config`, `python_etl`, `shell_deploy` (values-only, aggressive strategies).  
**Fix:** Use `m.index! + m[0].indexOf(m[1]!)` to find the exact start of the captured group.

**Bug 2 — Nested pattern overlap (credit card ⊃ phone)**  
The phone regex `\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}` matches 10-digit substrings inside
16-digit credit card numbers (e.g., last 10 digits of `5425233430109903`). Both patterns fire
and are sorted by position descending. The inner (phone) replacement runs first, corrupting the
string; the outer (credit card) replacement then slices using stale original indices, producing
garbled text. Round-trip unmask restores the garbled form, not the original.
**Affects:** `credit_cards` (all strategies).  
**Fix:** After sorting matches by position, skip any match whose range is fully contained in an
already-queued longer match (overlap deduplication).

**Bug 3 — DB URL ↔ email overlap**  
Passwords containing `@` inside database URLs (e.g., `P@ssw0rd@db.internal.nextera.com`) are
matched by both the `secret.db_url` pattern (whole URL) and the `pii.email` pattern
(`ssw0rd@db.internal.nextera.com`). The email replacement runs first (higher index), corrupting
the URL. Same fix as Bug 2 (overlap deduplication).
**Affects:** `db_urls`, `dotenv` (all strategies).

## Pseudonym consistency

**4/4 strategies consistent**

Same input called twice produces identical masked output (hash-based pseudonym generation).

## Performance — input size scaling

| Size | Strategy | Elements masked | Time (ms) | Throughput (KB/s) |
|------|----------|----------------|-----------|------------------|
| 10 KB (~9.8 KB) | aggressive | 7 | 0.3 | 32552 |
| 10 KB (~9.8 KB) | code-aware | 7 | 0.261 | 37416 |
| 10 KB (~9.8 KB) | values-only | 7 | 0.173 | 56449 |
| 10 KB (~9.8 KB) | pii-only | 7 | 0.157 | 62201 |
| 50 KB (~48.8 KB) | aggressive | 7 | 1.408 | 34679 |
| 50 KB (~48.8 KB) | code-aware | 7 | 1.219 | 40056 |
| 50 KB (~48.8 KB) | values-only | 7 | 0.716 | 68196 |
| 50 KB (~48.8 KB) | pii-only | 7 | 0.932 | 52391 |
| 100 KB (~97.7 KB) | aggressive | 8 | 2.602 | 37531 |
| 100 KB (~97.7 KB) | code-aware | 8 | 2.562 | 38117 |
| 100 KB (~97.7 KB) | values-only | 8 | 1.551 | 62963 |
| 100 KB (~97.7 KB) | pii-only | 8 | 1.454 | 67164 |

## Strategy comparison notes

| Strategy | What it masks | Best for |
|----------|--------------|---------|
| **aggressive** | Everything: secrets, PII, IPs, names | Maximum privacy, untrusted contexts |
| **code-aware** | Secrets, PII, IPs (skips code identifiers) | Code review with sensitive config |
| **values-only** | Data values + passwords in assignments | Config files, keeping variable names |
| **pii-only** | PII + secrets only, no IPs | GDPR compliance, trusted infra |
