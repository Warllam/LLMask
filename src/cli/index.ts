#!/usr/bin/env node
import { Command } from "commander";
import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { findConfigPath, loadProjectConfig, writeProjectConfig } from "./llmaskrc";

// ─── Provider & strategy metadata ─────────────────────────────────────────────

const PROVIDERS = [
  { id: "openai",       name: "OpenAI",        keyVar: "OPENAI_API_KEY",       baseUrl: "https://api.openai.com" },
  { id: "anthropic",    name: "Anthropic",      keyVar: "ANTHROPIC_API_KEY",    baseUrl: "https://api.anthropic.com" },
  { id: "azure-openai", name: "Azure OpenAI",   keyVar: "AZURE_OPENAI_API_KEY", baseUrl: "" },
  { id: "gemini",       name: "Google Gemini",  keyVar: "GEMINI_API_KEY",       baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { id: "mistral",      name: "Mistral AI",     keyVar: "MISTRAL_API_KEY",      baseUrl: "https://api.mistral.ai" },
] as const;

const STRATEGIES = [
  { id: "aggressive",  description: "Masks everything: PII, secrets, identifiers, variable names" },
  { id: "values-only", description: "Masks data values only; preserves code structure and identifiers" },
  { id: "pii-only",    description: "Only masks PII (names, emails, phones, IDs) and secrets" },
  { id: "code-aware",  description: "Smart: lighter rules inside code blocks, full PII masking in prose" },
] as const;

// ─── Utility helpers ───────────────────────────────────────────────────────────

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

/** Poll /health until the server responds 200 or timeout. */
function waitForServer(port: number, maxWaitMs = 20_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + maxWaitMs;
    const attempt = () => {
      const req = http.request(
        { host: "127.0.0.1", port, path: "/health", method: "GET" },
        (res) => {
          if (res.statusCode === 200) resolve();
          else retry();
        }
      );
      req.on("error", retry);
      req.end();
    };
    const retry = () => {
      if (Date.now() >= deadline) {
        reject(new Error("Timed out waiting for server to start"));
      } else {
        setTimeout(attempt, 300);
      }
    };
    attempt();
  });
}

/** POST multipart/form-data with a single text file part. */
function postTextFile(
  port: number,
  urlPath: string,
  content: string,
  filename: string
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const boundary = `LLMaskBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;
    const textBuf = Buffer.from(content, "utf-8");
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n`
      ),
      textBuf,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: urlPath,
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/** GET and return the response body. */
function httpGet(port: number, urlPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path: urlPath, method: "GET" },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

/** Resolve the compiled server entry point relative to this CLI file. */
function serverEntryPath(): string {
  // __dirname = dist/cli  →  dist/index.js
  return path.resolve(__dirname, "..", "index.js");
}

/**
 * Parse a .env file into key/value pairs (best-effort, no variable expansion).
 * Returns a plain object that can be merged into process.env.
 */
function parseDotenv(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    const lines = fs.readFileSync(filePath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (key) result[key] = val;
    }
  } catch { /* ignore */ }
  return result;
}

/** Spawn the server process, merging extra env vars on top of any local .env. */
function spawnServer(
  extraEnv: Record<string, string>,
  stdio: "inherit" | "pipe"
): ChildProcess {
  const envFile = path.join(process.cwd(), ".env");
  const dotenvVars = fs.existsSync(envFile) ? parseDotenv(envFile) : {};
  return spawn(process.execPath, [serverEntryPath()], {
    env: { ...process.env, ...dotenvVars, ...extraEnv },
    cwd: process.cwd(),
    stdio: [stdio, stdio, stdio === "inherit" ? "inherit" : "pipe"],
  });
}

// ─── CLI program ───────────────────────────────────────────────────────────────

const program = new Command();

program
  .name("llmask")
  .description("Privacy proxy for LLMs — mask PII before it reaches any AI")
  .version("0.1.0");

// ─── init ─────────────────────────────────────────────────────────────────────

