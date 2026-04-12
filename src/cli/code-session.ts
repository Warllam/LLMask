import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CodeSessionOpts {
  model?: string;
  verbose?: boolean;
  strategy?: string;
  mask?: boolean;
  dashboardPort?: number;
}

interface Turn {
  role: "user" | "assistant";
  content: string;
}

// ── ANSI colours ───────────────────────────────────────────────────────────────

const C = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  cyan:    "\x1b[36m",
  yellow:  "\x1b[33m",
  green:   "\x1b[32m",
  magenta: "\x1b[35m",
  gray:    "\x1b[90m",
  blue:    "\x1b[34m",
  red:     "\x1b[31m",
};

// ── Resolve claude invocation (same logic as chat command) ─────────────────────

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

// ── Project scanning ───────────────────────────────────────────────────────────

interface ProjectInfo {
  name: string;
  dir: string;
  type: string;
  description: string;
  keyFiles: string[];
}

function scanProject(dir: string): ProjectInfo {
  const name = path.basename(dir);

  const exists = (f: string) => fs.existsSync(path.join(dir, f));
  const read = (f: string): string => {
    try { return fs.readFileSync(path.join(dir, f), "utf-8").slice(0, 1000); }
    catch { return ""; }
  };

  let type = "project";
  const keyFiles: string[] = [];

  if (exists("package.json")) {
    type = "Node.js";
    keyFiles.push("package.json");
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8"));
      if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript) type = "Node.js/TypeScript";
      if (pkg.name && pkg.name !== name) type = `${type} (${pkg.name})`;
    } catch { /* ignore */ }
  }
  if (exists("tsconfig.json")) {
    keyFiles.push("tsconfig.json");
    if (!type.includes("TypeScript")) type += "/TypeScript";
  }
  if (exists("pyproject.toml") || exists("setup.py")) {
    type = "Python";
    keyFiles.push(exists("pyproject.toml") ? "pyproject.toml" : "setup.py");
  }
  if (exists("Cargo.toml")) { type = "Rust"; keyFiles.push("Cargo.toml"); }
  if (exists("go.mod")) { type = "Go"; keyFiles.push("go.mod"); }
  if (exists("pom.xml")) { type = "Java/Maven"; keyFiles.push("pom.xml"); }
  if (exists("build.gradle") || exists("build.gradle.kts")) {
    type = "Java/Gradle";
    keyFiles.push(exists("build.gradle") ? "build.gradle" : "build.gradle.kts");
  }
  if (exists(".gitignore")) keyFiles.push(".gitignore");

  // Extract description from README
  let description = "";
  for (const r of ["README.md", "README.txt", "README", "readme.md"]) {
    if (exists(r)) {
      const content = read(r);
      const firstMeaningfulLine = content
        .split("\n")
        .find(l => l.trim() && !l.startsWith("#") && !l.startsWith("!") && l.trim().length > 10);
      if (firstMeaningfulLine) {
        description = firstMeaningfulLine.trim().slice(0, 150);
        break;
      }
    }
  }

  // Note key directories
  for (const d of ["src", "lib", "app", "pkg", "cmd", "internal", "tests", "test", "spec"]) {
    try {
      if (fs.statSync(path.join(dir, d)).isDirectory()) keyFiles.push(`${d}/`);
    } catch { /* ignore */ }
  }

  return { name, dir, type, description, keyFiles };
}

// ── File reference detection ───────────────────────────────────────────────────

const FILE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".rs", ".go", ".java", ".c", ".cpp", ".h", ".hpp",
  ".json", ".yaml", ".yml", ".toml", ".ini",
  ".md", ".txt", ".sh", ".bash", ".zsh",
  ".css", ".scss", ".less", ".html", ".svg",
  ".sql", ".prisma", ".graphql",
  ".env", ".lock",
]);

const COMMON_FILENAMES = new Set([
  "package.json", "package-lock.json", "yarn.lock",
  "tsconfig.json", ".gitignore", ".env", ".env.example",
  "README.md", "Cargo.toml", "go.mod", "pyproject.toml",
  "requirements.txt", "Makefile", "Dockerfile", "docker-compose.yml",
  ".eslintrc.json", ".prettierrc", ".prettierrc.json",
  "vite.config.ts", "vite.config.js", "webpack.config.js",
  "jest.config.ts", "jest.config.js", "vitest.config.ts",
]);

