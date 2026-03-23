import { PassThrough, Transform } from "node:stream";
import type {
  EndpointKind,
  ProviderAdapter,
  ProviderAdapterResult,
  ProviderConfig
} from "./types";
import { AnthropicOAuthTokenStore } from "./anthropic-oauth-token-store";

const CLAUDE_MODEL_RE = /^claude[-\s]/i;
const ANTHROPIC_PREFIX_RE = /^anthropic\//i;

const OAUTH_BETA_HEADERS = [
  "claude-code-20250219",
  "oauth-2025-04-20",
  "fine-grained-tool-streaming-2025-05-14",
  "interleaved-thinking-2025-05-14",
];

/**
 * LiteLLM adapter — routes requests to a LiteLLM proxy server.
 *
 * LiteLLM exposes an OpenAI-compatible API, so for chat-completions
 * this is essentially a pass-through. For the Anthropic messages endpoint,
 * a minimal translation to chat/completions format is applied.
 *
 * When Anthropic OAuth is configured, the adapter injects a fresh token
 * via LiteLLM's `api_key` and `extra_headers` body fields so LiteLLM
 * forwards them to Anthropic (without confusing them with proxy auth).
 */
export class LiteLlmAdapter implements ProviderAdapter {
  readonly type = "litellm" as const;
  private readonly oauthTokenStore: AnthropicOAuthTokenStore | null;

  constructor(private readonly config: ProviderConfig) {
    this.oauthTokenStore =
      config.anthropicAuthMode === "oauth_claude_code"
        ? new AnthropicOAuthTokenStore(config.anthropicOauthTokenPath)
        : null;
  }

  async prepareRequest(
    endpointKind: EndpointKind,
    body: unknown,
    incomingAuthHeader?: string,
    incomingHeaders?: Record<string, string>
  ): Promise<ProviderAdapterResult> {
    const url = new URL("/v1/chat/completions", this.config.baseUrl).toString();

    const headers: Record<string, string> = {
      "content-type": "application/json"
    };

    // Always auth to LiteLLM with the configured proxy key (master key)
    if (this.config.apiKey) {
      headers["authorization"] = `Bearer ${this.config.apiKey}`;
    } else if (incomingAuthHeader) {
      headers["authorization"] = incomingAuthHeader.startsWith("Bearer ")
        ? incomingAuthHeader
        : `Bearer ${incomingAuthHeader}`;
    }

    // Forward custom headers to LiteLLM
    if (incomingHeaders) {
      const headersToForward = [
        "x-litellm-api-key",
        "x-api-key",
        "anthropic-version",
        "openai-organization",
        "openai-project"
      ];
      for (const key of headersToForward) {
        if (incomingHeaders[key]) {
          headers[key] = incomingHeaders[key];
        }
      }
    }

    let outgoingBody: unknown;

    if (endpointKind === "messages") {
      outgoingBody = translateAnthropicToChatCompletions(body);
    } else if (endpointKind === "responses") {
      outgoingBody = translateResponsesToChatCompletions(body);
    } else {
      outgoingBody = body;
    }

    // For Claude models with OAuth: inject token via LiteLLM's body-level overrides
    // (Authorization header is reserved for LiteLLM proxy auth)
    const modelName = isRecord(outgoingBody) ? String((outgoingBody as Record<string, unknown>).model ?? "") : "";
    const isClaudeModel = CLAUDE_MODEL_RE.test(modelName) || ANTHROPIC_PREFIX_RE.test(modelName);

    if (isClaudeModel && this.oauthTokenStore) {
      const { accessToken } = await this.oauthTokenStore.getAuthToken();
      const rec = outgoingBody as Record<string, unknown>;
      // Pass OAuth token + beta headers via extra_headers (forwarded to Anthropic by LiteLLM).
      // OAuth tokens MUST use Authorization: Bearer (not x-api-key), so we don't use api_key body field.
      rec.extra_headers = {
        "authorization": `Bearer ${accessToken}`,
        "anthropic-beta": OAUTH_BETA_HEADERS.join(","),
        "anthropic-version": this.config.anthropicVersion ?? "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      };
    }

    return { url, headers, body: outgoingBody };
  }

  translateJsonResponse(raw: unknown, _originalEndpointKind: EndpointKind): unknown {
    return raw;
  }

  createSseTranslationTransform(_originalEndpointKind: EndpointKind): Transform {
    return new PassThrough();
  }
}

// ── Minimal format translators ────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Translate an Anthropic /v1/messages request body to OpenAI chat/completions format.
 */
function translateAnthropicToChatCompletions(body: unknown): unknown {
  if (!isRecord(body)) return body;

  const messages: Array<{ role: string; content: unknown }> = [];

  if (typeof body.system === "string" && body.system) {
    messages.push({ role: "system", content: body.system });
  }

  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (!isRecord(msg)) continue;
      messages.push({
        role: String(msg.role ?? "user"),
        content: msg.content
      });
    }
  }

  return {
    model: body.model,
    messages,
    stream: body.stream ?? false,
    ...(body.max_tokens != null ? { max_tokens: body.max_tokens } : {}),
    ...(body.temperature != null ? { temperature: body.temperature } : {}),
    ...(body.top_p != null ? { top_p: body.top_p } : {})
  };
}

/**
 * Translate an OpenAI Responses API request body to chat/completions format.
 */
function translateResponsesToChatCompletions(body: unknown): unknown {
  if (!isRecord(body)) return body;

  const messages: Array<{ role: string; content: unknown }> = [];

  if (typeof body.instructions === "string" && body.instructions) {
    messages.push({ role: "system", content: body.instructions });
  }

  if (Array.isArray(body.input)) {
    for (const item of body.input) {
      if (typeof item === "string") {
        messages.push({ role: "user", content: item });
      } else if (isRecord(item) && item.role && item.content) {
        messages.push({
          role: String(item.role),
          content: item.content
        });
      }
    }
  } else if (typeof body.input === "string") {
    messages.push({ role: "user", content: body.input });
  }

  return {
    model: body.model,
    messages,
    stream: body.stream ?? false,
    ...(body.max_output_tokens != null ? { max_tokens: body.max_output_tokens } : {}),
    ...(body.temperature != null ? { temperature: body.temperature } : {}),
    ...(body.top_p != null ? { top_p: body.top_p } : {})
  };
}
