/**
 * Advanced Rate Limiter — Fastify middleware with sliding window,
 * per-IP and per-API-key limits, X-RateLimit-* headers, 429 responses.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createHash } from "crypto";

export interface RateLimitConfig {
  /** Max requests per window (global default) */
  max: number;
  /** Window size in ms */
  windowMs: number;
  /** Per-route overrides: path prefix → max */
  routeLimits?: Record<string, number>;
  /** Per-API-key multiplier (authenticated users get limit * this) */
  apiKeyMultiplier?: number;
  /** Custom key extractor */
  keyExtractor?: (request: FastifyRequest) => string;
}

interface WindowEntry {
  timestamps: number[];
}

export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, WindowEntry>();
  private readonly windowMs: number;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(windowMs: number) {
    this.windowMs = windowMs;
  }

  check(key: string, limit: number): { allowed: boolean; remaining: number; resetMs: number } {
    if (limit <= 0) return { allowed: true, remaining: Infinity, resetMs: 0 };

    const now = Date.now();
    const cutoff = now - this.windowMs;

    let entry = this.buckets.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.buckets.set(key, entry);
    }

    // Prune expired
    while (entry.timestamps.length > 0 && entry.timestamps[0] < cutoff) {
      entry.timestamps.shift();
    }

    if (entry.timestamps.length >= limit) {
      const resetMs = entry.timestamps[0] + this.windowMs - now;
      return { allowed: false, remaining: 0, resetMs };
    }

    entry.timestamps.push(now);
    return { allowed: true, remaining: limit - entry.timestamps.length, resetMs: this.windowMs };
  }

  cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, entry] of this.buckets) {
      while (entry.timestamps.length > 0 && entry.timestamps[0] < cutoff) {
        entry.timestamps.shift();
      }
      if (entry.timestamps.length === 0) this.buckets.delete(key);
    }
  }

  startAutoCleanup(intervalMs = 60_000): void {
    this.cleanupTimer = setInterval(() => this.cleanup(), intervalMs);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  stopAutoCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}

/** Hash an API key for use as bucket key (privacy) */
export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/** Extract rate-limit key from request (API key or IP) */
export function extractKey(request: FastifyRequest): { key: string; isApiKey: boolean } {
  const llmaskKey = request.headers["x-llmask-key"];
  const k = Array.isArray(llmaskKey) ? llmaskKey[0] : llmaskKey;
  if (k) return { key: `apikey:${hashKey(k)}`, isApiKey: true };

  const apiKey = request.headers["x-api-key"];
  const a = Array.isArray(apiKey) ? apiKey[0] : apiKey;
  if (a) return { key: `apikey:${hashKey(a)}`, isApiKey: true };

  const auth = request.headers.authorization;
  if (auth && typeof auth === "string" && auth.startsWith("Bearer ")) {
    return { key: `apikey:${hashKey(auth.slice(7))}`, isApiKey: true };
  }

  return { key: `ip:${request.ip}`, isApiKey: false };
}

/** Resolve the limit for a given path */
export function resolveLimit(path: string, routeLimits: Record<string, number>, defaultMax: number): number {
  for (const [prefix, limit] of Object.entries(routeLimits)) {
    if (path.startsWith(prefix)) return limit;
  }
  return defaultMax;
}

/**
 * Register rate limiting as a Fastify hook.
 */
export function registerRateLimiter(server: FastifyInstance, config: RateLimitConfig, logger?: any): SlidingWindowRateLimiter {
  const limiter = new SlidingWindowRateLimiter(config.windowMs);
  limiter.startAutoCleanup();

  const routeLimits = config.routeLimits ?? {};
  const multiplier = config.apiKeyMultiplier ?? 1;

  server.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const { key, isApiKey } = config.keyExtractor
      ? { key: config.keyExtractor(request), isApiKey: false }
      : extractKey(request);

    let limit = resolveLimit(request.url, routeLimits, config.max);
    if (isApiKey && multiplier > 1) limit = Math.ceil(limit * multiplier);

    const { allowed, remaining, resetMs } = limiter.check(key, limit);
    const resetEpoch = Math.ceil((Date.now() + resetMs) / 1000);

    reply.header("X-RateLimit-Limit", String(limit));
    reply.header("X-RateLimit-Remaining", String(Math.max(0, remaining)));
    reply.header("X-RateLimit-Reset", String(resetEpoch));

    if (!allowed) {
      const retryAfter = Math.ceil(resetMs / 1000);
      reply.header("Retry-After", String(retryAfter));
      if (logger) logger.warn({ key, path: request.url, limit }, "Rate limit exceeded");
      return reply.code(429).send({
        error: {
          message: `Rate limit exceeded. Maximum ${limit} requests per ${Math.ceil(config.windowMs / 1000)}s. Retry after ${retryAfter}s.`,
          type: "rate_limit_error",
          code: "RATE_LIMITED",
        },
      });
    }
  });

  return limiter;
}
