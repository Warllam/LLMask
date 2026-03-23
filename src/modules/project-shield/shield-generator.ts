import fs from "node:fs";
import path from "node:path";

export type OllamaConfig = {
  baseUrl: string;
  model: string;
  timeoutMs: number;
};

type ShieldConfig = {
  replacements: Record<string, string>;
};

// Words too generic to be project-identifying
const STOP_WORDS = new Set([
  "app", "api", "web", "server", "client", "service", "core", "lib", "utils",
  "test", "tests", "dev", "prod", "staging", "demo", "example", "sample",
  "main", "index", "src", "dist", "build", "config", "data", "public",
  "the", "a", "an", "of", "for", "in", "on", "at", "to", "by", "with",
  "and", "or", "not", "is", "are", "was", "be", "has", "have", "do",
  "new", "old", "get", "set", "add", "del", "update", "create", "delete",
  "de", "du", "des", "le", "la", "les", "un", "une", "et", "ou", "en",
  "par", "pour", "dans", "sur", "avec", "sans", "est", "sont", "fait",
  "poc", "mvp", "v1", "v2", "v3", "beta", "alpha",
]);

const SHIELD_PROMPT = `You are a security analyst. Analyze the following project metadata and identify ALL strings that could reveal the project identity, product name, client name, or organization name.

For each identifying string found, suggest a neutral, generic replacement. Include ALL case and format variants you can find (camelCase, kebab-case, snake_case, UPPER_CASE, PascalCase).

Return ONLY valid JSON in this exact format:
{"replacements": {"original_string": "replacement_string", ...}}

Rules:
- Focus on project/product/client names, NOT on generic technical terms
- Include the package name if it reveals the product
- Include directory/repo names if they reveal the project
- Generate ALL case variants for each identified name
- Replacements should be neutral (e.g. "AppX", "project_alpha", "acme-app")
- Do NOT include generic words like "stock", "location", "product" — only project-identifying strings

Project metadata:
`;

/**
 * Collect project metadata for LLM analysis.
 */
export function collectProjectMetadata(projectDir: string): string {
  const parts: string[] = [];

  // package.json
  const pkgPath = path.join(projectDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      parts.push("## package.json");
      parts.push(`name: ${pkg.name ?? "N/A"}`);
      parts.push(`description: ${pkg.description ?? "N/A"}`);
      if (pkg.repository) parts.push(`repository: ${JSON.stringify(pkg.repository)}`);
      if (pkg.author) parts.push(`author: ${JSON.stringify(pkg.author)}`);
    } catch { /* ignore parse errors */ }
  }

  // .env.example or .env.local (never .env itself — may contain secrets)
  for (const envFile of [".env.example", ".env.local.example", ".env.sample"]) {
    const envPath = path.join(projectDir, envFile);
    if (fs.existsSync(envPath)) {
      parts.push(`\n## ${envFile}`);
      const lines = fs.readFileSync(envPath, "utf-8").split("\n").slice(0, 30);
      // Only include variable names, not values
      for (const line of lines) {
        const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
        if (match) parts.push(match[1]);
      }
    }
  }

  // README first 20 lines
  for (const readme of ["README.md", "readme.md", "README"]) {
    const readmePath = path.join(projectDir, readme);
    if (fs.existsSync(readmePath)) {
      parts.push("\n## README (first 20 lines)");
      const lines = fs.readFileSync(readmePath, "utf-8").split("\n").slice(0, 20);
      parts.push(lines.join("\n"));
      break;
    }
  }

  // Directory name
  parts.push(`\n## Project directory: ${path.basename(projectDir)}`);

  // Top-level directory listing
  try {
    const entries = fs.readdirSync(projectDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
      .map((e) => e.name)
      .slice(0, 30);
    if (dirs.length > 0) {
      parts.push("\n## Top-level directories");
      parts.push(dirs.join(", "));
    }
  } catch { /* ignore */ }

  return parts.join("\n");
}

/**
 * Call Ollama to generate shield replacements from project metadata.
 */
