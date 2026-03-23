import { Transform } from "node:stream";
import type {
  EndpointKind,
  ProviderAdapter,
  ProviderAdapterResult,
  ProviderConfig
} from "./types";
import { AnthropicOAuthTokenStore } from "./anthropic-oauth-token-store";

export class AnthropicAdapter implements ProviderAdapter {
  readonly type = "anthropic" as const;
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
    _incomingHeaders?: Record<string, string>
  ): Promise<ProviderAdapterResult> {
    const url = new URL("/v1/messages", this.config.baseUrl).toString();

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "anthropic-version": this.config.anthropicVersion ?? "2023-06-01"
    };

    // Priority order:
    // 1) incoming client auth (pass-through)
    // 2) configured OAuth token store
    // 3) API key
    let isOAuthToken = false;
    if (incomingAuthHeader) {
      if (incomingAuthHeader.toLowerCase().startsWith("bearer ")) {
        headers["authorization"] = incomingAuthHeader;
        isOAuthToken = incomingAuthHeader.includes("sk-ant-oat");
      } else {
        headers["x-api-key"] = incomingAuthHeader;
      }
    } else if (this.oauthTokenStore) {
      const { accessToken } = await this.oauthTokenStore.getAuthToken();
      headers["authorization"] = `Bearer ${accessToken}`;
      isOAuthToken = true;
    } else {
      headers["x-api-key"] = this.config.apiKey;
    }

    // OAuth tokens require specific beta headers (as OpenClaw does)
    if (isOAuthToken) {
      const oauthBetas = [
        "claude-code-20250219",
        "oauth-2025-04-20",
        "fine-grained-tool-streaming-2025-05-14",
        "interleaved-thinking-2025-05-14",
      ];
      const existing = headers["anthropic-beta"] ? headers["anthropic-beta"].split(",").map(s => s.trim()) : [];
      const merged = [...new Set([...oauthBetas, ...existing])];
      headers["anthropic-beta"] = merged.join(",");
      headers["anthropic-dangerous-direct-browser-access"] = "true";
    }

    // "messages" endpoint: body is already in Anthropic format, no translation needed
    if (endpointKind === "messages") {
      return { url, headers, body };
    }

    const translatedBody =
      endpointKind === "responses"
        ? translateResponsesApiToAnthropic(body)
        : translateChatCompletionsToAnthropic(body);

    return { url, headers, body: translatedBody };
  }

  translateJsonResponse(raw: unknown, originalEndpointKind: EndpointKind): unknown {
    // "messages" endpoint: response is already in Anthropic format, no translation
    if (originalEndpointKind === "messages") {
      return raw;
    }
    return translateAnthropicResponseToOpenAi(raw);
  }

  createSseTranslationTransform(originalEndpointKind: EndpointKind): Transform {
    // "messages" endpoint: SSE is already in Anthropic format, pass through
    if (originalEndpointKind === "messages") {
      return new Transform({
        transform(chunk, _encoding, callback) { callback(null, chunk); }
      });
    }
    return createAnthropicToOpenAiSseTransform();
  }
}

// ---------------------------------------------------------------------------
// Request translation: OpenAI chat/completions → Anthropic /v1/messages
// ---------------------------------------------------------------------------

function translateChatCompletionsToAnthropic(body: unknown): unknown {
  const input = body as Record<string, unknown>;
  const messages = (input.messages ?? []) as Array<Record<string, unknown>>;

  const systemParts: string[] = [];
  const anthropicMessages: Array<{ role: string; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      if (typeof msg.content === "string") {
        systemParts.push(msg.content);
      }
      continue;
    }

    anthropicMessages.push({
      role: msg.role === "assistant" ? "assistant" : "user",
      content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
    });
  }

  const result: Record<string, unknown> = {
    model: input.model,
    messages: anthropicMessages,
    max_tokens: (input.max_tokens as number) ?? 4096
  };

  if (systemParts.length > 0) {
    result.system = systemParts.join("\n\n");
  }

  if (input.stream !== undefined) {
    result.stream = input.stream;
  }

  if (input.temperature !== undefined) {
    result.temperature = input.temperature;
  }

  if (input.top_p !== undefined) {
    result.top_p = input.top_p;
  }

  if (input.stop !== undefined) {
    result.stop_sequences = Array.isArray(input.stop) ? input.stop : [input.stop];
  }

  return result;
}

// ---------------------------------------------------------------------------
// Request translation: OpenAI Responses API → Anthropic /v1/messages
// ---------------------------------------------------------------------------

