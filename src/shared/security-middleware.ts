import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { timingSafeEqual, createHash } from "node:crypto";

// ── Security Configuration (loaded from env) ─────────────────────────

export interface SecurityConfig {
  // Rate Limiting
  rateLimitMax: number;
  rateLimitWindowMs: number;
  rateLimitApiMax: number;
  rateLimitDashboardMax: number;
  rateLimitMetricsMax: number;
  rateLimitHealthMax: number;
  // LLMask-namespaced rate limit for /v1/* proxy routes (via @fastify/rate-limit)
  llmaskRateLimitMax: number;
  llmaskRateLimitWindowMs: number;

  // CORS
  corsOrigins: string[];
  corsMethods: string[];
  corsHeaders: string[];
  corsCredentials: boolean;

  // Input Validation
  maxPromptSize: number;
  allowedContentTypes: string[];
  bodyLimit: number;

  // CSP
  cspEnabled: boolean;

  // Admin
  adminApiKey: string;
}

export function parseSecurityConfig(env: NodeJS.ProcessEnv): SecurityConfig {
  // Rate Limiting
  const rateLimitMax = parseInt(env.RATE_LIMIT_MAX || "100", 10);
  const rateLimitWindowMs = parseInt(env.RATE_LIMIT_WINDOW_MS || "60000", 10);
  const rateLimitApiMax = parseInt(env.RATE_LIMIT_API_MAX || "100", 10);
  const rateLimitDashboardMax = parseInt(env.RATE_LIMIT_DASHBOARD_MAX || "120", 10);
  const rateLimitMetricsMax = parseInt(env.RATE_LIMIT_METRICS_MAX || "10", 10);
  const rateLimitHealthMax = parseInt(env.RATE_LIMIT_HEALTH_MAX || "60", 10);

  // LLMask-namespaced proxy rate limit (LLMASK_RATE_LIMIT reqs per LLMASK_RATE_WINDOW minutes)
  const llmaskRateLimitMax = parseInt(env.LLMASK_RATE_LIMIT || "100", 10);
  const llmaskRateLimitWindowMinutes = parseFloat(env.LLMASK_RATE_WINDOW || "1");
  const llmaskRateLimitWindowMs = Math.round(llmaskRateLimitWindowMinutes * 60 * 1000);

  // CORS — CORS_ORIGIN is the canonical env var; CORS_ORIGINS is accepted as alias
  const corsRaw = env.CORS_ORIGIN || env.CORS_ORIGINS;
  const corsOrigins = corsRaw
    ? corsRaw.split(",").map(s => s.trim()).filter(Boolean)
    : (env.NODE_ENV === "production" ? [] : ["*"]);

  const corsMethods = (env.CORS_METHODS || "GET,POST,OPTIONS")
    .split(",").map(s => s.trim()).filter(Boolean);

  const corsHeaders = env.CORS_HEADERS
    ? env.CORS_HEADERS.split(",").map(s => s.trim()).filter(Boolean)
    : ["Content-Type", "Authorization", "x-llmask-key", "anthropic-version", "x-api-key", "x-request-id"];

  const corsCredentials = env.CORS_CREDENTIALS === "true";

  // Input Validation
  const maxPromptSize = parseInt(env.MAX_PROMPT_SIZE || "102400", 10); // 100KB default
  const allowedContentTypes = env.ALLOWED_CONTENT_TYPES
    ? env.ALLOWED_CONTENT_TYPES.split(",").map(s => s.trim()).filter(Boolean)
    : ["application/json", "multipart/form-data"];
  const bodyLimit = parseInt(env.BODY_LIMIT || String(10 * 1024 * 1024), 10); // 10MB default

  // CSP
  const cspEnabled = env.CSP_ENABLED !== "false"; // enabled by default

  // Admin
  const adminApiKey = env.ADMIN_API_KEY || env.LLMASK_ADMIN_KEY || "";

  return {
    rateLimitMax,
    rateLimitWindowMs,
    rateLimitApiMax,
    rateLimitDashboardMax,
    rateLimitMetricsMax,
    rateLimitHealthMax,
    llmaskRateLimitMax,
    llmaskRateLimitWindowMs,
    corsOrigins,
    corsMethods,
    corsHeaders,
    corsCredentials,
    maxPromptSize,
    allowedContentTypes,
    bodyLimit,
    cspEnabled,
    adminApiKey,
  };
}

// ── Timing-Safe Comparison ────────────────────────────────────────────

/**
 * Constant-time string comparison to prevent timing attacks.
 * Both strings are hashed to ensure equal length before comparison.
 */
