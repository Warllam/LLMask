import { resolve } from "node:path";
import {
  findClaudeCredentialsPath,
  readClaudeCredentials,
  readClaudeKeychainCredentials,
  triggerClaudeTokenRefresh,
  type ClaudeOAuthTokenSet
} from "../../shared/anthropic-claude-oauth";
import { writeClaudeCredentials } from "../../shared/anthropic-claude-oauth-writer";
import { log } from "../../shared/logger";

const REFRESH_SKEW_MS = 60_000;
const RETRY_READ_DELAY_MS = 2_000;
const MAX_REFRESH_RETRIES = 3;
const DEFAULT_CACHE_TTL_MS = 60_000; // 1 minute

type CachedToken = {
  value: ClaudeOAuthTokenSet;
  readAt: number;
};

/**
 * Reads and manages Claude Code OAuth credentials.
 * Supports auto-refresh by triggering Claude Code's internal refresh mechanism.
 *
 * Default credentials path: ~/.claude/.credentials.json
 */
export class AnthropicOAuthTokenStore {
  private readonly filePath: string;
  private readonly cacheTtlMs: number;
  private cache: CachedToken | null = null;
  private refreshPromise: Promise<ClaudeOAuthTokenSet> | null = null;

  constructor(filePath?: string, cacheTtlMs = DEFAULT_CACHE_TTL_MS) {
    this.filePath = resolve(filePath ?? findClaudeCredentialsPath());
    this.cacheTtlMs = cacheTtlMs;
  }

  /**
   * Returns a valid access token. Triggers refresh if expired.
   * Throws if no credentials exist (user must run `claude login`).
   */
  async getAuthToken(): Promise<{ accessToken: string }> {
    const token = await this.getValidToken();
    log.info({
      expiresAt: new Date(token.expiresAt).toISOString(),
      fromCache: !!this.cache,
      ttl: this.cacheTtlMs
    }, "claude oauth token retrieved");
    return { accessToken: token.accessToken };
  }

  /**
   * Checks whether credentials exist on disk.
   */
  hasCredentials(): boolean {
    return readClaudeCredentials(this.filePath) !== null;
  }

  private async getValidToken(): Promise<ClaudeOAuthTokenSet> {
    const current = this.readCredentials();
    if (!this.shouldRefresh(current)) {
      return current;
    }
    return this.doRefresh();
  }

  private readCredentials(): ClaudeOAuthTokenSet {
    // Check cache first
    if (this.cache && Date.now() - this.cache.readAt < this.cacheTtlMs) {
      log.debug({
        cacheAge: Date.now() - this.cache.readAt,
        ttl: this.cacheTtlMs
      }, "using cached claude oauth credentials");
      return this.cache.value;
    }

    // Try keychain first (macOS only)
    const keychainCreds = readClaudeKeychainCredentials();
    if (keychainCreds) {
      log.info("read claude oauth credentials from keychain");
      this.cache = { value: keychainCreds, readAt: Date.now() };
      return keychainCreds;
    }

    // Fallback to file
    const fileCreds = readClaudeCredentials(this.filePath);
    if (!fileCreds) {
      throw new Error(
        `Aucun credential Claude Code trouvé dans ${this.filePath}. ` +
        `Lancez 'claude login' (ou 'npx @anthropic-ai/claude-code login') pour vous connecter.`
      );
    }

    log.info({ path: this.filePath }, "read claude oauth credentials from file");
    this.cache = { value: fileCreds, readAt: Date.now() };
    return fileCreds;
  }

  private shouldRefresh(token: ClaudeOAuthTokenSet): boolean {
    return Date.now() >= token.expiresAt - REFRESH_SKEW_MS;
  }

  private async doRefresh(): Promise<ClaudeOAuthTokenSet> {
    if (this.refreshPromise) {
      log.debug("waiting for existing refresh operation");
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      log.info("triggering claude oauth token refresh");

      // Trigger Claude Code to refresh its own token
      const ok = await triggerClaudeTokenRefresh();
      if (!ok) {
        log.error("failed to trigger claude token refresh");
        throw new Error(
          "Impossible de rafraîchir le token Claude. " +
          "Relancez 'claude login' pour vous reconnecter."
        );
      }

      // Wait briefly then re-read the credentials file
      for (let attempt = 0; attempt < MAX_REFRESH_RETRIES; attempt++) {
        await sleep(RETRY_READ_DELAY_MS);
        
        // Invalidate cache to force fresh read
        this.cache = null;
        
        const refreshed = readClaudeCredentials(this.filePath);
        if (refreshed && !this.shouldRefresh(refreshed)) {
          log.info({
            expiresAt: new Date(refreshed.expiresAt).toISOString(),
            attempt: attempt + 1
          }, "claude oauth token refreshed successfully");
          
          // Persist refreshed tokens to keychain and file
          const written = writeClaudeCredentials(
            {
              access: refreshed.accessToken,
              refresh: refreshed.refreshToken,
              expires: refreshed.expiresAt
            },
            this.filePath
          );

          if (written) {
            log.info("persisted refreshed claude oauth tokens");
          } else {
            log.warn("failed to persist refreshed tokens (they will be lost on restart)");
          }
          
          // Update cache with refreshed token
          this.cache = { value: refreshed, readAt: Date.now() };
          return refreshed;
        }
      }

      // Even if still "expired", return what we have — the token may still work
      const fallback = readClaudeCredentials(this.filePath);
      if (fallback) {
        log.warn("token refresh completed but token still appears expired, using anyway");
        this.cache = { value: fallback, readAt: Date.now() };
        return fallback;
      }

      log.error("token refresh failed completely");
      throw new Error(
        "Token Claude expiré et impossible de rafraîchir. " +
        "Relancez 'claude login'."
      );
    })();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