function detectFileReferences(text: string): string[] {
  const found = new Set<string>();

  // Quoted paths: "src/index.ts" or 'package.json' or `lib/utils.ts`
  const quotedRegex = /["'`]([\w.\-/\\@]+\.[\w]{1,8})["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = quotedRegex.exec(text)) !== null) {
    const p = m[1].replace(/\\/g, "/");
    const ext = path.extname(p);
    if (ext && FILE_EXTENSIONS.has(ext)) found.add(p);
  }

  // Common filenames mentioned without quotes
  const textLower = text.toLowerCase();
  for (const name of COMMON_FILENAMES) {
    if (textLower.includes(name.toLowerCase())) found.add(name);
  }

  // Paths with slashes and extension: word/word/file.ext
  const pathRegex = /\b((?:[\w.\-@]+\/)+[\w.\-@]+\.[\w]{1,8})\b/g;
  while ((m = pathRegex.exec(text)) !== null) {
    const p = m[1];
    const ext = path.extname(p);
    if (ext && FILE_EXTENSIONS.has(ext)) found.add(p);
  }

  return Array.from(found);
}

// ── File reading ───────────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 50_000;

function readFileSafe(filePath: string, projectDir: string): string | null {
  const abs = path.isAbsolute(filePath)
    ? filePath
    : path.join(projectDir, filePath);
  try {
    const stat = fs.statSync(abs);
    if (!stat.isFile()) return null;
    const raw = fs.readFileSync(abs, "utf-8");
    if (raw.length > MAX_FILE_BYTES) {
      return `[Truncated: showing first ${MAX_FILE_BYTES} chars of ${Math.round(stat.size / 1024)} KB file]\n` +
        raw.slice(0, MAX_FILE_BYTES);
    }
    return raw;
  } catch {
    return null;
  }
}

// ── Directory tree listing ─────────────────────────────────────────────────────

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "__pycache__", ".venv", "venv", "target"]);

function buildTree(dir: string, indent = "", depth = 0): string {
  if (depth > 3) return "";
  const lines: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return "";
  }
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const e of entries) {
    if (e.name.startsWith(".") && !["env", ".gitignore", ".env"].includes(e.name.replace(".", ""))) continue;
    if (SKIP_DIRS.has(e.name)) continue;
    if (e.isDirectory()) {
      lines.push(`${indent}${e.name}/`);
      const sub = buildTree(path.join(dir, e.name), indent + "  ", depth + 1);
      if (sub) lines.push(sub);
    } else {
      lines.push(`${indent}${e.name}`);
    }
  }
  return lines.join("\n");
}

// ── Spinner ────────────────────────────────────────────────────────────────────

function startSpinner(message: string): () => void {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const id = setInterval(() => {
    process.stdout.write(`\r${C.gray}${frames[i++ % frames.length]} ${message}${C.reset}`);
  }, 80);
  return () => {
    clearInterval(id);
    process.stdout.write(`\r${" ".repeat(message.length + 4)}\r`);
  };
}

// ── Run claude async (enables spinner) ────────────────────────────────────────

async function invokeClaudeAsync(
  claudeBin: string,
  scriptPrefix: string[],
  prompt: string,
  modelOpt: string | undefined,
  subEnv: NodeJS.ProcessEnv
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [...scriptPrefix, "--print", prompt];
    if (modelOpt) args.push("--model", modelOpt);

    let stdout = "";
    let stderr = "";

    const proc = spawn(claudeBin, args, {
      env: subEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    proc.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error((stderr.trim() || stdout.trim() || `exit code ${code}`)));
      } else {
        resolve(stdout.trim());
      }
    });

    proc.on("error", reject);
  });
}

// ── Dashboard reporting (fire-and-forget) ─────────────────────────────────────

interface SessionReport {
  sessionId: string;
  timestamp: string;
  prompt: string;
  response: string;
  filesScanned: string[];
  elementsMasked: number;
  strategy: string;
  model: string;
  projectName: string;
  projectDir: string;
}

