/**
 * Input Validation — Zod-based validation for proxy endpoints.
 * Max body size, allowed models, content sanitization.
 */
import { z } from "zod";
import type { FastifyRequest, FastifyReply } from "fastify";

// ── Allowed Models ────────────────────────────────────────────────────

const DEFAULT_ALLOWED_MODELS = [
  // OpenAI
  "gpt-4", "gpt-4-turbo", "gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano",
  "gpt-3.5-turbo", "o1", "o1-mini", "o1-preview", "o3", "o3-mini", "o4-mini",
  // Anthropic
  "claude-3-opus-20240229", "claude-3-sonnet-20240229", "claude-3-haiku-20240307",
  "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022",
  "claude-sonnet-4-20250514", "claude-opus-4-20250514",
  // Gemini
  "gemini-pro", "gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash",
  // Mistral
  "mistral-large-latest", "mistral-small-latest", "codestral-latest",
];

// ── Schemas ───────────────────────────────────────────────────────────

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool", "function"]),
  content: z.union([z.string(), z.array(z.any()), z.null()]).optional(),
  name: z.string().max(256).optional(),
  tool_calls: z.array(z.any()).optional(),
  tool_call_id: z.string().optional(),
}).passthrough();

export function createChatCompletionSchema(opts: {
  maxPromptSize: number;
  allowedModels?: string[];
  allowAnyModel?: boolean;
}) {
  const modelValidator = opts.allowAnyModel
    ? z.string().min(1).max(256)
    : z.string().refine(
        (m) => (opts.allowedModels ?? DEFAULT_ALLOWED_MODELS).some(
          allowed => m === allowed || m.startsWith(allowed + "-") || m.startsWith(allowed + ":")
        ),
        { message: "Model not allowed" }
      );

  return z.object({
    model: modelValidator,
    messages: z.array(messageSchema).min(1).max(1000),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().positive().max(1_000_000).optional(),
    stream: z.boolean().optional(),
    top_p: z.number().min(0).max(1).optional(),
    frequency_penalty: z.number().min(-2).max(2).optional(),
    presence_penalty: z.number().min(-2).max(2).optional(),
    stop: z.union([z.string(), z.array(z.string().max(256)).max(16)]).optional(),
    tools: z.array(z.any()).optional(),
    tool_choice: z.any().optional(),
    response_format: z.any().optional(),
    user: z.string().max(256).optional(),
  }).passthrough();
}

// ── Sanitization ──────────────────────────────────────────────────────

/** Strip null bytes and control characters (except newlines/tabs) */
export function sanitizeString(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

/** Deep-sanitize all string values in an object */
export function sanitizeBody(body: unknown): unknown {
  if (typeof body === "string") return sanitizeString(body);
  if (Array.isArray(body)) return body.map(sanitizeBody);
  if (body && typeof body === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      result[sanitizeString(key)] = sanitizeBody(value);
    }
    return result;
  }
  return body;
}

// ── Middleware Factories ──────────────────────────────────────────────

export interface InputValidationConfig {
  maxPromptSize: number;
  maxBodySize: number;
  allowedModels?: string[];
  allowAnyModel?: boolean;
  allowedContentTypes: string[];
}

/**
 * Validate Content-Type header.
 */
export function validateContentType(allowedTypes: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (request.method === "GET" || request.method === "OPTIONS" || request.method === "HEAD") return;

    const contentType = request.headers["content-type"] || "";
    if (!contentType) {
      return reply.code(400).send({
        error: { message: "Content-Type header is required", type: "invalid_request_error", code: "MISSING_CONTENT_TYPE" },
      });
    }

    if (!allowedTypes.some(t => contentType.includes(t))) {
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

/**
 * Validate body size.
 */
export function validateBodySize(maxBytes: number) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const contentLength = parseInt(request.headers["content-length"] || "0", 10);
    if (contentLength > maxBytes) {
      return reply.code(413).send({
        error: {
          message: `Request body too large. Maximum: ${maxBytes} bytes`,
          type: "invalid_request_error",
          code: "BODY_TOO_LARGE",
        },
      });
    }
  };
}

/**
 * Validate prompt size within messages.
 */
export function validatePromptSize(maxSize: number) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const ct = request.headers["content-type"] || "";
    if (!ct.includes("application/json")) return;

    const body = request.body as any;
    if (!body) return;

    const checkContent = (content: unknown): boolean => {
      const str = typeof content === "string" ? content : JSON.stringify(content);
      return str.length <= maxSize;
    };

    if (Array.isArray(body.messages)) {
      for (const msg of body.messages) {
        if (msg.content && !checkContent(msg.content)) {
          return reply.code(413).send({
            error: {
              message: `Prompt content exceeds maximum size of ${maxSize} bytes`,
              type: "invalid_request_error",
              code: "PROMPT_TOO_LARGE",
            },
          });
        }
      }
    }

    if (typeof body.prompt === "string" && body.prompt.length > maxSize) {
      return reply.code(413).send({
        error: {
          message: `Prompt exceeds maximum size of ${maxSize} bytes`,
          type: "invalid_request_error",
          code: "PROMPT_TOO_LARGE",
        },
      });
    }
  };
}

/**
 * Validate chat completion request body with Zod.
 */
export function validateChatCompletion(config: InputValidationConfig) {
  const schema = createChatCompletionSchema({
    maxPromptSize: config.maxPromptSize,
    allowedModels: config.allowedModels,
    allowAnyModel: config.allowAnyModel,
  });

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const ct = request.headers["content-type"] || "";
    if (!ct.includes("application/json")) return;

    const body = request.body;
    if (!body) return;

    // Sanitize first
    const sanitized = sanitizeBody(body);
    (request as any).body = sanitized;

    const result = schema.safeParse(sanitized);
    if (!result.success) {
      const issues = result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
      return reply.code(400).send({
        error: {
          message: `Invalid request body: ${issues}`,
          type: "invalid_request_error",
          code: "VALIDATION_ERROR",
        },
      });
    }
  };
}
