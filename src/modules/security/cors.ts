/**
 * CORS — Strict, configurable CORS middleware for Fastify.
 * Configured via env vars: CORS_ORIGIN, CORS_METHODS, CORS_CREDENTIALS.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

export interface CorsConfig {
  /** Comma-separated allowed origins (supports wildcard patterns like http://localhost:*) */
  origins: string[];
  /** Allowed HTTP methods */
  methods: string[];
  /** Allowed headers */
  headers: string[];
  /** Allow credentials */
  credentials: boolean;
  /** Preflight cache max-age in seconds */
  maxAge?: number;
  /** Exposed headers */
  exposedHeaders?: string[];
}

/**
 * Parse CORS config from environment variables.
 */
export function parseCorsConfig(env: NodeJS.ProcessEnv): CorsConfig {
  const originRaw = env.CORS_ORIGIN || env.CORS_ORIGINS || "";
  const origins = originRaw
    ? originRaw.split(",").map(s => s.trim()).filter(Boolean)
    : (env.NODE_ENV === "production" ? [] : ["*"]);

  const methods = (env.CORS_METHODS || "GET,POST,OPTIONS")
    .split(",").map(s => s.trim()).filter(Boolean);

  const headers = (env.CORS_HEADERS || "Content-Type,Authorization,x-llmask-key,x-api-key,x-request-id")
    .split(",").map(s => s.trim()).filter(Boolean);

  const credentials = env.CORS_CREDENTIALS === "true";

  return { origins, methods, headers, credentials, maxAge: 86400 };
}

/**
 * Check if an origin matches the allowed origins list.
 * Supports exact match, wildcard "*", and glob patterns (e.g. http://localhost:*).
 */
export function matchesOrigin(origin: string, allowedOrigins: string[]): boolean {
  if (allowedOrigins.length === 0) return false;
  if (allowedOrigins.includes("*")) return true;

  for (const allowed of allowedOrigins) {
    if (allowed === origin) return true;
    if (allowed.includes("*")) {
      const pattern = allowed
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");
      if (new RegExp(`^${pattern}$`).test(origin)) return true;
    }
  }
  return false;
}

/**
 * Register CORS hooks on a Fastify instance.
 */
export function registerCors(server: FastifyInstance, config: CorsConfig, logger?: any): void {
  server.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const origin = request.headers.origin;

    if (origin) {
      if (matchesOrigin(origin, config.origins)) {
        reply.header("Access-Control-Allow-Origin", origin);
        reply.header("Access-Control-Allow-Methods", config.methods.join(", "));
        reply.header("Access-Control-Allow-Headers", config.headers.join(", "));
        if (config.maxAge) reply.header("Access-Control-Max-Age", String(config.maxAge));
        if (config.credentials) reply.header("Access-Control-Allow-Credentials", "true");
        if (config.exposedHeaders?.length) {
          reply.header("Access-Control-Expose-Headers", config.exposedHeaders.join(", "));
        }
      } else {
        if (logger) logger.warn({ origin, allowed: config.origins }, "CORS origin rejected");
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
}
