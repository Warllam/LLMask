/**
 * Security Headers — Helmet-style security headers for Fastify.
 * Content-Security-Policy, X-Content-Type-Options, X-Frame-Options, HSTS.
 */
import type { FastifyInstance, FastifyReply } from "fastify";

export interface SecurityHeadersConfig {
  /** Enable Content-Security-Policy */
  cspEnabled: boolean;
  /** Custom CSP directives (overrides defaults) */
  cspDirectives?: Record<string, string>;
  /** HSTS max-age in seconds (default 1 year) */
  hstsMaxAge?: number;
  /** Include subdomains in HSTS */
  hstsIncludeSubDomains?: boolean;
  /** HSTS preload */
  hstsPreload?: boolean;
  /** X-Frame-Options value */
  frameOptions?: "DENY" | "SAMEORIGIN";
  /** Referrer-Policy value */
  referrerPolicy?: string;
  /** Paths that get CSP (default: all if cspEnabled) */
  cspPaths?: string[];
}

const DEFAULT_CSP_DIRECTIVES: Record<string, string> = {
  "default-src": "'self'",
  "script-src": "'self'",
  "style-src": "'self' 'unsafe-inline'",
  "img-src": "'self' data: https:",
  "font-src": "'self' data:",
  "connect-src": "'self'",
  "frame-ancestors": "'none'",
  "base-uri": "'self'",
  "form-action": "'self'",
  "object-src": "'none'",
};

/**
 * Build a CSP header string from directives.
 */
export function buildCsp(directives: Record<string, string>): string {
  return Object.entries(directives)
    .map(([key, value]) => `${key} ${value}`)
    .join("; ");
}

/**
 * Apply security headers to a reply.
 */
export function applySecurityHeaders(reply: FastifyReply, config: SecurityHeadersConfig, url: string): void {
  // X-Content-Type-Options
  reply.header("X-Content-Type-Options", "nosniff");

  // X-Frame-Options
  reply.header("X-Frame-Options", config.frameOptions ?? "DENY");

  // X-XSS-Protection (disabled — CSP replaces it)
  reply.header("X-XSS-Protection", "0");

  // X-Download-Options
  reply.header("X-Download-Options", "noopen");

  // X-Permitted-Cross-Domain-Policies
  reply.header("X-Permitted-Cross-Domain-Policies", "none");

  // Referrer-Policy
  reply.header("Referrer-Policy", config.referrerPolicy ?? "strict-origin-when-cross-origin");

  // HSTS
  const maxAge = config.hstsMaxAge ?? 31536000;
  let hsts = `max-age=${maxAge}`;
  if (config.hstsIncludeSubDomains !== false) hsts += "; includeSubDomains";
  if (config.hstsPreload) hsts += "; preload";
  reply.header("Strict-Transport-Security", hsts);

  // Cache-Control (API responses should not be cached)
  reply.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  reply.header("Pragma", "no-cache");
  reply.header("Expires", "0");

  // CSP
  if (config.cspEnabled) {
    const shouldApplyCsp = !config.cspPaths || config.cspPaths.some(p => url.startsWith(p));
    if (shouldApplyCsp) {
      const directives = { ...DEFAULT_CSP_DIRECTIVES, ...config.cspDirectives };
      reply.header("Content-Security-Policy", buildCsp(directives));
    }
  }
}

/**
 * Register security headers as Fastify onSend hook.
 */
export function registerSecurityHeaders(server: FastifyInstance, config: SecurityHeadersConfig): void {
  server.addHook("onSend", async (request, reply) => {
    applySecurityHeaders(reply, config, request.url);
  });
}