program
  .command("init")
  .description("Interactive setup wizard — creates .env and llmask.config.json")
  .action(async () => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log("\nWelcome to LLMask!\n");

    // Warn if a config already exists
    const existing = findConfigPath(process.cwd());
    if (existing) {
      const rel = path.relative(process.cwd(), existing);
      const overwrite = (await ask(rl, `Config already exists at ${rel}. Overwrite? [y/N] `)).trim().toLowerCase();
      if (overwrite !== "y" && overwrite !== "yes") {
        console.log("Aborted.\n");
        rl.close();
        return;
      }
    }

    try {
      // 1. Provider
      console.log("Available providers:");
      PROVIDERS.forEach((p, i) => console.log(`  ${i + 1}. ${p.name}`));
      let providerIdx = 0;
      while (true) {
        const input = (await ask(rl, "\nSelect provider [1]: ")).trim() || "1";
        const n = parseInt(input, 10) - 1;
        if (n >= 0 && n < PROVIDERS.length) { providerIdx = n; break; }
        console.log(`  Please enter a number between 1 and ${PROVIDERS.length}`);
      }
      const provider = PROVIDERS[providerIdx];

      // 2. API key
      const apiKey = (await ask(rl, `\n${provider.name} API key (leave blank to configure later): `)).trim();

      // 3. Masking strategy
      console.log("\nMasking strategies:");
      STRATEGIES.forEach((s, i) =>
        console.log(`  ${i + 1}. ${s.id.padEnd(12)}  ${s.description}`)
      );
      let strategyIdx = 0;
      while (true) {
        const input = (await ask(rl, "\nSelect strategy [1 = aggressive]: ")).trim() || "1";
        const n = parseInt(input, 10) - 1;
        if (n >= 0 && n < STRATEGIES.length) { strategyIdx = n; break; }
        console.log(`  Please enter a number between 1 and ${STRATEGIES.length}`);
      }
      const strategy = STRATEGIES[strategyIdx];

      // 4. Port
      let port = 3456;
      while (true) {
        const input = (await ask(rl, "\nPort [3456]: ")).trim();
        if (!input) break;
        const n = parseInt(input, 10);
        if (!isNaN(n) && n > 0 && n < 65536) { port = n; break; }
        console.log("  Please enter a valid port number (1–65535)");
      }

      // Write .env
      const envLines = [
        "# Generated by llmask init",
        `PRIMARY_PROVIDER=${provider.id}`,
        `${provider.keyVar}=${apiKey}`,
        `PORT=${port}`,
        "HOST=127.0.0.1",
        "LOG_LEVEL=info",
        "LLMASK_MODE=trust",
        "DATA_DIR=./data",
        "SQLITE_PATH=./data/llmask.db",
      ];
      fs.writeFileSync(path.join(process.cwd(), ".env"), envLines.join("\n") + "\n", "utf-8");

      // Write llmask.config.json
      writeProjectConfig(process.cwd(), { strategy: strategy.id, port, provider: provider.id });

      console.log("\n✓ Created .env");
      console.log("✓ Created llmask.config.json");
      console.log(`\nNext steps:`);
      console.log(`  llmask test    — verify masking with fake PII`);
      console.log(`  llmask start   — start the proxy on port ${port}`);
      console.log(`\nPoint your LLM client at http://127.0.0.1:${port}/v1\n`);
    } finally {
      rl.close();
    }
  });

// ─── start ────────────────────────────────────────────────────────────────────

program
  .command("start")
  .description("Start the LLMask proxy server")
  .option("-p, --port <port>", "Port to listen on (overrides .env)")
  .action((opts: { port?: string }) => {
    const extraEnv: Record<string, string> = {};
    if (opts.port) extraEnv.PORT = opts.port;

    const envFile = path.join(process.cwd(), ".env");
    if (!fs.existsSync(envFile) && !findConfigPath(process.cwd())) {
      console.log("No .env found. Run `llmask init` first.\n");
    }

    const projectConfig = loadProjectConfig(process.cwd());
    if (projectConfig.port && !opts.port) extraEnv.PORT = String(projectConfig.port);

    const proc = spawnServer(extraEnv, "inherit");

    // Forward signals so Ctrl+C shuts down the child cleanly
    process.on("SIGINT", () => proc.kill("SIGINT"));
    process.on("SIGTERM", () => proc.kill("SIGTERM"));
    proc.on("exit", (code) => process.exit(code ?? 0));
  });

