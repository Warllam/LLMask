import { describe, it, expect, vi } from "vitest";
import { createTierGuard } from "../../src/licensing/tier-guard";

function mockRequest(url: string, method = "GET") {
  return { url, method } as any;
}

function mockReply() {
  const reply = {
    statusCode: 200,
    body: null as any,
    code(c: number) { reply.statusCode = c; return reply; },
    send(b: any) { reply.body = b; return reply; },
  };
  return reply;
}

describe("tier guard", () => {
  describe("community tier", () => {
    const guard = createTierGuard("community");

    it("allows /health", async () => {
      const reply = mockReply();
      await guard(mockRequest("/health"), reply as any);
      expect(reply.body).toBeNull();
    });

    it("allows /v1/chat/completions", async () => {
      const reply = mockReply();
      await guard(mockRequest("/v1/chat/completions", "POST"), reply as any);
      expect(reply.body).toBeNull();
    });

    it("allows /dashboard", async () => {
      const reply = mockReply();
      await guard(mockRequest("/dashboard"), reply as any);
      expect(reply.body).toBeNull();
    });

    it("allows /dashboard/api/stats", async () => {
      const reply = mockReply();
      await guard(mockRequest("/dashboard/api/stats"), reply as any);
      expect(reply.body).toBeNull();
    });

    it("allows /dashboard/api/config", async () => {
      const reply = mockReply();
      await guard(mockRequest("/dashboard/api/config"), reply as any);
      expect(reply.body).toBeNull();
    });

    it("blocks /dashboard/api/sessions (pro)", async () => {
      const reply = mockReply();
      await guard(mockRequest("/dashboard/api/sessions"), reply as any);
      expect(reply.statusCode).toBe(403);
      expect(reply.body.error.code).toBe("TIER_REQUIRED");
      expect(reply.body.error.requiredTier).toBe("pro");
    });

    it("blocks /dashboard/api/dsi/stats (pro)", async () => {
      const reply = mockReply();
      await guard(mockRequest("/dashboard/api/dsi/stats"), reply as any);
      expect(reply.statusCode).toBe(403);
      expect(reply.body.error.requiredTier).toBe("pro");
    });

    it("blocks /v1/files/anonymize POST (pro)", async () => {
      const reply = mockReply();
      await guard(mockRequest("/v1/files/anonymize", "POST"), reply as any);
      expect(reply.statusCode).toBe(403);
      expect(reply.body.error.requiredTier).toBe("pro");
    });

    it("blocks /admin/tenants (enterprise)", async () => {
      const reply = mockReply();
      await guard(mockRequest("/admin/tenants"), reply as any);
      expect(reply.statusCode).toBe(403);
      expect(reply.body.error.requiredTier).toBe("enterprise");
    });

    it("blocks /metrics (enterprise)", async () => {
      const reply = mockReply();
      await guard(mockRequest("/metrics"), reply as any);
      expect(reply.statusCode).toBe(403);
      expect(reply.body.error.requiredTier).toBe("enterprise");
    });
  });

  describe("pro tier", () => {
    const guard = createTierGuard("pro");

    it("allows /dashboard/api/sessions", async () => {
      const reply = mockReply();
      await guard(mockRequest("/dashboard/api/sessions"), reply as any);
      expect(reply.body).toBeNull();
    });

    it("allows /v1/files/anonymize POST", async () => {
      const reply = mockReply();
      await guard(mockRequest("/v1/files/anonymize", "POST"), reply as any);
      expect(reply.body).toBeNull();
    });

    it("allows /dashboard/api/dsi/stats", async () => {
      const reply = mockReply();
      await guard(mockRequest("/dashboard/api/dsi/stats"), reply as any);
      expect(reply.body).toBeNull();
    });

    it("blocks /admin/tenants (enterprise)", async () => {
      const reply = mockReply();
      await guard(mockRequest("/admin/tenants"), reply as any);
      expect(reply.statusCode).toBe(403);
      expect(reply.body.error.requiredTier).toBe("enterprise");
    });

    it("blocks /metrics (enterprise)", async () => {
      const reply = mockReply();
      await guard(mockRequest("/metrics"), reply as any);
      expect(reply.statusCode).toBe(403);
    });
  });

  describe("enterprise tier", () => {
    const guard = createTierGuard("enterprise");

    it("allows everything", async () => {
      const routes = [
        "/health",
        "/v1/chat/completions",
        "/dashboard",
        "/dashboard/api/stats",
        "/dashboard/api/sessions",
        "/dashboard/api/dsi/stats",
        "/admin/tenants",
        "/metrics",
      ];

      for (const url of routes) {
        const reply = mockReply();
        await guard(mockRequest(url), reply as any);
        expect(reply.body).toBeNull();
      }
    });
  });
});
