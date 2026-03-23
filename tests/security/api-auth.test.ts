import { describe, it, expect } from "vitest";
import {
  hashApiKey,
  compareHashes,
  verifyApiKey,
  needsAuth,
  type ApiKeyEntry,
  type ApiAuthConfig,
} from "../../../src/modules/security/api-auth";

describe("hashApiKey", () => {
  it("produces consistent SHA-256 hex output", () => {
    const hash = hashApiKey("test-key");
    expect(hash).toHaveLength(64); // SHA-256 = 32 bytes = 64 hex chars
    expect(hashApiKey("test-key")).toBe(hash); // deterministic
  });

  it("produces different hashes for different keys", () => {
    expect(hashApiKey("key-a")).not.toBe(hashApiKey("key-b"));
  });
});

describe("compareHashes (timing-safe)", () => {
  it("returns true for identical hashes", () => {
    const hash = hashApiKey("my-secret");
    expect(compareHashes(hash, hash)).toBe(true);
  });

  it("returns false for different hashes", () => {
    expect(compareHashes(hashApiKey("a"), hashApiKey("b"))).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(compareHashes("abc", "abcdef")).toBe(false);
  });

  it("returns false for different-length hex strings", () => {
    const h1 = hashApiKey("key1");
    expect(compareHashes(h1, h1.slice(0, 32))).toBe(false);
  });
});

describe("verifyApiKey", () => {
  const keys: ApiKeyEntry[] = [
    { hash: hashApiKey("valid-key-1"), label: "test1" },
    { hash: hashApiKey("valid-key-2"), label: "test2", revoked: true },
    { hash: hashApiKey("expired-key"), label: "expired", expiresAt: 1000 },
  ];

  it("accepts a valid key", () => {
    const entry = verifyApiKey("valid-key-1", keys);
    expect(entry).not.toBeNull();
    expect(entry!.label).toBe("test1");
  });

  it("rejects a revoked key", () => {
    expect(verifyApiKey("valid-key-2", keys)).toBeNull();
  });

  it("rejects an expired key", () => {
    expect(verifyApiKey("expired-key", keys)).toBeNull();
  });

  it("rejects an unknown key", () => {
    expect(verifyApiKey("unknown-key", keys)).toBeNull();
  });
});

describe("needsAuth", () => {
  const config: ApiAuthConfig = {
    enabled: true,
    keys: [],
    publicPaths: ["/health", "/ready"],
    protectedPaths: ["/v1/", "/admin"],
  };

  it("public paths do not need auth", () => {
    expect(needsAuth("/health", config)).toBe(false);
    expect(needsAuth("/ready", config)).toBe(false);
  });

  it("protected paths need auth", () => {
    expect(needsAuth("/v1/chat/completions", config)).toBe(true);
    expect(needsAuth("/admin/users", config)).toBe(true);
  });

  it("unprotected, non-public paths don't need auth when protectedPaths is set", () => {
    expect(needsAuth("/dashboard", config)).toBe(false);
  });
});
