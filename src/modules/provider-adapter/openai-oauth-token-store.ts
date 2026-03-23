import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  refreshOpenAiCodexToken,
  type OpenAiCodexStoredToken
} from "../../shared/openai-codex-oauth";

const REFRESH_SKEW_MS = 60_000;

export class OpenAiOAuthTokenStore {
  private readonly filePath: string;
  private refreshPromise: Promise<OpenAiCodexStoredToken> | null = null;

  constructor(filePath: string) {
    this.filePath = resolve(filePath);
  }

  async getAuthToken(): Promise<{ accessToken: string; accountId: string | null }> {
    const token = await this.getValidToken();
    return {
      accessToken: token.accessToken,
      accountId: token.accountId
    };
  }

  private async getValidToken(): Promise<OpenAiCodexStoredToken> {
    const current = this.readTokenFile();
    if (!this.shouldRefresh(current)) {
      return current;
    }

    return this.refreshToken(current);
  }

  private async refreshToken(current: OpenAiCodexStoredToken): Promise<OpenAiCodexStoredToken> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      const refreshed = await refreshOpenAiCodexToken(current.refreshToken);
      const next: OpenAiCodexStoredToken = {
        version: 1,
        provider: "openai-codex",
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
        accountId: refreshed.accountId,
        updatedAt: new Date().toISOString()
      };

      this.writeTokenFile(next);
      return next;
    })();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private shouldRefresh(token: OpenAiCodexStoredToken): boolean {
    return Date.now() >= token.expiresAt - REFRESH_SKEW_MS;
  }

  private readTokenFile(): OpenAiCodexStoredToken {
    if (!existsSync(this.filePath)) {
      throw new Error(
        `OpenAI OAuth token file not found: ${this.filePath}. Re-run 'npm run setup' and choose OpenAI OAuth.`
      );
    }

    const raw = readFileSync(this.filePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`OpenAI OAuth token file is not valid JSON: ${this.filePath}`);
    }

    const record = parsed as Partial<OpenAiCodexStoredToken> | null;
    if (
      !record ||
      record.version !== 1 ||
      record.provider !== "openai-codex" ||
      typeof record.accessToken !== "string" ||
      typeof record.refreshToken !== "string" ||
      typeof record.expiresAt !== "number"
    ) {
      throw new Error(`OpenAI OAuth token file has an invalid format: ${this.filePath}`);
    }

    return {
      version: 1,
      provider: "openai-codex",
      accessToken: record.accessToken,
      refreshToken: record.refreshToken,
      expiresAt: record.expiresAt,
      accountId: typeof record.accountId === "string" ? record.accountId : null,
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString()
    };
  }

  private writeTokenFile(record: OpenAiCodexStoredToken) {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    renameSync(tmpPath, this.filePath);
  }
}