// ─── test ─────────────────────────────────────────────────────────────────────

program
  .command("test")
  .description("Send fake PII through the proxy and show what gets masked")
  .option("-p, --port <port>", "Proxy port to use", "3456")
  .action(async (opts: { port: string }) => {
    const port = parseInt(opts.port, 10);

    const TEST_TEXT = [
      "Hi, my name is John Smith and I work at Acme Corporation.",
      "You can reach me at john.smith@acme-corp.com or +1-555-867-5309.",
      "My social security number is 123-45-6789 — keep it confidential.",
      "The project uses API key sk-abc123def456ghi789jkl012mno345pqr for authentication.",
      "Internal endpoint: api.internal.acme.com:8080 (do not expose).",
    ].join("\n");

    // Try to connect to an already-running proxy before starting a new one
    let tempProc: ChildProcess | null = null;
    let serverOwned = false;

    try {
      await waitForServer(port, 1_500);
      console.log(`\nConnected to running proxy on port ${port}.`);
    } catch {
      console.log(`\nStarting proxy on port ${port} for this test...`);
      tempProc = spawnServer({ PORT: String(port), LOG_LEVEL: "silent" }, "pipe");
      try {
        await waitForServer(port, 20_000);
        serverOwned = true;
      } catch {
        tempProc.kill();
        console.error(
          "\nCould not start the proxy. Run `llmask start` in another terminal to diagnose.\n"
        );
        process.exit(1);
      }
    }

    const hr = "─".repeat(60);

    try {
      console.log(`\nOriginal text:\n${hr}`);
      console.log(TEST_TEXT);
      console.log(hr);

      const result = await postTextFile(port, "/v1/files/anonymize", TEST_TEXT, "test.txt");

      if (result.status !== 200) {
        console.error(`\nProxy returned ${result.status}: ${result.body}\n`);
        process.exit(1);
      }

      const data = JSON.parse(result.body) as {
        anonymizedContent: string;
        transformedCount: number;
        scopeId: string;
      };

      console.log(`\nMasked output:\n${hr}`);
      console.log(data.anonymizedContent);
      console.log(hr);

      if (data.transformedCount === 0) {
        console.log("\nNo items were masked. Check your strategy in llmask.config.json.");
      } else {
        console.log(`\n${data.transformedCount} item(s) detected and masked.`);

        // Fetch the actual mappings created in this scope
        const mappingsRes = await httpGet(
          port,
          `/dashboard/api/mappings/${encodeURIComponent(data.scopeId)}`
        );
        if (mappingsRes.status === 200) {
          const mappings = JSON.parse(mappingsRes.body) as Array<{
            kind: string;
            originalValue: string;
            pseudonym: string;
          }>;
          if (mappings.length > 0) {
            console.log("\nDetected entities:");
            const kindWidth = Math.max(...mappings.map((m) => m.kind.length), 4);
            for (const m of mappings) {
              console.log(
                `  ${m.kind.padEnd(kindWidth)}  ${m.originalValue.padEnd(30)} → ${m.pseudonym}`
              );
            }
          }
        }
      }

      console.log();
    } finally {
      if (serverOwned && tempProc) tempProc.kill();
    }
  });

// ─── watch ────────────────────────────────────────────────────────────────────

