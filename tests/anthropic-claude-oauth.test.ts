import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as cp from "node:child_process";
import {
  findClaudeCredentialsPath,
  readClaudeCredentials,
  readClaudeKeychainCredentials,
  isClaudeCliAvailable,
  spawnClaudeLogin,
  triggerClaudeTokenRefresh
} from "../../src/shared/anthropic-claude-oauth";

vi.mock("node:fs");
vi.mock("node:os");
vi.mock("node:child_process");

describe("anthropic-claude-oauth", () => {
  const mockHomedir = "/home/testuser";
  const mockCredPath = `${mockHomedir}/.claude/.credentials.json`;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(os.homedir).mockReturnValue(mockHomedir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("findClaudeCredentialsPath", () => {
    it("returns default credentials path in home directory", () => {
      const path = findClaudeCredentialsPath();
      expect(path).toBe(mockCredPath);
      expect(os.homedir).toHaveBeenCalled();
    });
  });

  describe("readClaudeCredentials", () => {
    it("returns null if file does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const result = readClaudeCredentials(mockCredPath);
      expect(result).toBeNull();
    });

    it("returns null if file read fails", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("read error");
      });
      const result = readClaudeCredentials(mockCredPath);
      expect(result).toBeNull();
    });

    it("returns null if JSON parse fails", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("invalid json");
      const result = readClaudeCredentials(mockCredPath);
      expect(result).toBeNull();
    });

    it("returns null if claudeAiOauth is missing", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));
      const result = readClaudeCredentials(mockCredPath);
      expect(result).toBeNull();
    });

    it("returns null if accessToken is missing or empty", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        claudeAiOauth: { refreshToken: "refresh123" }
      }));
      const result = readClaudeCredentials(mockCredPath);
      expect(result).toBeNull();
    });

    it("parses valid credentials with numeric expiresAt", () => {
      const expiresAt = Date.now() + 3600000;
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        claudeAiOauth: {
          accessToken: "access123",
          refreshToken: "refresh123",
          expiresAt
        }
      }));

      const result = readClaudeCredentials(mockCredPath);
      expect(result).toEqual({
        accessToken: "access123",
        refreshToken: "refresh123",
        expiresAt
      });
    });

    it("parses valid credentials with string expiresAt", () => {
      const dateStr = "2026-12-31T23:59:59Z";
      const expectedTs = Date.parse(dateStr);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        claudeAiOauth: {
          accessToken: "access123",
          refreshToken: "refresh123",
          expiresAt: dateStr
        }
      }));

      const result = readClaudeCredentials(mockCredPath);
      expect(result).toEqual({
        accessToken: "access123",
        refreshToken: "refresh123",
        expiresAt: expectedTs
      });
    });

    it("uses default expiresAt if missing", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        claudeAiOauth: {
          accessToken: "access123",
          refreshToken: "refresh123"
        }
      }));

      const before = Date.now() + 3600000;
      const result = readClaudeCredentials(mockCredPath);
      const after = Date.now() + 3600000;

      expect(result).not.toBeNull();
      expect(result!.accessToken).toBe("access123");
      expect(result!.expiresAt).toBeGreaterThanOrEqual(before);
      expect(result!.expiresAt).toBeLessThanOrEqual(after);
    });

    it("trims whitespace from tokens", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        claudeAiOauth: {
          accessToken: "  access123  ",
          refreshToken: "  refresh123  ",
          expiresAt: Date.now() + 3600000
        }
      }));

      const result = readClaudeCredentials(mockCredPath);
      expect(result!.accessToken).toBe("access123");
      expect(result!.refreshToken).toBe("refresh123");
    });
  });

  describe("readClaudeKeychainCredentials", () => {
    const originalPlatform = process.platform;

    afterEach(() => {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        writable: true
      });
    });

    it("returns null if not on macOS", () => {
      Object.defineProperty(process, "platform", {
        value: "linux",
        writable: true
      });

      const result = readClaudeKeychainCredentials();
      expect(result).toBeNull();
    });

    it("returns null if execFileSync throws", () => {
      Object.defineProperty(process, "platform", {
        value: "darwin",
        writable: true
      });

      vi.mocked(cp.execFileSync).mockImplementation(() => {
        throw new Error("keychain error");
      });

      const result = readClaudeKeychainCredentials();
      expect(result).toBeNull();
    });

    it("parses valid keychain credentials", () => {
      Object.defineProperty(process, "platform", {
        value: "darwin",
        writable: true
      });

      const expiresAt = Date.now() + 3600000;
      vi.mocked(cp.execFileSync).mockReturnValue(JSON.stringify({
        claudeAiOauth: {
          accessToken: "keychain_access",
          refreshToken: "keychain_refresh",
          expiresAt
        }
      }));

      const result = readClaudeKeychainCredentials();
      expect(result).toEqual({
        accessToken: "keychain_access",
        refreshToken: "keychain_refresh",
        expiresAt
      });
    });

    it("returns null if keychain data has no accessToken", () => {
      Object.defineProperty(process, "platform", {
        value: "darwin",
        writable: true
      });

      vi.mocked(cp.execFileSync).mockReturnValue(JSON.stringify({
        claudeAiOauth: { refreshToken: "refresh123" }
      }));

      const result = readClaudeKeychainCredentials();
      expect(result).toBeNull();
    });
  });

  describe("isClaudeCliAvailable", () => {
    const originalPlatform = process.platform;

    afterEach(() => {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        writable: true
      });
    });

    it("returns true if claude CLI is found", () => {
      vi.mocked(cp.execFileSync).mockReturnValue("");
      const result = isClaudeCliAvailable();
      expect(result).toBe(true);
    });

    it("returns false if claude CLI is not found", () => {
      vi.mocked(cp.execFileSync).mockImplementation(() => {
        throw new Error("not found");
      });
      const result = isClaudeCliAvailable();
      expect(result).toBe(false);
    });

    it("uses 'where' command on Windows", () => {
      Object.defineProperty(process, "platform", {
        value: "win32",
        writable: true
      });

      vi.mocked(cp.execFileSync).mockReturnValue("");
      isClaudeCliAvailable();

      expect(cp.execFileSync).toHaveBeenCalledWith(
        "where",
        ["claude"],
        expect.any(Object)
      );
    });

    it("uses 'which' command on non-Windows", () => {
      Object.defineProperty(process, "platform", {
        value: "linux",
        writable: true
      });

      vi.mocked(cp.execFileSync).mockReturnValue("");
      isClaudeCliAvailable();

      expect(cp.execFileSync).toHaveBeenCalledWith(
        "which",
        ["claude"],
        expect.any(Object)
      );
    });
  });

  describe("spawnClaudeLogin", () => {
    it("spawns claude login when CLI is available", async () => {
      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === "close") {
            setTimeout(() => callback(0), 10);
          }
          return mockChild;
        })
      };

      vi.mocked(cp.execFileSync).mockReturnValue(""); // CLI available
      vi.mocked(cp.spawn).mockReturnValue(mockChild as any);

      const result = await spawnClaudeLogin();

      expect(result.exitCode).toBe(0);
      expect(cp.spawn).toHaveBeenCalledWith(
        "claude",
        ["login"],
        expect.any(Object)
      );
    });

    it("spawns npx fallback when CLI is not available", async () => {
      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === "close") {
            setTimeout(() => callback(0), 10);
          }
          return mockChild;
        })
      };

      vi.mocked(cp.execFileSync).mockImplementation(() => {
        throw new Error("CLI not found");
      });
      vi.mocked(cp.spawn).mockReturnValue(mockChild as any);

      const result = await spawnClaudeLogin();

      expect(result.exitCode).toBe(0);
      expect(cp.spawn).toHaveBeenCalledWith(
        "npx",
        ["@anthropic-ai/claude-code", "login"],
        expect.any(Object)
      );
    });

    it("returns exitCode 1 on error", async () => {
      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === "error") {
            setTimeout(() => callback(new Error("spawn error")), 10);
          }
          return mockChild;
        })
      };

      vi.mocked(cp.execFileSync).mockReturnValue("");
      vi.mocked(cp.spawn).mockReturnValue(mockChild as any);

      const result = await spawnClaudeLogin();
      expect(result.exitCode).toBe(1);
    });
  });

  describe("triggerClaudeTokenRefresh", () => {
    it("returns true when refresh succeeds", async () => {
      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === "close") {
            setTimeout(() => callback(0), 10);
          }
          return mockChild;
        }),
        kill: vi.fn()
      };

      vi.mocked(cp.execFileSync).mockReturnValue(""); // CLI available
      vi.mocked(cp.spawn).mockReturnValue(mockChild as any);

      const result = await triggerClaudeTokenRefresh();
      expect(result).toBe(true);
    });

    it("returns false when refresh fails", async () => {
      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === "close") {
            setTimeout(() => callback(1), 10);
          }
          return mockChild;
        }),
        kill: vi.fn()
      };

      vi.mocked(cp.execFileSync).mockReturnValue("");
      vi.mocked(cp.spawn).mockReturnValue(mockChild as any);

      const result = await triggerClaudeTokenRefresh();
      expect(result).toBe(false);
    });

    it("returns false on spawn error", async () => {
      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === "error") {
            setTimeout(() => callback(new Error("spawn error")), 10);
          }
          return mockChild;
        }),
        kill: vi.fn()
      };

      vi.mocked(cp.execFileSync).mockReturnValue("");
      vi.mocked(cp.spawn).mockReturnValue(mockChild as any);

      const result = await triggerClaudeTokenRefresh();
      expect(result).toBe(false);
    });

    it("uses npx fallback when CLI not available", async () => {
      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === "close") {
            setTimeout(() => callback(0), 10);
          }
          return mockChild;
        }),
        kill: vi.fn()
      };

      vi.mocked(cp.execFileSync).mockImplementation(() => {
        throw new Error("not found");
      });
      vi.mocked(cp.spawn).mockReturnValue(mockChild as any);

      await triggerClaudeTokenRefresh();

      expect(cp.spawn).toHaveBeenCalledWith(
        "npx",
        ["@anthropic-ai/claude-code", "--version"],
        expect.any(Object)
      );
    });
  });
});
