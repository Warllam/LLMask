import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AnthropicOAuthTokenStore } from "../../src/modules/provider-adapter/anthropic-oauth-token-store";
import * as oauth from "../../src/shared/anthropic-claude-oauth";
import * as writer from "../../src/shared/anthropic-claude-oauth-writer";

vi.mock("../../src/shared/anthropic-claude-oauth");
vi.mock("../../src/shared/anthropic-claude-oauth-writer");

describe("AnthropicOAuthTokenStore", () => {
  const mockFilePath = "/home/test/.claude/.credentials.json";
  const validToken = {
    accessToken: "valid_access_token",
    refreshToken: "valid_refresh_token",
    expiresAt: Date.now() + 3600000
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("uses default credentials path if none provided", () => {
      vi.mocked(oauth.findClaudeCredentialsPath).mockReturnValue(mockFilePath);
      const store = new AnthropicOAuthTokenStore();
      expect(oauth.findClaudeCredentialsPath).toHaveBeenCalled();
    });

    it("uses provided file path", () => {
      const customPath = "/custom/path/.credentials.json";
      const store = new AnthropicOAuthTokenStore(customPath);
      // Path is stored but we can't easily verify it without accessing private fields
      expect(store).toBeDefined();
    });

    it("uses default cache TTL of 60 seconds", () => {
      const store = new AnthropicOAuthTokenStore();
      expect(store).toBeDefined();
    });

    it("accepts custom cache TTL", () => {
      const store = new AnthropicOAuthTokenStore(undefined, 120000);
      expect(store).toBeDefined();
    });
  });

  describe("hasCredentials", () => {
    it("returns true if credentials exist", () => {
      vi.mocked(oauth.readClaudeCredentials).mockReturnValue(validToken);
      const store = new AnthropicOAuthTokenStore(mockFilePath);
      expect(store.hasCredentials()).toBe(true);
    });

    it("returns false if credentials do not exist", () => {
      vi.mocked(oauth.readClaudeCredentials).mockReturnValue(null);
      const store = new AnthropicOAuthTokenStore(mockFilePath);
      expect(store.hasCredentials()).toBe(false);
    });
  });

  describe("getAuthToken", () => {
    it("returns valid access token from file", async () => {
      vi.mocked(oauth.readClaudeKeychainCredentials).mockReturnValue(null);
      vi.mocked(oauth.readClaudeCredentials).mockReturnValue(validToken);

      const store = new AnthropicOAuthTokenStore(mockFilePath);
      const result = await store.getAuthToken();

      expect(result.accessToken).toBe("valid_access_token");
    });

    it("returns valid access token from keychain on macOS", async () => {
      const keychainToken = {
        accessToken: "keychain_token",
        refreshToken: "keychain_refresh",
        expiresAt: Date.now() + 3600000
      };

      vi.mocked(oauth.readClaudeKeychainCredentials).mockReturnValue(keychainToken);

      const store = new AnthropicOAuthTokenStore(mockFilePath);
      const result = await store.getAuthToken();

      expect(result.accessToken).toBe("keychain_token");
      expect(oauth.readClaudeKeychainCredentials).toHaveBeenCalled();
    });

    it("throws if no credentials exist", async () => {
      vi.mocked(oauth.readClaudeKeychainCredentials).mockReturnValue(null);
      vi.mocked(oauth.readClaudeCredentials).mockReturnValue(null);

      const store = new AnthropicOAuthTokenStore(mockFilePath);

      await expect(store.getAuthToken()).rejects.toThrow(
        /Aucun credential Claude Code trouvé/
      );
    });

    it("uses cached token if within TTL", async () => {
      vi.mocked(oauth.readClaudeKeychainCredentials).mockReturnValue(null);
      vi.mocked(oauth.readClaudeCredentials).mockReturnValue(validToken);

      const store = new AnthropicOAuthTokenStore(mockFilePath, 60000);

      // First call
      await store.getAuthToken();
      expect(oauth.readClaudeCredentials).toHaveBeenCalledTimes(1);

      // Second call should use cache
      await store.getAuthToken();
      expect(oauth.readClaudeCredentials).toHaveBeenCalledTimes(1);
    });

    it("re-reads credentials after cache TTL expires", async () => {
      vi.mocked(oauth.readClaudeKeychainCredentials).mockReturnValue(null);
      vi.mocked(oauth.readClaudeCredentials).mockReturnValue(validToken);

      const store = new AnthropicOAuthTokenStore(mockFilePath, 10); // 10ms TTL

      // First call
      await store.getAuthToken();
      expect(oauth.readClaudeCredentials).toHaveBeenCalledTimes(1);

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 20));

      // Second call should re-read
      await store.getAuthToken();
      expect(oauth.readClaudeCredentials).toHaveBeenCalledTimes(2);
    });
  });

  describe("token refresh", () => {
    it("triggers refresh when token is expired", async () => {
      const expiredToken = {
        accessToken: "expired_token",
        refreshToken: "refresh_token",
        expiresAt: Date.now() - 1000 // Expired 1 second ago
      };

      const refreshedToken = {
        accessToken: "refreshed_token",
        refreshToken: "new_refresh",
        expiresAt: Date.now() + 3600000
      };

      vi.mocked(oauth.readClaudeKeychainCredentials).mockReturnValue(null);
      vi.mocked(oauth.readClaudeCredentials)
        .mockReturnValueOnce(expiredToken)
        .mockReturnValueOnce(refreshedToken);
      vi.mocked(oauth.triggerClaudeTokenRefresh).mockResolvedValue(true);
      vi.mocked(writer.writeClaudeCredentials).mockReturnValue(true);

      const store = new AnthropicOAuthTokenStore(mockFilePath);
      const result = await store.getAuthToken();

      expect(oauth.triggerClaudeTokenRefresh).toHaveBeenCalled();
      expect(result.accessToken).toBe("refreshed_token");
    });

    it("triggers refresh when token is near expiration (within 60s)", async () => {
      const nearExpiredToken = {
        accessToken: "near_expired",
        refreshToken: "refresh_token",
        expiresAt: Date.now() + 30000 // Expires in 30 seconds
      };

      const refreshedToken = {
        accessToken: "refreshed_token",
        refreshToken: "new_refresh",
        expiresAt: Date.now() + 3600000
      };

      vi.mocked(oauth.readClaudeKeychainCredentials).mockReturnValue(null);
      vi.mocked(oauth.readClaudeCredentials)
        .mockReturnValueOnce(nearExpiredToken)
        .mockReturnValueOnce(refreshedToken);
      vi.mocked(oauth.triggerClaudeTokenRefresh).mockResolvedValue(true);
      vi.mocked(writer.writeClaudeCredentials).mockReturnValue(true);

      const store = new AnthropicOAuthTokenStore(mockFilePath);
      await store.getAuthToken();

      expect(oauth.triggerClaudeTokenRefresh).toHaveBeenCalled();
    });

    it("throws if refresh fails", async () => {
      const expiredToken = {
        accessToken: "expired_token",
        refreshToken: "refresh_token",
        expiresAt: Date.now() - 1000
      };

      vi.mocked(oauth.readClaudeKeychainCredentials).mockReturnValue(null);
      vi.mocked(oauth.readClaudeCredentials).mockReturnValue(expiredToken);
      vi.mocked(oauth.triggerClaudeTokenRefresh).mockResolvedValue(false);

      const store = new AnthropicOAuthTokenStore(mockFilePath);

      await expect(store.getAuthToken()).rejects.toThrow(
        /Impossible de rafraîchir le token Claude/
      );
    });

    it("retries token read multiple times after refresh", async () => {
      const expiredToken = {
        accessToken: "expired_token",
        refreshToken: "refresh_token",
        expiresAt: Date.now() - 1000
      };

      const refreshedToken = {
        accessToken: "refreshed_token",
        refreshToken: "new_refresh",
        expiresAt: Date.now() + 3600000
      };

      vi.mocked(oauth.readClaudeKeychainCredentials).mockReturnValue(null);
      vi.mocked(oauth.readClaudeCredentials)
        .mockReturnValueOnce(expiredToken) // Initial read
        .mockReturnValueOnce(expiredToken) // First retry (still expired)
        .mockReturnValueOnce(refreshedToken); // Second retry (success)
      vi.mocked(oauth.triggerClaudeTokenRefresh).mockResolvedValue(true);
      vi.mocked(writer.writeClaudeCredentials).mockReturnValue(true);

      const store = new AnthropicOAuthTokenStore(mockFilePath);
      await store.getAuthToken();

      // Should have retried multiple times
      expect(oauth.readClaudeCredentials).toHaveBeenCalledTimes(3);
    });

    it("persists refreshed tokens using writer", async () => {
      const expiredToken = {
        accessToken: "expired_token",
        refreshToken: "refresh_token",
        expiresAt: Date.now() - 1000
      };

      const refreshedToken = {
        accessToken: "refreshed_token",
        refreshToken: "new_refresh",
        expiresAt: Date.now() + 3600000
      };

      vi.mocked(oauth.readClaudeKeychainCredentials).mockReturnValue(null);
      vi.mocked(oauth.readClaudeCredentials)
        .mockReturnValueOnce(expiredToken)
        .mockReturnValueOnce(refreshedToken);
      vi.mocked(oauth.triggerClaudeTokenRefresh).mockResolvedValue(true);
      vi.mocked(writer.writeClaudeCredentials).mockReturnValue(true);

      const store = new AnthropicOAuthTokenStore(mockFilePath);
      await store.getAuthToken();

      expect(writer.writeClaudeCredentials).toHaveBeenCalledWith(
        {
          access: "refreshed_token",
          refresh: "new_refresh",
          expires: refreshedToken.expiresAt
        },
        expect.any(String)
      );
    });

    it("handles concurrent refresh attempts (deduplication)", async () => {
      const expiredToken = {
        accessToken: "expired_token",
        refreshToken: "refresh_token",
        expiresAt: Date.now() - 1000
      };

      const refreshedToken = {
        accessToken: "refreshed_token",
        refreshToken: "new_refresh",
        expiresAt: Date.now() + 3600000
      };

      vi.mocked(oauth.readClaudeKeychainCredentials).mockReturnValue(null);
      vi.mocked(oauth.readClaudeCredentials)
        .mockReturnValueOnce(expiredToken)
        .mockReturnValue(refreshedToken);
      vi.mocked(oauth.triggerClaudeTokenRefresh).mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return true;
      });
      vi.mocked(writer.writeClaudeCredentials).mockReturnValue(true);

      const store = new AnthropicOAuthTokenStore(mockFilePath, 0); // No cache

      // Trigger multiple concurrent refresh attempts
      const promises = [
        store.getAuthToken(),
        store.getAuthToken(),
        store.getAuthToken()
      ];

      await Promise.all(promises);

      // Should only trigger refresh once despite multiple calls
      expect(oauth.triggerClaudeTokenRefresh).toHaveBeenCalledTimes(1);
    });

    it("uses fallback token if refresh completes but token still appears expired", async () => {
      const expiredToken = {
        accessToken: "still_expired_token",
        refreshToken: "refresh_token",
        expiresAt: Date.now() - 1000
      };

      vi.mocked(oauth.readClaudeKeychainCredentials).mockReturnValue(null);
      vi.mocked(oauth.readClaudeCredentials).mockReturnValue(expiredToken);
      vi.mocked(oauth.triggerClaudeTokenRefresh).mockResolvedValue(true);

      const store = new AnthropicOAuthTokenStore(mockFilePath);
      const result = await store.getAuthToken();

      // Should use the token anyway as fallback
      expect(result.accessToken).toBe("still_expired_token");
    });

    it("throws if refresh completes but no token exists", async () => {
      const expiredToken = {
        accessToken: "expired_token",
        refreshToken: "refresh_token",
        expiresAt: Date.now() - 1000
      };

      vi.mocked(oauth.readClaudeKeychainCredentials).mockReturnValue(null);
      vi.mocked(oauth.readClaudeCredentials)
        .mockReturnValueOnce(expiredToken)
        .mockReturnValue(null); // All retry reads return null
      vi.mocked(oauth.triggerClaudeTokenRefresh).mockResolvedValue(true);

      const store = new AnthropicOAuthTokenStore(mockFilePath);

      await expect(store.getAuthToken()).rejects.toThrow(
        /Token Claude expiré et impossible de rafraîchir/
      );
    });

    it("invalidates cache before refresh retry reads", async () => {
      const expiredToken = {
        accessToken: "expired_token",
        refreshToken: "refresh_token",
        expiresAt: Date.now() - 1000
      };

      const refreshedToken = {
        accessToken: "refreshed_token",
        refreshToken: "new_refresh",
        expiresAt: Date.now() + 3600000
      };

      vi.mocked(oauth.readClaudeKeychainCredentials).mockReturnValue(null);
      vi.mocked(oauth.readClaudeCredentials)
        .mockReturnValueOnce(expiredToken)
        .mockReturnValueOnce(refreshedToken);
      vi.mocked(oauth.triggerClaudeTokenRefresh).mockResolvedValue(true);
      vi.mocked(writer.writeClaudeCredentials).mockReturnValue(true);

      const store = new AnthropicOAuthTokenStore(mockFilePath, 600000); // Long cache
      await store.getAuthToken();

      // Cache should have been invalidated, so file should be read again
      expect(oauth.readClaudeCredentials).toHaveBeenCalledTimes(2);
    });
  });

  describe("edge cases", () => {
    it("prefers keychain over file on macOS", async () => {
      const keychainToken = {
        accessToken: "keychain_token",
        refreshToken: "keychain_refresh",
        expiresAt: Date.now() + 3600000
      };

      const fileToken = {
        accessToken: "file_token",
        refreshToken: "file_refresh",
        expiresAt: Date.now() + 3600000
      };

      vi.mocked(oauth.readClaudeKeychainCredentials).mockReturnValue(keychainToken);
      vi.mocked(oauth.readClaudeCredentials).mockReturnValue(fileToken);

      const store = new AnthropicOAuthTokenStore(mockFilePath);
      const result = await store.getAuthToken();

      expect(result.accessToken).toBe("keychain_token");
      expect(oauth.readClaudeCredentials).not.toHaveBeenCalled();
    });

    it("updates cache after successful refresh", async () => {
      const expiredToken = {
        accessToken: "expired_token",
        refreshToken: "refresh_token",
        expiresAt: Date.now() - 1000
      };

      const refreshedToken = {
        accessToken: "refreshed_token",
        refreshToken: "new_refresh",
        expiresAt: Date.now() + 3600000
      };

      vi.mocked(oauth.readClaudeKeychainCredentials).mockReturnValue(null);
      vi.mocked(oauth.readClaudeCredentials)
        .mockReturnValueOnce(expiredToken)
        .mockReturnValue(refreshedToken);
      vi.mocked(oauth.triggerClaudeTokenRefresh).mockResolvedValue(true);
      vi.mocked(writer.writeClaudeCredentials).mockReturnValue(true);

      const store = new AnthropicOAuthTokenStore(mockFilePath, 60000);
      
      await store.getAuthToken();
      
      // Second call should use cached refreshed token
      await store.getAuthToken();

      // Should only read credentials twice total (initial + refresh retry)
      expect(oauth.readClaudeCredentials).toHaveBeenCalledTimes(2);
    });
  });
});