program
  .command("watch")
  .description("Start proxy with real-time stdout log of every masking event")
  .option("-p, --port <port>", "Port to listen on (overrides .env)")
  .action(async (opts: { port?: string }) => {
    const projectConfig = loadProjectConfig(process.cwd());
    const extraEnv: Record<string, string> = { LOG_LEVEL: "error" };
    if (opts.port) extraEnv.PORT = opts.port;
    else if (projectConfig.port) extraEnv.PORT = String(projectConfig.port);

    const port = parseInt(extraEnv.PORT ?? "3456", 10);

    const proc = spawnServer(extraEnv, "pipe");

    process.on("SIGINT", () => { proc.kill("SIGINT"); process.exit(0); });
    process.on("SIGTERM", () => { proc.kill("SIGTERM"); process.exit(0); });
    proc.on("exit", (code) => process.exit(code ?? 0));

    // Wait for server to be ready
    try {
      await waitForServer(port, 20_000);
    } catch {
      proc.kill();
      console.error("\nServer failed to start. Check your .env configuration.\n");
      process.exit(1);
    }

    console.log(`\nLLMask is running on port ${port}. Watching masking events...\n`);
    console.log(`  Proxy :  http://127.0.0.1:${port}/v1`);
    console.log(`  Dashboard: http://127.0.0.1:${port}/dashboard`);
    console.log(`\nPress Ctrl+C to stop.\n`);
    console.log("─".repeat(60));

    // Subscribe to the live SSE feed
    const sseReq = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/dashboard/api/live",
        method: "GET",
        headers: { Accept: "text/event-stream" },
      },
      (res) => {
        let buf = "";
        res.on("data", (chunk: Buffer) => {
          buf += chunk.toString();
          // SSE events are separated by double newlines
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";
          for (const part of parts) {
            for (const line of part.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              const raw = line.slice(6);
              let event: Record<string, unknown>;
              try { event = JSON.parse(raw) as Record<string, unknown>; } catch { continue; }
              if (event.type !== "masking") continue;

              const time = new Date(event.timestamp as string).toLocaleTimeString();
              const count = event.transformedCount as number;
              const endpoint = String(event.endpoint ?? "?");
              const model = event.model ? ` [${event.model}]` : "";
              const kinds = (event.entityKinds as string[] | undefined)?.join(", ") || "—";
              const preview = event.preview ? `  "${event.preview}"` : "";

              console.log(
                `[${time}] ${endpoint}${model}  →  ${count} masked  (${kinds})${preview}`
              );
            }
          }
        });
        res.on("error", (err) => {
          console.error("Live feed disconnected:", (err as Error).message);
        });
      }
    );
    sseReq.on("error", (err) => {
      console.error("Could not connect to live feed:", (err as Error).message);
    });
    sseReq.end();
  });

// ─── auth ─────────────────────────────────────────────────────────────────────

const authCmd = program
  .command("auth")
  .description("Authenticate with an AI provider");

authCmd
  .command("openai-codex")
  .description("Authenticate with OpenAI via OAuth (Codex / ChatGPT Plus — no API key needed)")
  .option("--token-path <path>", "Where to store the OAuth token (default: data/openai-codex-credentials.json)")
  .action(async (opts: { tokenPath?: string }) => {
    // Dynamically import to keep startup fast for other commands
    const {
      generateOpenAiCodexPkce,
      createOpenAiCodexState,
      buildOpenAiCodexAuthorizeUrl,
      startOpenAiCodexCallbackServer,
      exchangeOpenAiCodexAuthorizationCode,
      writeOpenAiCodexTokenFile,
    } = await import("../shared/openai-codex-oauth");

    const tokenPath = opts.tokenPath || path.join(process.cwd(), "data", "openai-codex-credentials.json");

    console.log("\nOpenAI OAuth Login\n");
    console.log("This will authenticate you with OpenAI using your ChatGPT Plus / Codex subscription.");
    console.log("No API key is required.\n");

    const { verifier, challenge } = generateOpenAiCodexPkce();
    const state = createOpenAiCodexState();
    const authorizeUrl = buildOpenAiCodexAuthorizeUrl({ state, codeChallenge: challenge });

    // Start local callback server
    const callbackServer = await startOpenAiCodexCallbackServer(state);
    if (!callbackServer.isListening) {
      console.error("Error: Could not start local callback server on port 1455.");
      console.error("Make sure no other process is using that port and try again.");
      process.exit(1);
    }

    console.log("Opening your browser to authenticate with OpenAI...");
    console.log(`\n  ${authorizeUrl}\n`);

    // Try to open browser automatically (best-effort)
    try {
      const { exec } = await import("node:child_process");
      const opener =
        process.platform === "win32" ? "start" :
        process.platform === "darwin" ? "open" : "xdg-open";
      exec(`${opener} "${authorizeUrl}"`);
    } catch {
      console.log("Could not open browser automatically. Please open the URL above manually.");
    }

    console.log("Waiting for OAuth callback on http://localhost:1455/auth/callback...");
    console.log("(Press Ctrl+C to cancel)\n");

    let code: string | null = null;
    try {
      code = await callbackServer.waitForCode(120_000);
    } finally {
      await callbackServer.close();
    }

    if (!code) {
      console.error("Authentication timed out or was cancelled.");
      process.exit(1);
    }

    console.log("Authorization code received. Exchanging for tokens...");

    let tokenSet;
    try {
      tokenSet = await exchangeOpenAiCodexAuthorizationCode({ code, codeVerifier: verifier });
    } catch (err) {
      console.error(`Token exchange failed: ${(err as Error).message}`);
      process.exit(1);
    }

    writeOpenAiCodexTokenFile(tokenPath, tokenSet);

    console.log(`\nAuthentication successful!`);
    console.log(`Tokens stored in: ${tokenPath}`);
    console.log("\nTo use this OAuth token instead of an API key, add to your .env:");
    console.log(`  OPENAI_AUTH_MODE=oauth_codex`);
    console.log(`  OPENAI_OAUTH_TOKEN_PATH=${tokenPath}`);
    console.log("\nThen restart LLMask: llmask start\n");
  });

