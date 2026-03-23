import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as cp from "node:child_process";
import {
  writeClaudeKeychainCredentials,
  writeClaudeFileCredentials,
  writeClaudeCredentials
} from "../../src/shared/anthropic-claude-oauth-writer";

vi.mock("node:fs");
vi.mock("node:child_process");

describe("anthropic-claude-oauth-writer", () => {
  const mockCredentials = {
    access: "new_access_token",
    refresh: "new_refresh_token",
    expires: Date.now() + 7200000
  };

  const mockFilePath = "/home/testuser/.claude/.credentials.json";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("writeClaudeKeychainCredentials", () => {
    const originalPlatform = process.platform;

    afterEach(() => {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        writable: true
      });
    });

    it("returns false if not on macOS", () => {
      Object.defineProperty(process, "platform", {
        value: "linux",
        writable: true
      });

      const result = writeClaudeKeychainCredentials(mockCredentials);
      expect(result).toBe(false);
    });

    it("returns false if reading keychain fails", () => {
      Object.defineProperty(process, "platform", {
        value: "darwin",
        writable: true
      });

      vi.mocked(cp.execFileSync).mockImplementation(() => {
        throw new Error("keychain read error");
      });

      const result = writeClaudeKeychainCredentials(mockCredentials);
      expect(result).toBe(false);
    });

    it("returns false if existing data has no claudeAiOauth", () => {
      Object.defineProperty(process, "platform", {
        value: "darwin",
        writable: true
      });

      vi.mocked(cp.execFileSync).mockReturnValueOnce(JSON.stringify({}));

      const result = writeClaudeKeychainCredentials(mockCredentials);
      expect(result).toBe(false);
    });

    it("successfully updates keychain with new credentials", () => {
      Object.defineProperty(process, "platform", {
        value: "darwin",
        writable: true
      });

      const existingData = {
        claudeAiOauth: {
          accessToken: "old_access",
          refreshToken: "old_refresh",
          expiresAt: Date.now() - 1000,
          otherField: "preserved"
        }
      };

      vi.mocked(cp.execFileSync)
        .mockReturnValueOnce(JSON.stringify(existingData)) // find-generic-password
        .mockReturnValueOnce(""); // add-generic-password

      const result = writeClaudeKeychainCredentials(mockCredentials);

      expect(result).toBe(true);
      expect(cp.execFileSync).toHaveBeenCalledTimes(2);
      
      // Verify the update call
      const updateCall = vi.mocked(cp.execFileSync).mock.calls[1];
      expect(updateCall[0]).toBe("security");
      expect(updateCall[1]).toEqual([
        "add-generic-password",
        "-U",
        "-s",
        "Claude Code-credentials",
        "-a",
        "Claude Code",
        "-w",
        expect.stringContaining("new_access_token")
      ]);
    });

    it("preserves other fields in claudeAiOauth object", () => {
      Object.defineProperty(process, "platform", {
        value: "darwin",
        writable: true
      });

      const existingData = {
        claudeAiOauth: {
          accessToken: "old",
          refreshToken: "old",
          expiresAt: 12345,
          customField: "should_be_preserved"
        }
      };

      vi.mocked(cp.execFileSync)
        .mockReturnValueOnce(JSON.stringify(existingData))
        .mockReturnValueOnce("");

      writeClaudeKeychainCredentials(mockCredentials);

      const updateCall = vi.mocked(cp.execFileSync).mock.calls[1];
      const writtenData = JSON.parse(updateCall[1][7] as string);
      
      expect(writtenData.claudeAiOauth.customField).toBe("should_be_preserved");
      expect(writtenData.claudeAiOauth.accessToken).toBe(mockCredentials.access);
      expect(writtenData.claudeAiOauth.refreshToken).toBe(mockCredentials.refresh);
      expect(writtenData.claudeAiOauth.expiresAt).toBe(mockCredentials.expires);
    });
  });

  describe("writeClaudeFileCredentials", () => {
    it("returns false if file does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = writeClaudeFileCredentials(mockCredentials, mockFilePath);
      expect(result).toBe(false);
    });

    it("returns false if file read fails", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("read error");
      });

      const result = writeClaudeFileCredentials(mockCredentials, mockFilePath);
      expect(result).toBe(false);
    });

    it("returns false if JSON parse fails", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("invalid json");

      const result = writeClaudeFileCredentials(mockCredentials, mockFilePath);
      expect(result).toBe(false);
    });

    it("returns false if claudeAiOauth is missing", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

      const result = writeClaudeFileCredentials(mockCredentials, mockFilePath);
      expect(result).toBe(false);
    });

    it("successfully updates file with new credentials", () => {
      const existingData = {
        claudeAiOauth: {
          accessToken: "old_access",
          refreshToken: "old_refresh",
          expiresAt: Date.now() - 1000
        }
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingData));
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});

      const result = writeClaudeFileCredentials(mockCredentials, mockFilePath);

      expect(result).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        mockFilePath,
        expect.stringContaining("new_access_token"),
        "utf8"
      );
    });

    it("preserves other fields in the credentials file", () => {
      const existingData = {
        claudeAiOauth: {
          accessToken: "old",
          refreshToken: "old",
          expiresAt: 12345,
          customField: "preserved"
        },
        otherConfig: "also_preserved"
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingData));
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});

      writeClaudeFileCredentials(mockCredentials, mockFilePath);

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);

      expect(writtenData.otherConfig).toBe("also_preserved");
      expect(writtenData.claudeAiOauth.customField).toBe("preserved");
      expect(writtenData.claudeAiOauth.accessToken).toBe(mockCredentials.access);
    });

    it("returns false if write fails", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        claudeAiOauth: { accessToken: "old", refreshToken: "old" }
      }));
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error("write error");
      });

      const result = writeClaudeFileCredentials(mockCredentials, mockFilePath);
      expect(result).toBe(false);
    });
  });

  describe("writeClaudeCredentials", () => {
    const originalPlatform = process.platform;

    afterEach(() => {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        writable: true
      });
    });

    it("returns true if keychain write succeeds", () => {
      Object.defineProperty(process, "platform", {
        value: "darwin",
        writable: true
      });

      const existingData = {
        claudeAiOauth: { accessToken: "old", refreshToken: "old" }
      };

      vi.mocked(cp.execFileSync)
        .mockReturnValueOnce(JSON.stringify(existingData))
        .mockReturnValueOnce("");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = writeClaudeCredentials(mockCredentials, mockFilePath);
      expect(result).toBe(true);
    });

    it("returns true if file write succeeds", () => {
      Object.defineProperty(process, "platform", {
        value: "linux",
        writable: true
      });

      const existingData = {
        claudeAiOauth: { accessToken: "old", refreshToken: "old" }
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingData));
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});

      const result = writeClaudeCredentials(mockCredentials, mockFilePath);
      expect(result).toBe(true);
    });

    it("returns true if both keychain and file succeed", () => {
      Object.defineProperty(process, "platform", {
        value: "darwin",
        writable: true
      });

      const existingData = {
        claudeAiOauth: { accessToken: "old", refreshToken: "old" }
      };

      vi.mocked(cp.execFileSync)
        .mockReturnValueOnce(JSON.stringify(existingData))
        .mockReturnValueOnce("");
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingData));
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});

      const result = writeClaudeCredentials(mockCredentials, mockFilePath);
      expect(result).toBe(true);
    });

    it("returns false if both fail", () => {
      Object.defineProperty(process, "platform", {
        value: "darwin",
        writable: true
      });

      vi.mocked(cp.execFileSync).mockImplementation(() => {
        throw new Error("keychain error");
      });
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = writeClaudeCredentials(mockCredentials, mockFilePath);
      expect(result).toBe(false);
    });

    it("tries both keychain and file even if keychain fails", () => {
      Object.defineProperty(process, "platform", {
        value: "darwin",
        writable: true
      });

      const existingData = {
        claudeAiOauth: { accessToken: "old", refreshToken: "old" }
      };

      vi.mocked(cp.execFileSync).mockImplementation(() => {
        throw new Error("keychain error");
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingData));
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});

      const result = writeClaudeCredentials(mockCredentials, mockFilePath);
      expect(result).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });
});
