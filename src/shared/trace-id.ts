import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";

/**
 * Derives a stable trace/session ID for a request.
 *
 * Priority:
 * 1. Explicit `x-request-id` header from the client
 * 2. Hash of the first user message in the body — groups multi-turn
 *    conversation requests (each turn re-sends the full history, so the
 *    first user message is constant across all turns of one conversation)
 * 3. Fastify's auto-generated request ID (fallback)
 */
export function getTraceId(request: FastifyRequest): string {
  const incoming = request.headers["x-request-id"];
  if (typeof incoming === "string" && incoming.trim()) {
    return incoming;
  }

  // Try to derive a stable session ID from the first user message
  const body = request.body as Record<string, unknown> | undefined;
  if (body) {
    const firstUserContent = extractFirstUserMessage(body);
    if (firstUserContent) {
      const hash = createHash("sha256").update(firstUserContent).digest("hex").slice(0, 12);
      return `sess-${hash}`;
    }
  }

  return request.id;
}

function extractFirstUserMessage(body: Record<string, unknown>): string | null {
  // Chat Completions API: body.messages
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (msg && typeof msg === "object" && (msg as Record<string, unknown>).role === "user") {
        return extractContent(msg as Record<string, unknown>);
      }
    }
  }

  // Responses API: body.input
  if (Array.isArray(body.input)) {
    for (const item of body.input) {
      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        if (obj.role === "user" || (obj.type === "message" && obj.role === "user")) {
          return extractContent(obj);
        }
      }
    }
  }

  return null;
}

function extractContent(msg: Record<string, unknown>): string | null {
  const content = msg.content;
  if (typeof content === "string" && content.trim()) {
    return content.slice(0, 200); // Use first 200 chars for hashing
  }
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === "object") {
        const text = (block as Record<string, unknown>).text;
        if (typeof text === "string" && text.trim()) {
          return text.slice(0, 200);
        }
      }
    }
  }
  return null;
}