// ─── chat ─────────────────────────────────────────────────────────────────────

program
  .command("chat")
  .description("Interactive privacy-preserving chat — masks prompts before sending to Claude CLI")
  .option("--model <model>", "Claude model to use (passed to claude --model, e.g. claude-opus-4-5)")
  .option("--verbose", "Show masking details (what was replaced) before each send")
  .option("--no-mask", "Disable masking — pass prompts through unmodified")
  .action(async (opts: { model?: string; verbose?: boolean; mask: boolean }) => {
    // ── Check that `claude` CLI is available in PATH ───────────────────────
    const claudeCheck = spawnSync("claude", ["--version"], {
      encoding: "utf-8",
      stdio: "pipe",
      shell: process.platform === "win32",
    });
    if (claudeCheck.error || (claudeCheck.status !== 0 && claudeCheck.status !== null)) {
      console.error(
        "\nError: `claude` CLI not found in PATH.\n" +
          "Install it:       npm install -g @anthropic-ai/claude-code\n" +
          "Then sign in:     claude login\n"
      );
      process.exit(1);
    }

    // ── ANSI colour helpers ────────────────────────────────────────────────
    const C = {
      reset:   "\x1b[0m",
      bold:    "\x1b[1m",
      cyan:    "\x1b[36m",
      yellow:  "\x1b[33m",
      green:   "\x1b[32m",
      magenta: "\x1b[35m",
      gray:    "\x1b[90m",
    };

    // ── Lazy-load masking modules (keeps other commands fast to start) ─────
    type DetectionEngineType   = import("../modules/detection/detection-engine").DetectionEngine;
    type RewriteEngineType     = import("../modules/rewrite/rewrite-engine-v4").RewriteEngineV4;
    type RemapEngineType       = import("../modules/remap/response-remap-engine").ResponseRemapEngine;
    type InMemoryStoreType     = import("../modules/mapping-store/in-memory-mapping-store").InMemoryMappingStore;

    let detectionEngine: DetectionEngineType | null = null;
    let rewriteEngine:   RewriteEngineType   | null = null;
    let remapEngine:     RemapEngineType     | null = null;
    let mappingStore:    InMemoryStoreType   | null = null;

    // One stable scope ID for the whole session — pseudonyms stay consistent
    const scopeId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (opts.mask) {
      const { DetectionEngine }  = await import("../modules/detection/detection-engine");
      const { RewriteEngineV4 }  = await import("../modules/rewrite/rewrite-engine-v4");
      const { ResponseRemapEngine } = await import("../modules/remap/response-remap-engine");
      const { InMemoryMappingStore } = await import("../modules/mapping-store/in-memory-mapping-store");

      mappingStore    = new InMemoryMappingStore();
      mappingStore.initialize();
      detectionEngine = new DetectionEngine();
      rewriteEngine   = new RewriteEngineV4(mappingStore);
      remapEngine     = new ResponseRemapEngine(mappingStore);
    }

    // ── Welcome banner ─────────────────────────────────────────────────────
    console.log();
    console.log(
      `${C.bold}LLMask Chat${C.reset}` +
        (opts.mask
          ? " — prompts are masked before reaching Claude"
          : ` ${C.yellow}[masking disabled]${C.reset}`)
    );
    if (opts.verbose && opts.mask) {
      console.log(`${C.gray}Verbose: masking details shown per turn${C.reset}`);
    }
    if (opts.model) {
      console.log(`${C.gray}Model: ${opts.model}${C.reset}`);
    }
    console.log(`${C.gray}Press Ctrl+C to exit.${C.reset}`);
    console.log();

    // ── Readline interface ─────────────────────────────────────────────────
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    rl.on("SIGINT", () => {
      console.log("\nGoodbye!\n");
      rl.close();
      process.exit(0);
    });

    // ── Main chat loop ─────────────────────────────────────────────────────
    const loop = async (): Promise<void> => {
      let userInput: string;
      try {
        userInput = await ask(rl, `${C.bold}${C.cyan}You: ${C.reset}`);
      } catch {
        return; // readline was closed
      }

      const trimmed = userInput.trim();
      if (!trimmed) return loop();

      // ── Mask the prompt ────────────────────────────────────────────────
      let maskedPrompt = trimmed;
      if (opts.mask && detectionEngine && rewriteEngine && mappingStore) {
        const detection = detectionEngine.detect(trimmed);
        const result    = rewriteEngine.rewriteUnknownPayload(trimmed, detection, { scopeId });

        if (typeof result.rewrittenPayload === "string") {
          maskedPrompt = result.rewrittenPayload;
        }

        if (opts.verbose) {
          const newEntries = result.newEntries ?? [];
          if (newEntries.length > 0) {
            const pairs = newEntries
              .map((e) => `${e.originalValue} ${C.gray}→${C.reset} ${C.yellow}${e.pseudonym}${C.reset}`)
              .join(", ");
            console.log(`${C.magenta}[Masked: ${pairs}]${C.reset}`);
          } else if (result.transformedCount > 0) {
            // Existing mappings were reused — show all current scope mappings
            const all   = mappingStore.listMappings(scopeId);
            const pairs = all
              .map((e) => `${e.originalValue} ${C.gray}→${C.reset} ${C.yellow}${e.pseudonym}${C.reset}`)
              .join(", ");
            if (pairs) console.log(`${C.magenta}[Used mappings: ${pairs}]${C.reset}`);
          }
        }
      }

      // ── Spawn `claude --print <masked prompt>` ─────────────────────────
      process.stdout.write(`${C.bold}${C.green}Claude: ${C.reset}`);

      const claudeArgs = ["--print", maskedPrompt];
      if (opts.model) claudeArgs.push("--model", opts.model);

      const claudeProc = spawnSync("claude", claudeArgs, {
        encoding:  "utf-8",
        maxBuffer: 10 * 1024 * 1024, // 10 MB
        shell:     process.platform === "win32",
      });

      if (claudeProc.error) {
        console.error(
          `\n${C.yellow}Failed to run claude:${C.reset} ${(claudeProc.error as Error).message}`
        );
        return loop();
      }
      if (claudeProc.status !== 0) {
        const errMsg = ((claudeProc.stderr as string) ?? "").trim() || `exit code ${claudeProc.status}`;
        console.error(`\n${C.yellow}Claude error:${C.reset} ${errMsg}`);
        return loop();
      }

      const rawResponse = ((claudeProc.stdout as string) ?? "").trim();

      // ── Reverse-map pseudonyms back to original values ─────────────────
      let finalResponse = rawResponse;
      if (opts.mask && remapEngine) {
        const remapped = remapEngine.remapJsonResponse(rawResponse, scopeId);
        if (typeof remapped === "string") finalResponse = remapped;
      }

      console.log(finalResponse);
      console.log();

      return loop();
    };

    try {
      await loop();
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "ERR_USE_AFTER_CLOSE") {
        console.error("Chat error:", e.message);
        process.exit(1);
      }
    } finally {
      rl.close();
    }
  });

program.parse();
