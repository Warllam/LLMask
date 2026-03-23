import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { log } from "./logger";

export type ClaudeOAuthTokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

type ClaudeCredentialsFile = {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: string | number;
  };
};

const CLAUDE_CLI_KEYCHAIN_SERVICE = "Claude Code-credentials";

/**
 * Returns the default path where Claude Code stores its OAuth credentials.
 */
export function findClaudeCredentialsPath(): string {
  return join(homedir(), ".claude", ".credentials.json");
}

/**
 * Reads and parses Claude Code credentials from the given file path.
 * Returns null if the file doesn't exist or has no valid token.
 */
export function readClaudeCredentials(filePath: string): ClaudeOAuthTokenSet | null {
  if (!existsSync(filePath)) return null;

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  let parsed: ClaudeCredentialsFile;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const oauth = parsed?.claudeAiOauth;
  if (!oauth) return null;

  const accessToken = typeof oauth.accessToken === "string" ? oauth.accessToken.trim() : "";
  const refreshToken = typeof oauth.refreshToken === "string" ? oauth.refreshToken.trim() : "";

  if (!accessToken) return null;

  let expiresAt: number;
  if (typeof oauth.expiresAt === "number") {
    expiresAt = oauth.expiresAt;
  } else if (typeof oauth.expiresAt === "string") {
    const parsed = Date.parse(oauth.expiresAt);
    expiresAt = Number.isFinite(parsed) ? parsed : 0;
  } else {
    // No expiry info — assume valid for now
    expiresAt = Date.now() + 3_600_000;
  }

  return { accessToken, refreshToken, expiresAt };
}

/**
 * Reads Claude Code credentials from macOS keychain.
 * Returns null if not on macOS or if keychain entry doesn't exist.
 */
export function readClaudeKeychainCredentials(): ClaudeOAuthTokenSet | null {
  if (process.platform !== "darwin") {
    return null;
  }

  try {
    const result = execFileSync(
      "security",
      ["find-generic-password", "-s", CLAUDE_CLI_KEYCHAIN_SERVICE, "-w"],
      { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }
    );

    const trimmed = result.trim();
    if (!trimmed) return null;

    const data = JSON.parse(trimmed) as ClaudeCredentialsFile;
    const oauth = data?.claudeAiOauth;

    if (!oauth?.accessToken) return null;

    const accessToken = oauth.accessToken.trim();
    const refreshToken = (oauth.refreshToken ?? "").trim();

    let expiresAt: number;
    if (typeof oauth.expiresAt === "number") {
      expiresAt = oauth.expiresAt;
    } else if (typeof oauth.expiresAt === "string") {
      const parsed = Date.parse(oauth.expiresAt);
      expiresAt = Number.isFinite(parsed) ? parsed : Date.now() + 3_600_000;
    } else {
      expiresAt = Date.now() + 3_600_000;
    }

    log.debug({
      expiresAt: new Date(expiresAt).toISOString()
    }, "read claude oauth credentials from keychain");

    return { accessToken, refreshToken, expiresAt };
  } catch (err) {
    log.debug({ error: String(err) }, "failed to read claude credentials from keychain");
    return null;
  }
}

/**
 * Checks if the `claude` CLI is available in PATH.
 */
export function isClaudeCliAvailable(): boolean {
  try {
    const command = process.platform === "win32" ? "where" : "which";
    const args = ["claude"];
    execFileSync(command, args, { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Spawns `claude login` (or npx fallback) to trigger interactive OAuth login.
 * Returns a promise that resolves when the login process exits.
 */
export function spawnClaudeLogin(): Promise<{ exitCode: number }> {
  return new Promise((resolve) => {
    const useNpx = !isClaudeCliAvailable();
    const command = useNpx ? "npx" : "claude";
    const args = useNpx ? ["@anthropic-ai/claude-code", "login"] : ["login"];

    const child = spawn(command, args, {
      stdio: "inherit",
      shell: true
    });

    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1 });
    });

    child.on("error", () => {
      resolve({ exitCode: 1 });
    });
  });
}

/**
 * Spawns `claude` briefly to trigger its internal token refresh mechanism.
 * Claude Code auto-refreshes expired tokens on startup.
 */
export function triggerClaudeTokenRefresh(): Promise<boolean> {
  return new Promise((resolve) => {
    const useNpx = !isClaudeCliAvailable();
    const command = useNpx ? "npx" : "claude";
    const args = useNpx ? ["@anthropic-ai/claude-code", "--version"] : ["--version"];

    const child = spawn(command, args, {
      stdio: "ignore",
      shell: true
    });

    const timeout = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 15_000);

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve(code === 0);
    });

    child.on("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}