function reportToDashboard(port: number, report: SessionReport): void {
  try {
    const body = JSON.stringify(report);
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: "/dashboard/api/code-sessions/report",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    });
    req.on("error", () => { /* silently skip if server not running */ });
    req.write(body);
    req.end();
  } catch {
    // Silently skip
  }
}

// ── Build full prompt for Claude ───────────────────────────────────────────────

function buildClaudePrompt(
  userMessage: string,
  history: Turn[],
  fileContents: Map<string, string>,
  projectInfo: ProjectInfo
): string {
  const parts: string[] = [];

  parts.push(
    `You are a coding assistant working on the "${projectInfo.name}" project (${projectInfo.type}).`,
    `Project directory: ${projectInfo.dir}`,
  );
  if (projectInfo.description) parts.push(`Description: ${projectInfo.description}`);
  if (projectInfo.keyFiles.length > 0) {
    parts.push(`Key project files: ${projectInfo.keyFiles.join(", ")}`);
  }
  parts.push("");

  if (fileContents.size > 0) {
    parts.push("=== Referenced Files ===");
    for (const [filePath, content] of fileContents) {
      const ext = path.extname(filePath).slice(1) || "text";
      parts.push(`\n[${filePath}]\n\`\`\`${ext}\n${content}\n\`\`\``);
    }
    parts.push("=== End Files ===\n");
  }

  // Include last 6 turns to keep context window manageable
  const recentHistory = history.slice(-6);
  if (recentHistory.length > 0) {
    parts.push("=== Conversation History ===");
    for (const turn of recentHistory) {
      parts.push(`${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`);
    }
    parts.push("=== End History ===\n");
  }

  parts.push(`User: ${userMessage}`);
  return parts.join("\n");
}

// ── Main exported function ─────────────────────────────────────────────────────

