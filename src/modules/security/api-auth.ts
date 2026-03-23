/**
 * API Key Authentication — SHA-256 hashed key verification with rotation support.
 */
import { createHash, timingSafeEqual } from "crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

export interface ApiKeyEntry {
  /** SHA-256 hash of the API key */
  hash: string;
  /** Human-readable label */
  label?: string;
  /** Expiry timestamp (ms since epoch). 0 = no expiry */
  expiresAt?: number;
  /** Scopes/permissions */
  scopes?: string[];
  /** Is this key revoked? */
  revoked?: boolean;
}

export interface ApiAuthConfig {
  /** Enable API key authentication */
  enabled: boolean;
  /** List of valid API key entries (hashed) */
  keys: ApiKeyEntry[];
  /** Paths that require authentication (prefix match). Empty = all paths */
  protectedPaths?: string[];
  /** Paths excluded from auth (e.g. /health) */
  publicPaths?: string[];
  /** Header name to look for API key */
  headerName?: string;
}

/**
 * Hash an API key with SHA-256.
 */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Constant-time comparison of two hex hashes.
 */
export function compareHashes(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/**
 * Verify an API key against the key store.
 * Returns the matching entry or null.
 */
export function verifyApiKey(rawKey: string, keys: ApiKeyEntry[]): ApiKeyEntry | null {
  const hash = hashApiKey(rawKey);
  const now = Date.now();

  for (const entry of keys) {
    if (entry.revoked) continue;
    if (entry.expiresAt && entry.expiresAt > 0 && entry.expiresAt < now) continue;
    if (compareHashes(hash, entry.hash)) return entry;
  }
  return null;
}

/**
 * Extract API key from request headers.
 */
export function extractApiKey(request: FastifyRequest, headerName: string = "x-api-key"): string | null {
  // Check custom header
  const custom = request.headers[headerName.toLowerCase()];
  const customVal = Array.isArray(custom) ? custom[0] : custom;
  if (customVal) return customVal;

  // Check x-llmask-key
  const llmask = request.headers["x-llmask-key"];
  const llmaskVal = Array.isArray(llmask) ? llmask[0] : llmask;
  if (llmaskVal) return llmaskVal;

  // Check Authorization: Bearer
  const auth = request.headers.authorization;
  if (auth && typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }

  return null;
}

/**
 * Check if a path needs authentication.
 */
export function needsAuth(path: string, config: ApiAuthConfig): boolean {
  // Public paths are always exempt
  if (config.publicPaths?.some(p => path.startsWith(p))) return false;

  // If protectedPaths defined, only those need auth
  if (config.protectedPaths && config.protectedPaths.length > 0) {
    return config.protectedPaths.some(p => path.startsWith(p));
  }

  // Default: all paths need auth
  return true;
}

/**
 * Create an ApiAuthConfig from environment variables.
 * Keys are provided as comma-separated SHA-256 hashes in LLMASK_API_KEYS env var.
 * Or a single key in LLMASK_ADMIN_KEY (will be hashed).
 */
export function parseApiAuthConfig(env: NodeJS.ProcessEnv): ApiAuthConfig {
  const enabled = env.LLMASK_AUTH_ENABLED === "true";

  const keys: ApiKeyEntry[] = [];

  // Hashed keys from env (already SHA-256 hashed)
  const hashedKeys = env.LLMASK_API_KEY_HASHES;
  if (hashedKeys) {
    for (const h of hashedKeys.split(",").map(s => s.trim()).filter(Boolean)) {
      const [hash, label] = h.split(":", 2);
      keys.push({ hash, label: label || "env-key" });
    }
  }

  // Admin key (raw, will be hashed)
  const adminKey = env.LLMASK_ADMIN_KEY || env.ADMIN_API_KEY;
  if (adminKey) {
    keys.push({ hash: hashApiKey(adminKey), label: "admin", scopes: ["admin", "api"] });
  }

  const publicPaths = (env.AUTH_PUBLIC_PATHS || "/health,/ready")
    .split(",").map(s => s.trim()).filter(Boolean);

  const protectedPaths = env.AUTH_PROTECTED_PATHS
    ? env.AUTH_PROTECTED_PATHS.split(",").map(s => s.trim()).filter(Boolean)
    : [];

  return { enabled, keys, publicPaths, protectedPaths, headerName: env.AUTH_HEADER_NAME || "x-api-key" };
}

/**
 * Register API key authentication middleware on Fastify.
 */
export function registerApiAuth(server: FastifyInstance, config: ApiAuthConfig, logger?: any): void {
  if (!config.enabled) return;

  server.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!needsAuth(request.url, config)) return;

    const rawKey = extractApiKey(request, config.headerName);
    if (!rawKey) {
      return reply.code(401).send({
        error: {
          message: "API key required. Provide via X-API-Key header or Authorization: Bearer <key>",
          type: "authentication_error",
          code: "MISSING_API_KEY",
        },
      });
    }

    const entry = verifyApiKey(rawKey, config.keys);
    if (!entry) {
      if (logger) logger.warn({ path: request.url }, "Invalid API key attempt");
      return reply.code(401).send({
        error: {
          message: "Invalid or expired API key",
          type: "authentication_error",
          code: "INVALID_API_KEY",
        },
      });
    }

    // Attach auth info to request for downstream use
    (request as any).apiKeyEntry = entry;
  });
}
