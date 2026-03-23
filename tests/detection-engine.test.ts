import { describe, it, expect } from "vitest";
import { DetectionEngine } from "../../src/modules/detection/detection-engine";

describe("DetectionEngine", () => {
  const engine = new DetectionEngine();

  describe("detect - no secrets", () => {
    it("returns empty findings for clean payload", () => {
      const result = engine.detect({ messages: [{ role: "user", content: "Hello world" }] });
      expect(result.findings).toHaveLength(0);
    });

    it("returns empty findings for empty object", () => {
      const result = engine.detect({});
      expect(result.findings).toHaveLength(0);
    });
  });

  describe("detect - AWS secrets", () => {
    it("detects AWS Access Key ID", () => {
      const result = engine.detect({ key: "AKIAIOSFODNN7EXAMPLE" });
      expect(result.findings.length).toBeGreaterThanOrEqual(1);
      expect(result.findings.some(f => f.category === "secret.cloud.aws")).toBe(true);
      expect(result.findings.some(f => f.severity === "high")).toBe(true);
    });

    it("detects AWS Secret Access Key in assignment", () => {
      // JSON.stringify escapes double quotes → use no-quote format that survives serialization
      const result = engine.detect({
        config: "SecretAccessKey=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEYab"
      });
      expect(result.findings.some(f => f.category === "secret.cloud.aws")).toBe(true);
    });
  });

  describe("detect - GitHub tokens", () => {
    it("detects GitHub PAT", () => {
      const result = engine.detect({ token: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl" });
      expect(result.findings.some(f => f.category === "secret.code_hosting.github")).toBe(true);
      expect(result.findings.some(f => f.severity === "high")).toBe(true);
    });

    it("detects GitHub OAuth token", () => {
      const result = engine.detect({ token: "gho_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl" });
      expect(result.findings.some(f => f.category === "secret.code_hosting.github")).toBe(true);
    });
  });

  describe("detect - OpenAI keys", () => {
    it("detects OpenAI API key", () => {
      const result = engine.detect({ apiKey: "sk-abcdefghijklmnopqrstuvwxyz" });
      expect(result.findings.some(f => f.category === "secret.ai.openai")).toBe(true);
    });
  });

  describe("detect - Stripe keys", () => {
    it("detects Stripe live secret key", () => {
      const result = engine.detect({ key: "sk_live_" + "abcdefghijklmnopqrstuvwxyz1234" });
      expect(result.findings.some(f => f.category === "secret.payment.stripe")).toBe(true);
    });

    it("detects Stripe test secret key", () => {
      const result = engine.detect({ key: "sk_test_abcdefghijklmnopqrstuvwxyz1234" });
      expect(result.findings.some(f => f.category === "secret.payment.stripe")).toBe(true);
    });
  });

  describe("detect - Database connection strings", () => {
    it("detects PostgreSQL connection string", () => {
      const result = engine.detect({ url: "postgres://admin:secret123@db.example.com:5432/mydb" });
      expect(result.findings.some(f => f.category === "secret.database.connection_string")).toBe(true);
    });

    it("detects MongoDB connection string", () => {
      const result = engine.detect({ url: "mongodb://user:pass@mongo.example.com:27017/app" });
      expect(result.findings.some(f => f.category === "secret.database.connection_string")).toBe(true);
    });
  });

  describe("detect - Private keys", () => {
    it("detects RSA private key header", () => {
      const result = engine.detect({ pem: "-----BEGIN RSA PRIVATE KEY-----\nMIIE..." });
      expect(result.findings.some(f => f.category === "secret.crypto.private_key")).toBe(true);
    });
  });

  describe("detect - JWT tokens", () => {
    it("detects JWT token", () => {
      const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      const result = engine.detect({ token: jwt });
      expect(result.findings.some(f => f.category === "secret.auth.jwt")).toBe(true);
    });
  });

  describe("detect - Slack tokens", () => {
    it("detects Slack bot token", () => {
      const result = engine.detect({ token: "xoxb-123456789012-1234567890123-abcdef" });
      expect(result.findings.some(f => f.category === "secret.communication.slack")).toBe(true);
    });
  });

  describe("detect - high entropy in assignment context", () => {
    it("detects high-entropy password in assignment context", () => {
      // JSON.stringify escapes double quotes → use single quotes that survive serialization
      const result = engine.detect({ code: "password='xK9f3mQ7pZ2wL8nRaB5cD4eF6gH'" });
      expect(result.findings.some(f => f.category === "secret.generic.high_entropy")).toBe(true);
    });

    it("does not flag low-entropy assignments", () => {
      const result = engine.detect({ code: 'password="12345678"' });
      const highEntropy = result.findings.filter(f => f.category === "secret.generic.high_entropy");
      expect(highEntropy).toHaveLength(0);
    });
  });

  describe("detect - Azure", () => {
    it("detects Azure connection string", () => {
      const result = engine.detect({
        conn: "DefaultEndpointsProtocol=https;AccountName=myaccount;AccountKey=abc123def456ghi789"
      });
      expect(result.findings.some(f => f.category === "secret.cloud.azure")).toBe(true);
    });
  });

  describe("detect - GCP", () => {
    it("detects GCP API key", () => {
      // Regex: AIza[0-9A-Za-z_-]{35} — needs exactly 39 total chars (4 + 35)
      const result = engine.detect({ key: "AIzaSyB12345678901234567890123456789012" });
      expect(result.findings.some(f => f.category === "secret.cloud.gcp")).toBe(true);
    });
  });

  describe("detect - deduplication", () => {
    it("does not report the same match preview twice", () => {
      const result = engine.detect({
        key1: "AKIAIOSFODNN7EXAMPLE",
        key2: "AKIAIOSFODNN7EXAMPLE"
      });
      const awsFindings = result.findings.filter(f => f.category === "secret.cloud.aws");
      expect(awsFindings.length).toBe(1);
    });
  });
});