export function safeCompare(a: string, b: string): boolean {
  if (!a || !b) return false;
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

// ── TLS Hardening ─────────────────────────────────────────────────────

export interface TlsHardeningConfig {
  minVersion: "TLSv1.2" | "TLSv1.3";
  ciphers?: string;
  honorCipherOrder?: boolean;
}

/**
 * Returns hardened TLS options for use with Node's https/tls module.
 * Enforces TLS 1.2+ and strong cipher suites by default.
 */
export function getHardenedTlsOptions(config?: Partial<TlsHardeningConfig>): TlsHardeningConfig {
  return {
    minVersion: config?.minVersion ?? "TLSv1.2",
    ciphers: config?.ciphers ?? [
      "TLS_AES_256_GCM_SHA384",
      "TLS_CHACHA20_POLY1305_SHA256",
      "TLS_AES_128_GCM_SHA256",
      "ECDHE-RSA-AES256-GCM-SHA384",
      "ECDHE-RSA-AES128-GCM-SHA256",
      "ECDHE-ECDSA-AES256-GCM-SHA384",
      "ECDHE-ECDSA-AES128-GCM-SHA256",
    ].join(":"),
    honorCipherOrder: config?.honorCipherOrder ?? true,
  };
}

// ── HTTPS Redirect Middleware ─────────────────────────────────────────

/**
 * Register a hook that redirects HTTP requests to HTTPS when TLS is enabled.
 * Only active when `tlsEnabled` is true (i.e., certs are configured).
 */
export function registerHttpsRedirect(server: FastifyInstance, tlsEnabled: boolean, port: number): void {
  if (!tlsEnabled) return;

  server.addHook("onRequest", async (request, reply) => {
    const proto = request.headers["x-forwarded-proto"];
    const isHttps = proto === "https" || (request.raw.socket as any)?.encrypted;
    if (!isHttps && request.method === "GET") {
      const host = (request.headers.host || "localhost").replace(/:\d+$/, "");
      const target = `https://${host}${port !== 443 ? `:${port}` : ""}${request.url}`;
      return reply.code(301).header("location", target).send();
    }
  });
}

// ── Advanced Rate Limiting ────────────────────────────────────────────

interface RouteRateLimitConfig {
  limit: number;
  windowMs: number;
  path: string;
}

class ConfigurableRateLimiter {
  private readonly windows = new Map<string, number[]>();
  private readonly windowMs: number;

  constructor(windowMs: number) {
    this.windowMs = windowMs;
  }

  check(key: string, limit: number): { allowed: boolean; remaining: number; resetMs: number } {
    if (limit <= 0) {
      return { allowed: true, remaining: -1, resetMs: 0 };
    }

    const now = Date.now();
    const cutoff = now - this.windowMs;

    let timestamps = this.windows.get(key);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(key, timestamps);
    }

    // Remove expired entries
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= limit) {
      const resetMs = timestamps[0] + this.windowMs - now;
      return { allowed: false, remaining: 0, resetMs };
    }

    timestamps.push(now);
    return { allowed: true, remaining: limit - timestamps.length, resetMs: 0 };
  }

  cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, timestamps] of this.windows) {
      while (timestamps.length > 0 && timestamps[0] < cutoff) {
        timestamps.shift();
      }
      if (timestamps.length === 0) {
        this.windows.delete(key);
      }
    }
  }
}

export class AdvancedRateLimiter {
  private limiters = new Map<string, ConfigurableRateLimiter>();
  private routeConfigs: RouteRateLimitConfig[];

  constructor(routeConfigs: RouteRateLimitConfig[]) {
    this.routeConfigs = routeConfigs;
    for (const config of routeConfigs) {
      this.limiters.set(config.path, new ConfigurableRateLimiter(config.windowMs));
    }
  }

  /**
   * Check rate limit. Uses apiKey as key if provided, otherwise falls back to IP.
   */
  check(path: string, ip: string, apiKey?: string): { allowed: boolean; remaining: number; resetMs: number; limit: number } {
    const config = this.routeConfigs.find(c => path.startsWith(c.path));
    if (!config) {
      return { allowed: true, remaining: 999, resetMs: 0, limit: 0 };
    }

    const limiter = this.limiters.get(config.path);
    if (!limiter) {
      return { allowed: true, remaining: 999, resetMs: 0, limit: config.limit };
    }

    const key = apiKey ? `key:${apiKey}` : `ip:${ip}`;
    const result = limiter.check(key, config.limit);
    return { ...result, limit: config.limit };
  }

  cleanup(): void {
    for (const limiter of this.limiters.values()) {
      limiter.cleanup();
    }
  }
}

// ── CORS Validation ───────────────────────────────────────────────────

export function matchesOrigin(origin: string, allowedOrigins: string[]): boolean {
  if (allowedOrigins.includes("*")) return true;

  for (const allowed of allowedOrigins) {
    if (allowed.includes("*")) {
      // Wildcard matching: http://localhost:* matches http://localhost:3000
      const pattern = allowed.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      const regex = new RegExp(`^${pattern}$`);
      if (regex.test(origin)) return true;
    } else if (allowed === origin) {
      return true;
    }
  }

  return false;
}

