import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPairSync, createPrivateKey, sign } from "node:crypto";
import { validateLicense, setPublicKeyForTesting, resetPublicKey, tierAtLeast } from "../../src/licensing/license";

// Generate a test key pair
const { publicKey: testPublicPem, privateKey: testPrivatePem } = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

function createTestJwt(payload: Record<string, unknown>): string {
  const header = { alg: "EdDSA", typ: "JWT" };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = Buffer.from(`${headerB64}.${payloadB64}`);
  const key = createPrivateKey(testPrivatePem);
  const signature = sign(null, data, key);
  return `${headerB64}.${payloadB64}.${signature.toString("base64url")}`;
}

describe("license validation", () => {
  beforeAll(() => {
    setPublicKeyForTesting(testPublicPem);
  });

  afterAll(() => {
    resetPublicKey();
  });

  it("returns community tier when no license provided", () => {
    const info = validateLicense({});
    expect(info.tier).toBe("community");
    expect(info.valid).toBe(true);
  });

  it("returns community tier for empty license key", () => {
    const info = validateLicense({ licenseKey: "" });
    expect(info.tier).toBe("community");
    expect(info.valid).toBe(true);
  });

  it("validates a pro license", () => {
    const jwt = createTestJwt({
      sub: "test-license-1",
      tier: "pro",
      org: "Test Corp",
      exp: Math.floor(Date.now() / 1000) + 86400,
    });

    const info = validateLicense({ licenseKey: jwt });
    expect(info.tier).toBe("pro");
    expect(info.valid).toBe(true);
    expect(info.org).toBe("Test Corp");
    expect(info.licenseId).toBe("test-license-1");
  });

  it("validates an enterprise license", () => {
    const jwt = createTestJwt({
      sub: "test-license-2",
      tier: "enterprise",
      org: "Big Corp",
      exp: Math.floor(Date.now() / 1000) + 86400,
    });

    const info = validateLicense({ licenseKey: jwt });
    expect(info.tier).toBe("enterprise");
    expect(info.valid).toBe(true);
    expect(info.org).toBe("Big Corp");
  });

  it("falls back to community for expired license", () => {
    const jwt = createTestJwt({
      sub: "expired-license",
      tier: "pro",
      org: "Expired Corp",
      exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
    });

    const info = validateLicense({ licenseKey: jwt });
    expect(info.tier).toBe("community");
    expect(info.valid).toBe(false);
    expect(info.reason).toContain("expired");
  });

  it("falls back to community for invalid signature", () => {
    const jwt = createTestJwt({
      sub: "test",
      tier: "pro",
      exp: Math.floor(Date.now() / 1000) + 86400,
    });

    // Tamper with the payload
    const parts = jwt.split(".");
    parts[1] = Buffer.from('{"tier":"enterprise","exp":9999999999}').toString("base64url");
    const tampered = parts.join(".");

    const info = validateLicense({ licenseKey: tampered });
    expect(info.tier).toBe("community");
    expect(info.valid).toBe(false);
    expect(info.reason).toContain("Invalid");
  });

  it("falls back to community for malformed JWT", () => {
    const info = validateLicense({ licenseKey: "not-a-jwt" });
    expect(info.tier).toBe("community");
    expect(info.valid).toBe(false);
  });

  it("falls back to community for unknown tier", () => {
    const jwt = createTestJwt({
      sub: "test",
      tier: "platinum",
      exp: Math.floor(Date.now() / 1000) + 86400,
    });

    const info = validateLicense({ licenseKey: jwt });
    expect(info.tier).toBe("community");
    expect(info.valid).toBe(false);
    expect(info.reason).toContain("Unknown tier");
  });
});

describe("tierAtLeast", () => {
  it("community meets community", () => {
    expect(tierAtLeast("community", "community")).toBe(true);
  });

  it("community does not meet pro", () => {
    expect(tierAtLeast("community", "pro")).toBe(false);
  });

  it("pro meets pro", () => {
    expect(tierAtLeast("pro", "pro")).toBe(true);
  });

  it("pro does not meet enterprise", () => {
    expect(tierAtLeast("pro", "enterprise")).toBe(false);
  });

  it("enterprise meets everything", () => {
    expect(tierAtLeast("enterprise", "community")).toBe(true);
    expect(tierAtLeast("enterprise", "pro")).toBe(true);
    expect(tierAtLeast("enterprise", "enterprise")).toBe(true);
  });
});