export async function runCodeSession(
  targetDir: string,
  opts: CodeSessionOpts
): Promise<void> {
  const dir = path.resolve(targetDir);

  if (!fs.existsSync(dir)) {
    console.error(`\n${C.red}Directory not found:${C.reset} ${dir}\n`);
    process.exit(1);
  }
  if (!fs.statSync(dir).isDirectory()) {
    console.error(`\n${C.red}Not a directory:${C.reset} ${dir}\n`);
    process.exit(1);
  }

  // Verify claude CLI
  const { bin: claudeBin, scriptPrefix } = resolveClaudeInvocation();
  const claudeCheck = spawnSync(claudeBin, [...scriptPrefix, "--version"], {
    encoding: "utf-8",
    stdio: "pipe",
  });
  if (claudeCheck.error || (claudeCheck.status !== 0 && claudeCheck.status !== null)) {
    console.error(
      `\n${C.red}Error:${C.reset} \`claude\` CLI not found.\n` +
        "Install:   npm install -g @anthropic-ai/claude-code\n" +
        "Sign in:   claude login\n"
    );
    process.exit(1);
  }

  // Scan project for context
  const projectInfo = scanProject(dir);

  // Lazy-load masking modules
  type DetectionEngineT = import("../modules/detection/detection-engine").DetectionEngine;
  type RewriteEngineT   = import("../modules/rewrite/rewrite-engine-v4").RewriteEngineV4;
  type RemapEngineT     = import("../modules/remap/response-remap-engine").ResponseRemapEngine;
  type InMemoryStoreT   = import("../modules/mapping-store/in-memory-mapping-store").InMemoryMappingStore;

  let detectionEngine: DetectionEngineT | null = null;
  let rewriteEngine:   RewriteEngineT   | null = null;
  let remapEngine:     RemapEngineT     | null = null;
  let mappingStore:    InMemoryStoreT   | null = null;

  const maskEnabled = opts.mask !== false;
  const strategy    = opts.strategy ?? "code-aware";
  const modelArg    = opts.model;
  const scopeId     = `code-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sessionId   = randomUUID();
  const dashPort    = opts.dashboardPort ?? 3456;

  if (maskEnabled) {
    const { DetectionEngine }    = await import("../modules/detection/detection-engine");
    const { RewriteEngineV4 }    = await import("../modules/rewrite/rewrite-engine-v4");
    const { ResponseRemapEngine } = await import("../modules/remap/response-remap-engine");
    const { InMemoryMappingStore } = await import("../modules/mapping-store/in-memory-mapping-store");

    mappingStore    = new InMemoryMappingStore();
    mappingStore.initialize();
    detectionEngine = new DetectionEngine();
    rewriteEngine   = new RewriteEngineV4(mappingStore);
    remapEngine     = new ResponseRemapEngine(mappingStore);
  }

  // Strip Claude Desktop host env vars so the subprocess can make direct API calls
  const subEnv: NodeJS.ProcessEnv = { ...process.env };
  delete subEnv["CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST"];
  delete subEnv["CLAUDE_CODE_ENTRYPOINT"];
  delete subEnv["CLAUDECODE"];

  // Session state
  const history: Turn[] = [];

  // ── Welcome banner ─────────────────────────────────────────────────────────

  console.log();
  console.log(
    `${C.bold}LLMask Code${C.reset} ${C.gray}[${projectInfo.name}]${C.reset}` +
      (maskEnabled
        ? ` — ${C.cyan}${strategy}${C.reset} masking`
        : ` ${C.yellow}[masking disabled]${C.reset}`)
  );
  console.log(`${C.gray}Type: ${projectInfo.type}  |  ${dir}${C.reset}`);
  if (projectInfo.description) {
    console.log(`${C.gray}${projectInfo.description}${C.reset}`);
  }
  console.log(
    `${C.gray}Commands: /ls  /tree  /read <file>  /clear  /exit  |  Ctrl+C to quit${C.reset}`
  );
  console.log();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  rl.on("SIGINT", () => {
    console.log("\nGoodbye!\n");
    rl.close();
    process.exit(0);
  });

  const askLine = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve));

  // ── Main REPL loop ─────────────────────────────────────────────────────────

  const loop = async (): Promise<void> => {
    let rawInput: string;
    try {
      rawInput = await askLine(
        `${C.bold}${C.cyan}LLMask [${projectInfo.name}] >${C.reset} `
      );
    } catch {
      return; // readline closed
    }

    const trimmed = rawInput.trim();
    if (!trimmed) return loop();

    // ── Built-in REPL commands ─────────────────────────────────────────────

    if (trimmed === "/exit" || trimmed === "/quit") {
      console.log("\nGoodbye!\n");
      rl.close();
      return;
    }

    if (trimmed === "/clear") {
      history.length = 0;
      console.log(`${C.gray}Conversation context cleared.${C.reset}\n`);
      return loop();
    }

    if (trimmed === "/ls") {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
          .filter(e => !SKIP_DIRS.has(e.name))
          .sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
        console.log();
        for (const e of entries) {
          const colour = e.isDirectory() ? C.blue : C.reset;
          console.log(`  ${colour}${e.name}${e.isDirectory() ? "/" : ""}${C.reset}`);
        }
        console.log();
      } catch (err) {
        console.log(`${C.red}Error:${C.reset} ${(err as Error).message}\n`);
      }
      return loop();
    }

    if (trimmed === "/tree") {
      console.log(`\n${C.bold}${projectInfo.name}/${C.reset}`);
      console.log(buildTree(dir));
      console.log();
      return loop();
    }

    if (trimmed.startsWith("/read ")) {
      const filePath = trimmed.slice(6).trim();
      const content = readFileSafe(filePath, dir);
      if (content === null) {
        console.log(`${C.yellow}File not found:${C.reset} ${filePath}\n`);
      } else {
        let display = content;
        if (maskEnabled && rewriteEngine && detectionEngine) {
          const det = detectionEngine.detect(content);
          const res = rewriteEngine.rewriteUnknownPayload(content, det, { scopeId });
          if (typeof res.rewrittenPayload === "string") display = res.rewrittenPayload;
        }
        console.log(`\n${C.bold}[${filePath}]${C.reset}\n${display}\n`);
      }
      return loop();
    }

    // ── Prompt handling ────────────────────────────────────────────────────

    // 1) Detect file references and read them
    const refs = detectFileReferences(trimmed);
    const rawFileContents = new Map<string, string>();
    const filesScanned: string[] = [];

    for (const ref of refs) {
      const content = readFileSafe(ref, dir);
      if (content !== null) {
        rawFileContents.set(ref, content);
        filesScanned.push(ref);
      }
    }

    // 2) Mask prompt + file contents
    let maskedPrompt = trimmed;
    const maskedFileContents = new Map<string, string>();
    let totalMasked = 0;

    if (maskEnabled && detectionEngine && rewriteEngine) {
      const det = detectionEngine.detect(trimmed);
      const res = rewriteEngine.rewriteUnknownPayload(trimmed, det, { scopeId });
      if (typeof res.rewrittenPayload === "string") maskedPrompt = res.rewrittenPayload;
      totalMasked += res.transformedCount;

      if (opts.verbose && (res.newEntries ?? []).length > 0) {
        const pairs = (res.newEntries ?? [])
          .map(e => `${e.originalValue} ${C.gray}→${C.reset} ${C.yellow}${e.pseudonym}${C.reset}`)
          .join(", ");
        console.log(`${C.magenta}[Masked: ${pairs}]${C.reset}`);
      }

      for (const [filePath, content] of rawFileContents) {
        const fd = detectionEngine.detect(content);
        const fr = rewriteEngine.rewriteUnknownPayload(content, fd, { scopeId });
        maskedFileContents.set(
          filePath,
          typeof fr.rewrittenPayload === "string" ? fr.rewrittenPayload : content
        );
        totalMasked += fr.transformedCount;
      }
    } else {
      for (const [k, v] of rawFileContents) maskedFileContents.set(k, v);
    }

    // 3) Build prompt and call Claude
    const fullPrompt = buildClaudePrompt(maskedPrompt, history, maskedFileContents, projectInfo);

    const stopSpinner = startSpinner("Thinking…");
    let rawResponse = "";
    let claudeError: string | null = null;

    try {
      rawResponse = await invokeClaudeAsync(claudeBin, scriptPrefix, fullPrompt, modelArg, subEnv);
    } catch (err) {
      claudeError = (err as Error).message;
    } finally {
      stopSpinner();
    }

    if (claudeError) {
      console.error(`\n${C.yellow}Claude error:${C.reset} ${claudeError}\n`);
      return loop();
    }

    // 4) Reverse-map pseudonyms back to originals
    let finalResponse = rawResponse;
    if (maskEnabled && remapEngine) {
      const remapped = remapEngine.remapJsonResponse(rawResponse, scopeId);
      if (typeof remapped === "string") finalResponse = remapped;
    }

    // 5) Print response line-by-line
    console.log(`\n${C.bold}${C.green}Claude:${C.reset}`);
    for (const line of finalResponse.split("\n")) {
      console.log(line);
    }
    console.log();

    // 6) Masking stats line
    const statParts: string[] = [];
    if (maskEnabled) statParts.push(`🛡️  ${totalMasked} element${totalMasked !== 1 ? "s" : ""} masked`);
    if (filesScanned.length > 0) statParts.push(`📁 ${filesScanned.length} file${filesScanned.length !== 1 ? "s" : ""} scanned`);
    if (statParts.length > 0) {
      console.log(`${C.gray}[${statParts.join(" | ")}]${C.reset}\n`);
    }

    // 7) Update conversation history
    history.push({ role: "user", content: trimmed });
    history.push({ role: "assistant", content: finalResponse });

    // 8) Report to dashboard (non-blocking)
    reportToDashboard(dashPort, {
      sessionId,
      timestamp: new Date().toISOString(),
      prompt: maskedPrompt,
      response: finalResponse,
      filesScanned,
      elementsMasked: totalMasked,
      strategy,
      model: modelArg ?? "claude-sonnet-4-6",
      projectName: projectInfo.name,
      projectDir: dir,
    });

    return loop();
  };

  try {
    await loop();
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ERR_USE_AFTER_CLOSE") {
      console.error("Session error:", e.message);
      process.exit(1);
    }
  } finally {
    rl.close();
  }
}