// ── Input Validation Middleware ───────────────────────────────────────

export function validatePromptSize(maxSize: number) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const contentType = request.headers["content-type"] || "";
    if (!contentType.includes("application/json")) return;

    const body = request.body as any;
    if (!body) return;

    // Check prompt size in messages array
    if (Array.isArray(body.messages)) {
      for (const message of body.messages) {
        if (message.content) {
          const contentStr = typeof message.content === "string"
            ? message.content
            : JSON.stringify(message.content);

          if (contentStr.length > maxSize) {
            return reply.code(413).send({
              error: {
                message: `Prompt size exceeds maximum allowed size of ${maxSize} bytes`,
                type: "invalid_request_error",
                code: "PROMPT_TOO_LARGE",
              },
            });
          }
        }
      }
    }

    // Check prompt field directly (for some APIs)
    if (typeof body.prompt === "string" && body.prompt.length > maxSize) {
      return reply.code(413).send({
        error: {
          message: `Prompt size exceeds maximum allowed size of ${maxSize} bytes`,
          type: "invalid_request_error",
          code: "PROMPT_TOO_LARGE",
        },
      });
    }
  };
}

export function validateContentType(allowedTypes: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (request.method === "OPTIONS") return;
    if (request.method === "GET") return;

    const contentType = request.headers["content-type"] || "";

    // Allow missing content-type for GET/OPTIONS
    if (!contentType) {
      return reply.code(400).send({
        error: {
          message: "Content-Type header is required",
          type: "invalid_request_error",
          code: "MISSING_CONTENT_TYPE",
        },
      });
    }

    const matches = allowedTypes.some(type => contentType.includes(type));
    if (!matches) {
      return reply.code(415).send({
        error: {
          message: `Unsupported Content-Type: ${contentType}. Allowed: ${allowedTypes.join(", ")}`,
          type: "invalid_request_error",
          code: "UNSUPPORTED_CONTENT_TYPE",
        },
      });
    }
  };
}

// ── Header Sanitization ───────────────────────────────────────────────

export function sanitizeForwardedHeaders(request: FastifyRequest): void {
  // Remove potentially dangerous forwarded headers to prevent header injection
  const dangerousHeaders = [
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-forwarded-server",
    "forwarded",
  ];

  for (const header of dangerousHeaders) {
    if (request.headers[header]) {
      delete request.headers[header];
    }
  }
}

// ── Rate Limit Key Extraction ─────────────────────────────────────

export function extractRateLimitKey(request: FastifyRequest): string | undefined {
  const llmaskKey = request.headers["x-llmask-key"];
  if (llmaskKey) return Array.isArray(llmaskKey) ? llmaskKey[0] : llmaskKey;

  const apiKey = request.headers["x-api-key"];
  if (apiKey) return Array.isArray(apiKey) ? apiKey[0] : apiKey;

  const auth = request.headers.authorization;
  if (auth && typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }

  return undefined;
}

// ── Rate Limit Event Tracker (for dashboard stats) ───────────────────

interface RateLimitHit {
  count: number;
  lastHitAt: number;
  paths: Set<string>;
}

export class RateLimitTracker {
  private readonly hits = new Map<string, RateLimitHit>();

  record(key: string, path: string): void {
    let entry = this.hits.get(key);
    if (!entry) {
      entry = { count: 0, lastHitAt: 0, paths: new Set() };
      this.hits.set(key, entry);
    }
    entry.count++;
    entry.lastHitAt = Date.now();
    entry.paths.add(path);
  }

  getStats(): Array<{ key: string; count: number; lastHitAt: number; paths: string[] }> {
    return Array.from(this.hits.entries())
      .map(([key, data]) => ({
        key,
        count: data.count,
        lastHitAt: data.lastHitAt,
        paths: Array.from(data.paths),
      }))
      .sort((a, b) => b.count - a.count);
  }

  totalHits(): number {
    let total = 0;
    for (const entry of this.hits.values()) total += entry.count;
    return total;
  }

  reset(): void {
    this.hits.clear();
  }
}

// ── Register Security Middleware ──────────────────────────────────────

