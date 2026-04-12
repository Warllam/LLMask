# LLMask

## What is this project?
LLMask is an open-source privacy proxy for LLMs. It intercepts prompts, masks sensitive data (PII, secrets, org names), sends the masked prompt to the LLM provider, then unmasks the response. Supports OpenAI, Anthropic, Azure OpenAI, Google Gemini, Mistral, and LiteLLM.

## Tech Stack
- **Backend:** Node.js/TypeScript, Fastify 5, SQLite (better-sqlite3), Zod 4, prom-client
- **Frontend:** React 19, Vite 6, Tailwind CSS 3, Recharts 2, react-markdown
- **Code analysis:** web-tree-sitter (AST parsing for code-aware masking)
- **CLI:** Commander.js
- **Tests:** Vitest
- **License:** Apache 2.0
- **Min Node:** 20.19.0

## Architecture
- `src/modules/detection/` — PII and secret detection (regex + entropy + NER)
- `src/modules/rewrite/` — Masking engine V4 (4 strategies: aggressive, code-aware, values-only, pii-only)
- `src/modules/remap/` — Response unmasking (pseudonym → original)
- `src/modules/provider-adapter/` — Multi-provider routing (OpenAI, Anthropic, Azure, Gemini, Mistral, LiteLLM)
- `src/modules/proxy/` — Proxy routes (`/v1/chat/completions`, `/v1/messages`, `/v1/responses`)
- `src/modules/mapping-store/` — SQLite persistence for pseudonym mappings (+ in-memory variant)
- `src/modules/ast/` — Tree-sitter AST analysis for code-aware masking
- `src/modules/dashboard/` — Dashboard REST API routes
- `src/modules/users/` — JWT auth + user management
- `src/modules/custom-rules/` — User-defined masking rules
- `src/modules/project-shield/` — Static string replacement for project/org name masking
- `src/modules/ner-detector/` — Named entity recognition (V4 regex + heuristic engine)
- `src/modules/llm-extractor/` — Optional Ollama-based LLM entity extraction
- `src/modules/audit/` — Audit logging
- `src/modules/metrics/` — Prometheus metrics
- `src/cli/` — CLI tools (`init`, `start`, `test`, `watch`, `chat`, `code`)
- `dashboard/` — React SPA dashboard (served from `dashboard/dist/` at `/dashboard`)
- `browser-extension/` — Chrome extension for ChatGPT/Claude web
- `benchmarks/` — Masking strategy benchmarks
- `tests/` — Unit + integration tests

## Key Commands
- `npm start` — Start the proxy server (default port 8787, uses tsx)
- `npm run dev` — Start with hot reload (tsx watch)
- `npm test` — Run all tests (Vitest)
- `npm run build` — Build server (tsc) + dashboard (vite)
- `npm run build:server` — Build server only
- `npm run typecheck` — Type-check without emitting
- `npx tsx src/cli/index.ts code .` — Interactive code agent with masking
- `npx tsx src/cli/index.ts chat` — Simple masked chat via Claude CLI
- `npx tsx src/cli/index.ts init` — Project setup wizard
- `cd dashboard && npm run dev` — Dashboard dev server

## Default Masking Strategy: code-aware
Masks secrets, PII, and org names while preserving code structure (variable names, function names, class names stay intact). Best balance of privacy and LLM response quality.

The 4 strategies:
- `aggressive` — Masks everything: PII, secrets, identifiers, variable names
- `code-aware` — Smart: lighter rules inside code blocks, full PII masking in prose **(default)**
- `values-only` — Masks data values only; preserves code structure and identifiers
- `pii-only` — Only masks PII (names, emails, phones, IDs) and secrets

Strategy is set per-project in `llmask.config.json` (created by `llmask init`) or via `--strategy` flag on CLI commands.

## Configuration
Config lives in `.env` (see `.env.example`). Key env vars:
- `PRIMARY_PROVIDER` — LLM provider (`openai` | `anthropic` | `gemini` | `mistral` | `azure-openai` | `litellm`)
- `LLMASK_MODE` — Proxy mode: `trust` (auto-mask) or `review` (manual approval)
- `PORT` — Proxy port (default: 8787)
- `LLMASK_AUTH_ENABLED` — Enable JWT dashboard auth (default: false)

## Development Notes
- Tests use Vitest with fork pool (`vitest run`)
- The 1 known failing test (`anthropic-claude-oauth`) is a pre-existing Windows path separator issue
- Dashboard is served as static files from `dashboard/dist/` at `/dashboard`
- The `llmask code` and `llmask chat` CLI commands spawn the Claude CLI as a subprocess
- On Windows, Claude CLI is resolved via `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\cli.js` to avoid `shell: true`
- SQLite DB path defaults to `./data/llmask.db`; mappings are scoped by `scopeId` (per request or session)