export async function generateShieldConfig(
  projectDir: string,
  ollamaConfig: OllamaConfig
): Promise<ShieldConfig> {
  const metadata = collectProjectMetadata(projectDir);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ollamaConfig.timeoutMs);

  try {
    const response = await fetch(`${ollamaConfig.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaConfig.model,
        prompt: SHIELD_PROMPT + metadata,
        stream: false,
        options: { temperature: 0, num_predict: 2048 },
        format: "json"
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}: ${await response.text()}`);
    }

    const result = (await response.json()) as { response: string };
    const parsed = JSON.parse(result.response);

    if (!parsed.replacements || typeof parsed.replacements !== "object") {
      throw new Error("LLM response missing 'replacements' field");
    }

    // Validate: all keys and values must be non-empty strings
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.replacements)) {
      if (typeof v === "string" && k.length > 0 && v.length > 0) {
        clean[k] = v;
      }
    }

    return { replacements: clean };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Heuristic shield generation (no LLM required)
// ---------------------------------------------------------------------------

const CODENAMES = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];

/**
 * Split any identifier into lowercase words regardless of convention.
 * "iRun" → ["i","run"], "mouvements-de-stock" → ["mouvements","de","stock"]
 */
function splitWords(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase()
    .split(/[-_]+/)
    .filter(Boolean);
}

function toKebab(words: string[]): string { return words.join("-"); }
function toSnake(words: string[]): string { return words.join("_"); }
function toUpperSnake(words: string[]): string { return words.map(w => w.toUpperCase()).join("_"); }
function toCamel(words: string[]): string {
  return words[0] + words.slice(1).map(w => w[0].toUpperCase() + w.slice(1)).join("");
}
function toPascal(words: string[]): string {
  return words.map(w => w[0].toUpperCase() + w.slice(1)).join("");
}

/**
 * Generate all case variants of `name` mapped to corresponding variants of `codename`.
 */
function generateAllVariants(name: string, codename: string): Array<[string, string]> {
  const nw = splitWords(name);
  const cw = splitWords(codename);
  if (nw.length === 0 || cw.length === 0) return [];

  const variants: Array<[string, string]> = [];
  const seen = new Set<string>();
  const add = (orig: string, repl: string) => {
    if (orig.length >= 3 && !seen.has(orig)) { seen.add(orig); variants.push([orig, repl]); }
  };

  // Always include the original form as-is
  add(name, codename);

  // Standard case variants
  add(toKebab(nw), toKebab(cw));
  add(toSnake(nw), toSnake(cw));
  add(toUpperSnake(nw), toUpperSnake(cw));
  add(toCamel(nw), toCamel(cw));
  add(toPascal(nw), toPascal(cw));

  return variants;
}

/**
 * Generate a shield config heuristically from the project directory.
 * No LLM required — analyzes package.json, directory name, author, repository.
 */
