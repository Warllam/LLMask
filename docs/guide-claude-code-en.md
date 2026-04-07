# Protect Your Claude Code in 5 Minutes with LLMask

> **TL;DR** — LLMask sits between Claude Code and the Anthropic API. It masks sensitive data in your code before it leaves your machine, then restores it in the response. Transparent, configurable, negligible overhead.

---

## 1. Why It Matters

Every time you use **Claude Code**, **GitHub Copilot**, or **Codex CLI**, your prompts travel in plain text to the LLM provider's servers. That includes:

- API keys and tokens (`STRIPE_SECRET_KEY`, `DATABASE_URL`, JWTs…)
- Client names and internal project names
- Database schemas and table names
- Email addresses and PII
- Internal hostnames and infrastructure details

**LLMask** runs as a local proxy. It intercepts each request, replaces sensitive values with neutral tokens (`[EMAIL_1]`, `[API_KEY_2]`…), forwards the sanitised request to Anthropic, then re-injects the real values into the response — transparently, in milliseconds.

---

## 2. Installation

```bash
npm install -g llmask
```

**Docker alternative:**

```bash
docker run -d --name llmask -p 3456:3456 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  ghcr.io/llmask/llmask:latest
```

---

## 3. Configuration

```bash
llmask init
```

```
? LLM provider        › Anthropic      ← required for Claude Code
? Anthropic API key   › sk-ant-...     ← stored locally
? Masking strategy    › aggressive     ← recommended for maximum protection
? Local port          › 3456
```

**Strategies:** `conservative` (keys + emails only) → `balanced` → `aggressive` (everything identifiable, recommended).

---

## 4. Point Claude Code at LLMask

Claude Code reads the `ANTHROPIC_BASE_URL` environment variable to determine where to send API requests.

**Persistent (recommended)** — add to `~/.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:3456"
  }
}
```

**Per-project only** — add to `.claude/settings.local.json` at the repo root (gitignored):

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:3456"
  }
}
```

**Current shell session only:**

```bash
export ANTHROPIC_BASE_URL=http://localhost:3456
claude
```

> LLMask injects your Anthropic API key into every proxied request, so you don't need `ANTHROPIC_API_KEY` in your environment.

---

## 5. Verify It Works

```bash
llmask start
llmask test
```

Expected output:

```
LLMask Test — Anthropic / claude-sonnet-4-6
────────────────────────────────────────────
Sent (masked):     "My email is [EMAIL_1] and key is [API_KEY_1]. Explain this."
Received (restored): "My email is alice@acme.com and key is sk-ant-abc123. ..."

Masking OK ✓   Restoration OK ✓   Latency: 12ms
```

Then open Claude Code as usual — masking happens automatically on every prompt.

---

## 6. Tips

**Project-specific rules** — create `.llmaskrc` at the repo root:

```json
{
  "strategy": "aggressive",
  "rules": [
    { "pattern": "acme-corp", "replacement": "[CLIENT_NAME]" },
    { "pattern": "prod-db\\.internal", "replacement": "[DB_HOST]" }
  ]
}
```

**Live monitoring:**

```bash
llmask watch   # stream masked/unmasked diffs in real time
llmask stop    # disable the proxy
```

---

## 7. What Gets Protected

| Category | Examples |
|---|---|
| API keys & tokens | `sk-ant-...`, `ghp_...`, AWS `AKIA...`, JWTs |
| Connection strings | `DATABASE_URL`, passwords in config files |
| PII | Email addresses, phone numbers, names |
| Project & client names | Via context detection or `.llmaskrc` rules |
| Database schemas | Table names, column names, migrations |
| Environment variables | Any `UPPER_SNAKE_CASE=value` pattern |
| Internal hosts & IPs | Private IPs, `.internal` / `.local` domains |

Substitutes are **consistent within a session** — the same value always maps to the same token, so Claude can reason about your code correctly without ever seeing the real data.

---

## Resources

- Docs & source: [github.com/llmask/llmask](https://github.com/llmask/llmask)
- Local dashboard: [http://localhost:3456/dashboard](http://localhost:3456/dashboard)
