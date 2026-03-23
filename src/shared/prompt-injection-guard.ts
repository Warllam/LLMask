/**
 * Prompt Injection Guard — detects and blocks common prompt injection patterns.
 *
 * Configurable via env vars:
 *   PROMPT_INJECTION_GUARD=true|false (default: true)
 *   PROMPT_INJECTION_MODE=block|warn (default: warn)
 *   PROMPT_INJECTION_CUSTOM_PATTERNS=pattern1,pattern2 (optional)
 */

import type { FastifyRequest, FastifyReply } from "fastify";

export interface PromptInjectionConfig {
  enabled: boolean;
  mode: "block" | "warn";
  customPatterns: RegExp[];
}

// Common prompt injection patterns
const INJECTION_PATTERNS: { name: string; pattern: RegExp; severity: "high" | "medium" | "low" }[] = [
  // Direct instruction override
  { name: "ignore_instructions", pattern: /ignore\s+(all\s+)?(previous|above|prior|earlier)\s+(instructions?|prompts?|rules?|directives?)/i, severity: "high" },
  { name: "disregard_instructions", pattern: /disregard\s+(all\s+)?(previous|above|prior|earlier)\s+(instructions?|prompts?|rules?|directives?)/i, severity: "high" },
  { name: "forget_instructions", pattern: /forget\s+(all\s+)?(previous|above|prior|earlier)\s+(instructions?|prompts?|rules?|directives?)/i, severity: "high" },

  // System prompt extraction
  { name: "reveal_system_prompt", pattern: /(?:reveal|show|display|print|output|repeat|echo)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions|rules|directives)/i, severity: "high" },
  { name: "what_is_system_prompt", pattern: /what\s+(?:is|are)\s+your\s+(?:system\s+)?(?:prompt|instructions|rules|initial\s+instructions)/i, severity: "medium" },

  // Role-playing attacks
  { name: "pretend_jailbreak", pattern: /(?:pretend|act\s+as\s+if|imagine)\s+(?:you\s+(?:are|have)\s+)?(?:no\s+(?:restrictions|limitations|rules|guidelines)|unrestricted|unfiltered|uncensored)/i, severity: "high" },
  { name: "dan_jailbreak", pattern: /\b(?:DAN|do\s+anything\s+now)\b/i, severity: "high" },

  // Delimiter injection (trying to break out of user content)
  { name: "delimiter_injection", pattern: /(?:```|<\/?system>|<\/?assistant>|<\/?user>|\[SYSTEM\]|\[INST\]|<<SYS>>|<\|im_start\|>)/i, severity: "medium" },

  // Encoding evasion
  { name: "base64_injection", pattern: /(?:decode|interpret|execute|eval)\s+(?:this\s+)?base64/i, severity: "medium" },

  // Multi-step manipulation
  { name: "new_conversation", pattern: /(?:start|begin)\s+(?:a\s+)?new\s+conversation\s+(?:where|in\s+which)/i, severity: "medium" },
  { name: "override_safety", pattern: /(?:override|bypass|disable|turn\s+off|deactivate)\s+(?:your\s+)?(?:(?:safety|content)\s+)?(?:filters?|guidelines?|restrictions?|protections?)/i, severity: "high" },
];

export function parsePromptInjectionConfig(env: NodeJS.ProcessEnv): PromptInjectionConfig {
  const enabled = env.PROMPT_INJECTION_GUARD !== "false"; // enabled by default
  const mode = env.PROMPT_INJECTION_MODE === "block" ? "block" : "warn";
  const customPatterns: RegExp[] = [];

  if (env.PROMPT_INJECTION_CUSTOM_PATTERNS) {
    for (const p of env.PROMPT_INJECTION_CUSTOM_PATTERNS.split(",")) {
      const trimmed = p.trim();
      if (trimmed) {
        try {
          customPatterns.push(new RegExp(trimmed, "i"));
        } catch {
          // Skip invalid patterns
        }
      }
    }
  }

  return { enabled, mode, customPatterns };
}

export interface InjectionCheckResult {
  detected: boolean;
  matches: { name: string; severity: string; snippet: string }[];
}

export function checkPromptInjection(
  text: string,
  config: PromptInjectionConfig
): InjectionCheckResult {
  if (!config.enabled || !text) {
    return { detected: false, matches: [] };
  }

  const matches: InjectionCheckResult["matches"] = [];

  for (const { name, pattern, severity } of INJECTION_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      const start = Math.max(0, match.index - 20);
      const end = Math.min(text.length, match.index + match[0].length + 20);
      matches.push({
        name,
        severity,
        snippet: text.slice(start, end).replace(/\n/g, " "),
      });
    }
  }

  for (const pattern of config.customPatterns) {
    const match = pattern.exec(text);
    if (match) {
      matches.push({
        name: "custom_pattern",
        severity: "medium",
        snippet: match[0].slice(0, 60),
      });
    }
  }

  return { detected: matches.length > 0, matches };
}

/**
 * Extract all text content from a request body for injection scanning.
 */
function extractTextFromBody(body: any): string {
  if (!body) return "";

  const parts: string[] = [];

  // OpenAI / Anthropic messages array
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (typeof msg.content === "string") {
        parts.push(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (typeof block === "string") parts.push(block);
          else if (block?.text) parts.push(block.text);
          else if (block?.type === "text" && block?.text) parts.push(block.text);
        }
      }
    }
  }

  // Direct prompt field
  if (typeof body.prompt === "string") {
    parts.push(body.prompt);
  }

  // Anthropic system field
  if (typeof body.system === "string") {
    parts.push(body.system);
  }

  // OpenAI Responses API input
  if (typeof body.input === "string") {
    parts.push(body.input);
  } else if (Array.isArray(body.input)) {
    for (const item of body.input) {
      if (typeof item === "string") parts.push(item);
      else if (item?.content) {
        if (typeof item.content === "string") parts.push(item.content);
        else if (Array.isArray(item.content)) {
          for (const block of item.content) {
            if (typeof block === "string") parts.push(block);
            else if (block?.text) parts.push(block.text);
          }
        }
      }
    }
  }

  return parts.join("\n");
}

/**
 * Fastify preHandler that checks for prompt injection.
 */
export function createPromptInjectionGuard(config: PromptInjectionConfig, logger: any) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!config.enabled) return;

    const contentType = request.headers["content-type"] || "";
    if (!contentType.includes("application/json")) return;

    const text = extractTextFromBody(request.body);
    if (!text) return;

    const result = checkPromptInjection(text, config);

    if (result.detected) {
      const highSeverity = result.matches.some(m => m.severity === "high");

      logger.warn(
        {
          ip: request.ip,
          path: request.url,
          matches: result.matches.map(m => ({ name: m.name, severity: m.severity })),
          mode: config.mode,
        },
        "Prompt injection pattern detected"
      );

      if (config.mode === "block" && highSeverity) {
        return reply.code(400).send({
          error: {
            message: "Request blocked: prompt injection pattern detected",
            type: "invalid_request_error",
            code: "PROMPT_INJECTION_DETECTED",
            patterns: result.matches.map(m => m.name),
          },
        });
      }

      // In warn mode or medium/low severity in block mode, add header and continue
      reply.header("x-llmask-injection-warning", result.matches.map(m => m.name).join(","));
    }
  };
}