function translateResponsesApiToAnthropic(body: unknown): unknown {
  const input = body as Record<string, unknown>;

  const messages: Array<{ role: string; content: string }> = [];
  const systemParts: string[] = [];

  if (input.instructions && typeof input.instructions === "string") {
    systemParts.push(input.instructions);
  }

  const rawInput = input.input;
  if (typeof rawInput === "string") {
    messages.push({ role: "user", content: rawInput });
  } else if (Array.isArray(rawInput)) {
    for (const item of rawInput) {
      if (typeof item === "string") {
        messages.push({ role: "user", content: item });
      } else if (item && typeof item === "object") {
        const entry = item as Record<string, unknown>;
        const role = entry.role === "assistant" ? "assistant" : "user";
        const content =
          typeof entry.content === "string"
            ? entry.content
            : JSON.stringify(entry.content ?? "");
        messages.push({ role, content });
      }
    }
  }

  if (messages.length === 0) {
    messages.push({ role: "user", content: "" });
  }

  const result: Record<string, unknown> = {
    model: input.model,
    messages,
    max_tokens: (input.max_tokens as number) ?? 4096
  };

  if (systemParts.length > 0) {
    result.system = systemParts.join("\n\n");
  }

  if (input.stream !== undefined) {
    result.stream = input.stream;
  }

  if (input.temperature !== undefined) {
    result.temperature = input.temperature;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Response translation: Anthropic → OpenAI format (JSON)
// ---------------------------------------------------------------------------

function translateAnthropicResponseToOpenAi(raw: unknown): unknown {
  const response = raw as Record<string, unknown>;

  if (response.error) {
    return {
      error: {
        message:
          (response.error as Record<string, unknown>)?.message ?? "Anthropic error",
        type: (response.error as Record<string, unknown>)?.type ?? "api_error",
        code: "ANTHROPIC_ERROR"
      }
    };
  }

  const contentBlocks = (response.content ?? []) as Array<Record<string, unknown>>;
  const textParts = contentBlocks
    .filter((block) => block.type === "text")
    .map((block) => block.text as string);
  const content = textParts.join("");

  const usage = response.usage as Record<string, number> | undefined;
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;

  return {
    id: response.id ?? `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: response.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content
        },
        finish_reason: mapStopReason(response.stop_reason as string | undefined)
      }
    ],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens
    }
  };
}

function mapStopReason(
  stopReason: string | undefined
): "stop" | "length" | null {
  if (!stopReason) return null;
  if (stopReason === "max_tokens") return "length";
  return "stop";
}

// ---------------------------------------------------------------------------
// SSE translation: Anthropic streaming → OpenAI streaming format
// ---------------------------------------------------------------------------

function createAnthropicToOpenAiSseTransform(): Transform {
  let messageId = "";
  let model = "";
  let buffer = "";

  return new Transform({
    transform(chunk, _encoding, callback) {
      buffer += chunk.toString("utf8");

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      let output = "";

      for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.startsWith("event:")) {
          continue;
        }

        if (!trimmed.startsWith("data:")) {
          continue;
        }

        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr || jsonStr === "[DONE]") {
          continue;
        }

        let data: Record<string, unknown>;
        try {
          data = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        const eventType = data.type as string | undefined;

        if (eventType === "message_start") {
          const message = data.message as Record<string, unknown> | undefined;
          if (message) {
            messageId = (message.id as string) ?? `chatcmpl-${Date.now()}`;
            model = (message.model as string) ?? "";
          }
          output += formatOpenAiChunk(messageId, model, { role: "assistant" }, null);
          continue;
        }

        if (eventType === "content_block_delta") {
          const delta = data.delta as Record<string, unknown> | undefined;
          if (delta?.type === "text_delta" && typeof delta.text === "string") {
            output += formatOpenAiChunk(
              messageId,
              model,
              { content: delta.text },
              null
            );
          }
          continue;
        }

        if (eventType === "message_delta") {
          const delta = data.delta as Record<string, unknown> | undefined;
          const stopReason = delta?.stop_reason as string | undefined;
          if (stopReason) {
            output += formatOpenAiChunk(
              messageId,
              model,
              {},
              mapStopReason(stopReason)
            );
          }
          continue;
        }

        if (eventType === "message_stop") {
          output += "data: [DONE]\n\n";
          continue;
        }
      }

      callback(null, output || undefined);
    },

    flush(callback) {
      if (buffer.trim()) {
        callback(null, undefined);
      } else {
        callback();
      }
    }
  });
}

function formatOpenAiChunk(
  id: string,
  model: string,
  delta: Record<string, unknown>,
  finishReason: string | null
): string {
  const chunk = {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason
      }
    ]
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}