export function registerSecurityMiddleware(
  server: FastifyInstance,
  config: SecurityConfig,
  logger: any
): AdvancedRateLimiter {
  // ── 0. Remove Server Fingerprint ──────────────────────────────────────
  server.addHook("onSend", async (_request, reply) => {
    reply.removeHeader("server");
    reply.removeHeader("x-powered-by");
  });

  // ── 1. Enhanced Security Headers ─────────────────────────────────────
  server.addHook("onSend", async (request, reply) => {
    // Helmet-style security headers
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("x-xss-protection", "0"); // Modern: CSP replaces XSS filter
    reply.header("x-download-options", "noopen");
    reply.header("x-permitted-cross-domain-policies", "none");
    reply.header("referrer-policy", "strict-origin-when-cross-origin");
    reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    reply.header("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    reply.header("pragma", "no-cache");
    reply.header("expires", "0");

    // CSP for dashboard routes
    if (config.cspEnabled && request.url.startsWith("/dashboard")) {
      const csp = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // React needs unsafe-eval
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; ");
      reply.header("content-security-policy", csp);
    }

    reply.header("x-request-id", reply.request.id);
  });

  // ── 2. Enhanced CORS with Validation ─────────────────────────────────
  server.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;

    if (origin) {
      const allowed = matchesOrigin(origin, config.corsOrigins);
      if (allowed) {
        reply.header("access-control-allow-origin", origin);
        reply.header("access-control-allow-methods", config.corsMethods.join(", "));
        reply.header("access-control-allow-headers", config.corsHeaders.join(", "));
        reply.header("access-control-max-age", "86400");
        if (config.corsCredentials) {
          reply.header("access-control-allow-credentials", "true");
        }
      } else {
        logger.warn({ origin, allowed: config.corsOrigins }, "CORS origin rejected");
        return reply.code(403).send({
          error: {
            message: "Origin not allowed",
            type: "forbidden",
            code: "CORS_ORIGIN_REJECTED",
          },
        });
      }
    }

    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });

  // ── 3. Header Sanitization ───────────────────────────────────────────
  server.addHook("onRequest", async (request) => {
    sanitizeForwardedHeaders(request);
  });

  // ── 4. Advanced Rate Limiting (per-route) ────────────────────────────
  // Note: /v1/* proxy routes are rate-limited separately via @fastify/rate-limit
  // (see server.ts). Only system/dashboard routes are handled here.
  const rateLimiter = new AdvancedRateLimiter([
    {
      path: "/metrics",
      limit: config.rateLimitMetricsMax,
      windowMs: config.rateLimitWindowMs,
    },
    {
      path: "/health",
      limit: config.rateLimitHealthMax,
      windowMs: config.rateLimitWindowMs,
    },
    {
      path: "/dashboard",
      limit: config.rateLimitDashboardMax,
      windowMs: config.rateLimitWindowMs,
    },
  ]);

  // Cleanup old entries every minute
  setInterval(() => rateLimiter.cleanup(), 60_000);

  // ── 5. Admin Key Protection for /metrics and /admin/* ──────────────
  if (config.adminApiKey) {
    server.addHook("onRequest", async (request, reply) => {
      const needsAdmin = request.url.startsWith("/metrics") || request.url.startsWith("/admin");
      if (!needsAdmin) return;

      const headerKey = request.headers["x-admin-key"]
        || request.headers["x-llmask-key"];
      const authHeader = request.headers.authorization;
      const bearerKey = authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7) : undefined;
      const key = (Array.isArray(headerKey) ? headerKey[0] : headerKey) || bearerKey;

      if (!safeCompare(key || "", config.adminApiKey)) {
        return reply.code(401).send({
          error: { message: "Unauthorized — provide admin key via X-Admin-Key or Authorization: Bearer <key>", type: "authentication_error", code: "MISSING_ADMIN_KEY" },
        });
      }
    });
  }

  server.addHook("onRequest", async (request, reply) => {
    const ip = request.ip;
    const apiKey = extractRateLimitKey(request);
    const { allowed, remaining, resetMs, limit } = rateLimiter.check(request.url, ip, apiKey);

    if (limit > 0) {
      reply.header("x-ratelimit-limit", String(limit));
      reply.header("x-ratelimit-remaining", String(remaining));
      reply.header("x-ratelimit-reset", String(Math.ceil(Date.now() / 1000) + Math.ceil(resetMs / 1000)));
    }

    if (!allowed) {
      reply.header("retry-after", String(Math.ceil(resetMs / 1000)));
      logger.warn({ ip, path: request.url, limit }, "Rate limit exceeded");
      return reply.code(429).send({
        error: {
          message: `Rate limit exceeded. Maximum ${limit} requests per ${Math.ceil(config.rateLimitWindowMs / 1000)} seconds. Please try again later.`,
          type: "rate_limit_error",
          code: "RATE_LIMITED",
        },
      });
    }
  });

  logger.info(
    {
      apiLimit: config.rateLimitApiMax,
      dashboardLimit: config.rateLimitDashboardMax,
      windowMs: config.rateLimitWindowMs,
      corsOrigins: config.corsOrigins,
    },
    "Advanced security middleware registered"
  );

  return rateLimiter;
}
