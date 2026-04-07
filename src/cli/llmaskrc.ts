import fs from "node:fs";
import path from "node:path";

export type MaskingStrategy = "aggressive" | "values-only" | "pii-only" | "code-aware";

export type MaskingRule = {
  /** Regex pattern string to match against text */
  pattern: string;
  /** MappingKind to apply: org | svc | tbl | col | idn | per | url | email | phone */
  kind: string;
};

export type LlmaskProjectConfig = {
  /** Masking strategy override for this project */
  strategy?: MaskingStrategy;
  /** Port override */
  port?: number;
  /** Primary LLM provider */
  provider?: string;
  /**
   * Regex patterns to exclude from masking (strings that match will not be
   * replaced). Useful for project-internal identifiers that look like PII.
   */
  ignorePatterns?: string[];
  /** Additional custom masking rules applied on top of the selected strategy */
  maskingRules?: MaskingRule[];
};

const CONFIG_FILENAMES = ["llmask.config.json", ".llmaskrc", ".llmaskrc.json"];

/**
 * Walk upward from `startDir` looking for a config file.
 * Returns the absolute path of the first match, or null if none found.
 */
export function findConfigPath(startDir: string = process.cwd()): string | null {
  let dir = path.resolve(startDir);
  while (true) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = path.join(dir, filename);
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return null;
}

/**
 * Load and parse the project config file, walking up from `startDir`.
 * Returns an empty object if no config file is found or if parsing fails.
 */
export function loadProjectConfig(startDir?: string): LlmaskProjectConfig {
  const configPath = findConfigPath(startDir);
  if (!configPath) return {};
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as LlmaskProjectConfig;
  } catch {
    return {};
  }
}

/**
 * Write a `llmask.config.json` file to `dirPath`.
 */
export function writeProjectConfig(dirPath: string, config: LlmaskProjectConfig): void {
  const configPath = path.join(dirPath, "llmask.config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