export function generateHeuristicShield(projectDir: string): ShieldConfig {
  const replacements: Record<string, string> = {};
  const candidates: Array<{ raw: string; codename: string }> = [];
  let codeIdx = 0;
  const nextCode = () => CODENAMES[codeIdx++ % CODENAMES.length];

  let pkgName: string | null = null;

  // 1. package.json — most reliable signal
  const pkgPath = path.join(projectDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (typeof pkg.name === "string" && pkg.name.length > 2) {
        let name = pkg.name;
        // Scoped package: @org/name
        if (name.startsWith("@") && name.includes("/")) {
          const [scope, rest] = name.split("/");
          candidates.push({ raw: scope.slice(1), codename: `org-${nextCode()}` });
          name = rest;
        }
        pkgName = name;
        candidates.push({ raw: name, codename: `project-${nextCode()}` });

        // Try to detect brand-like segments (non-stop-word, >= 3 chars)
        const segments = name.split(/[-_]+/).filter(
          (s: string) => s.length >= 3 && !STOP_WORDS.has(s.toLowerCase())
        );
        // Only add individual segments if there are few of them (likely brand names)
        // and they're different from the full package name
        if (segments.length <= 3) {
          for (const seg of segments) {
            if (seg.toLowerCase() !== pkgName?.toLowerCase()) {
              candidates.push({ raw: seg, codename: `x${nextCode()}` });
            }
          }
        }
      }

      // Author
      const author = typeof pkg.author === "string" ? pkg.author : pkg.author?.name;
      if (typeof author === "string" && author.length > 2) {
        candidates.push({ raw: author, codename: `team-${nextCode()}` });
      }

      // Repository owner
      const repoUrl = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
      if (typeof repoUrl === "string") {
        const match = repoUrl.match(/github\.com[/:]([^/]+)/);
        if (match && match[1].length > 2) {
          candidates.push({ raw: match[1], codename: `org-${nextCode()}` });
        }
      }
    } catch { /* ignore */ }
  }

  // 2. License field — detect non-standard license names (PolyForm, ELv2, etc.)
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (typeof pkg.license === "string") {
        const STANDARD_LICENSES = new Set([
          "mit", "apache-2.0", "bsd-2-clause", "bsd-3-clause", "isc", "gpl-2.0",
          "gpl-3.0", "lgpl-2.1", "lgpl-3.0", "mpl-2.0", "unlicense", "cc0-1.0",
          "artistic-2.0", "0bsd", "wtfpl", "zlib", "bsl-1.0", "noncommercial",
        ]);
        // Extract distinct segments from license string (e.g. "PolyForm-Noncommercial-1.0.0")
        const segments = pkg.license.split(/[-_.\s]+/).filter(
          (s: string) => s.length >= 4 && !/^\d/.test(s) && !STANDARD_LICENSES.has(s.toLowerCase())
        );
        for (const seg of segments) {
          candidates.push({ raw: seg, codename: `license-${nextCode()}` });
        }
      }
    } catch { /* ignore */ }
  }

  // 3. Directory name (if different from package name)
  const dirName = path.basename(path.resolve(projectDir));
  if (dirName.length > 2 && dirName !== pkgName) {
    candidates.push({ raw: dirName, codename: `project-${nextCode()}` });
  }

  // 4. Generate all case variants, deduplicating by lowercase
  const seen = new Set<string>();
  for (const { raw, codename } of candidates) {
    if (seen.has(raw.toLowerCase())) continue;
    seen.add(raw.toLowerCase());

    const variants = generateAllVariants(raw, codename);
    for (const [orig, repl] of variants) {
      if (!replacements[orig]) {
        replacements[orig] = repl;
      }
    }
  }

  // 5. Scan root-level filenames for identity terms not yet in shield
  //    This catches files like "llmask-license.key" where "llmask" should be shielded.
  try {
    const entries = fs.readdirSync(projectDir);
    const shieldedLower = new Set(Object.keys(replacements).map(k => k.toLowerCase()));
    for (const entry of entries) {
      const lower = entry.toLowerCase();
      for (const candidate of candidates) {
        const candidateLower = candidate.raw.toLowerCase();
        if (candidateLower.length >= 3 && lower.includes(candidateLower) && !shieldedLower.has(lower)) {
          // The filename contains an identity term — add the bare candidate if not already present
          if (!replacements[candidate.raw] && !replacements[candidateLower]) {
            const codename = candidates.find(c => c.raw.toLowerCase() === candidateLower)?.codename ?? `file-${nextCode()}`;
            for (const [orig, repl] of generateAllVariants(candidate.raw, codename)) {
              if (!replacements[orig]) replacements[orig] = repl;
            }
          }
        }
      }
    }
  } catch { /* ignore */ }

  return { replacements };
}

/**
 * Auto-generate a shield config file if it doesn't exist.
 * Tries Ollama first (if available), falls back to heuristic extraction.
 * Returns the path to the generated file, or null if nothing to generate.
 */
export async function autoGenerateShield(
  projectDir: string,
  outputPath: string,
  ollamaConfig?: { baseUrl: string; model: string; timeoutMs: number; enabled: boolean }
): Promise<{ path: string; method: "llm" | "heuristic"; ruleCount: number } | null> {
  // Try Ollama first if enabled
  if (ollamaConfig?.enabled) {
    try {
      const probe = await fetch(`${ollamaConfig.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(2000)
      });
      if (probe.ok) {
        const config = await generateShieldConfig(projectDir, ollamaConfig);
        if (Object.keys(config.replacements).length > 0) {
          fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
          fs.writeFileSync(outputPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
          return { path: outputPath, method: "llm", ruleCount: Object.keys(config.replacements).length };
        }
      }
    } catch { /* Ollama not reachable — fall through to heuristic */ }
  }

  // Fallback: heuristic extraction
  const config = generateHeuristicShield(projectDir);
  if (Object.keys(config.replacements).length === 0) return null;

  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return { path: outputPath, method: "heuristic", ruleCount: Object.keys(config.replacements).length };
}
