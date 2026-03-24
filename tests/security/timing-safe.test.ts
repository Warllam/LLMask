import { describe, it, expect } from "vitest";
import { safeCompare, getHardenedTlsOptions } from "../../src/shared/security-middleware";

describe("safeCompare (timing-safe string comparison)", () => {
  it("returns true for identical strings", () => {
    expect(safeCompare("secret-key-123", "secret-key-123")).toBe(true);
  });

  it("returns false for different strings", () => {
    expect(safeCompare("secret-key-123", "secret-key-456")).toBe(false);
  });

  it("returns false for empty first argument", () => {
    expect(safeCompare("", "secret")).toBe(false);
  });

  it("returns false for empty second argument", () => {
    expect(safeCompare("secret", "")).toBe(false);
  });

  it("returns false for both empty", () => {
    expect(safeCompare("", "")).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(safeCompare("short", "a-much-longer-string")).toBe(false);
  });

  it("handles unicode strings", () => {
    expect(safeCompare("clé-secrète-🔑", "clé-secrète-🔑")).toBe(true);
    expect(safeCompare("clé-secrète-🔑", "clé-secrète-🔒")).toBe(false);
  });

  it("timing consistency: both match and mismatch take similar time", () => {
    // This is a sanity check, not a rigorous timing test.
    // The real protection is that we use SHA-256 + timingSafeEqual.
    const key = "a".repeat(1000);
    const wrong = "b".repeat(1000);

    const iterations = 1000;
    const startMatch = performance.now();
    for (let i = 0; i < iterations; i++) safeCompare(key, key);
    const matchTime = performance.now() - startMatch;

    const startMismatch = performance.now();
    for (let i = 0; i < iterations; i++) safeCompare(key, wrong);
    const mismatchTime = performance.now() - startMismatch;

    // They should be within 5x of each other (very generous — mainly checking
    // that mismatch doesn't short-circuit to near-zero)
    const ratio = Math.max(matchTime, mismatchTime) / Math.max(Math.min(matchTime, mismatchTime), 0.01);
    expect(ratio).toBeLessThan(5);
  });
});

describe("getHardenedTlsOptions", () => {
  it("returns defaults with TLS 1.2 minimum", () => {
    const opts = getHardenedTlsOptions();
    expect(opts.minVersion).toBe("TLSv1.2");
    expect(opts.honorCipherOrder).toBe(true);
    expect(opts.ciphers).toContain("TLS_AES_256_GCM_SHA384");
    expect(opts.ciphers).toContain("ECDHE-RSA-AES256-GCM-SHA384");
  });

  it("allows overriding minVersion to TLS 1.3", () => {
    const opts = getHardenedTlsOptions({ minVersion: "TLSv1.3" });
    expect(opts.minVersion).toBe("TLSv1.3");
  });

  it("allows custom ciphers", () => {
    const opts = getHardenedTlsOptions({ ciphers: "TLS_AES_128_GCM_SHA256" });
    expect(opts.ciphers).toBe("TLS_AES_128_GCM_SHA256");
  });

  it("excludes weak ciphers from defaults", () => {
    const opts = getHardenedTlsOptions();
    expect(opts.ciphers).not.toContain("RC4");
    expect(opts.ciphers).not.toContain("DES");
    expect(opts.ciphers).not.toContain("MD5");
    expect(opts.ciphers).not.toContain("NULL");
  });
});
