import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { log } from "./logger";

const CLAUDE_CLI_KEYCHAIN_SERVICE = "Claude Code-credentials";
const CLAUDE_CLI_KEYCHAIN_ACCOUNT = "Claude Code";

export type OAuthCredentials = {
  access: string;
  refresh: string;
  expires: number;
};

/**
 * Writes refreshed OAuth credentials to macOS keychain.
 * Returns true if successful, false if not on macOS or if keychain update failed.
 */
export function writeClaudeKeychainCredentials(
  newCredentials: OAuthCredentials
): boolean {
  if (process.platform !== "darwin") {
    return false;
  }

  try {
    // Read existing keychain entry
    const existing = execFileSync(
      "security",
      ["find-generic-password", "-s", CLAUDE_CLI_KEYCHAIN_SERVICE, "-w"],
      { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }
    );

    const existingData = JSON.parse(existing.trim());
    const existingOauth = existingData?.claudeAiOauth;

    if (!existingOauth || typeof existingOauth !== "object") {
      log.warn("keychain entry exists but has no valid claudeAiOauth object");
      return false;
    }

    // Merge new tokens
    existingData.claudeAiOauth = {
      ...existingOauth,
      accessToken: newCredentials.access,
      refreshToken: newCredentials.refresh,
      expiresAt: newCredentials.expires
    };

    // Update keychain
    execFileSync(
      "security",
      [
        "add-generic-password",
        "-U",
        "-s",
        CLAUDE_CLI_KEYCHAIN_SERVICE,
        "-a",
        CLAUDE_CLI_KEYCHAIN_ACCOUNT,
        "-w",
        JSON.stringify(existingData)
      ],
      { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }
    );

    log.info({
      expiresAt: new Date(newCredentials.expires).toISOString()
    }, "updated claude oauth credentials in keychain");

    return true;
  } catch (err) {
    log.warn({ error: String(err) }, "failed to update keychain credentials");
    return false;
  }
}

/**
 * Writes refreshed OAuth credentials to the credentials file.
 * Returns true if successful, false otherwise.
 */
export function writeClaudeFileCredentials(
  newCredentials: OAuthCredentials,
  filePath: string
): boolean {
  if (!existsSync(filePath)) {
    log.warn({ path: filePath }, "credentials file does not exist");
    return false;
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    const existingOauth = data.claudeAiOauth;

    if (!existingOauth || typeof existingOauth !== "object") {
      log.warn("credentials file exists but has no valid claudeAiOauth object");
      return false;
    }

    data.claudeAiOauth = {
      ...existingOauth,
      accessToken: newCredentials.access,
      refreshToken: newCredentials.refresh,
      expiresAt: newCredentials.expires
    };

    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");

    log.info({
      path: filePath,
      expiresAt: new Date(newCredentials.expires).toISOString()
    }, "updated claude oauth credentials in file");

    return true;
  } catch (err) {
    log.warn({
      path: filePath,
      error: String(err)
    }, "failed to update file credentials");
    return false;
  }
}

/**
 * Writes refreshed OAuth credentials to both keychain (macOS) and file.
 * Tries keychain first, then file. Returns true if at least one succeeded.
 */
export function writeClaudeCredentials(
  newCredentials: OAuthCredentials,
  filePath: string
): boolean {
  let success = false;

  // Try keychain first (macOS)
  if (writeClaudeKeychainCredentials(newCredentials)) {
    success = true;
  }

  // Also try file
  if (writeClaudeFileCredentials(newCredentials, filePath)) {
    success = true;
  }

  return success;
}
