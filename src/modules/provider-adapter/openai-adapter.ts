import { PassThrough, Transform } from "node:stream";
import type {
  EndpointKind,
  ProviderAdapter,
  ProviderAdapterResult,
  ProviderConfig
} from "./types";
import { OpenAiOAuthTokenStore } from "./openai-oauth-token-store";
import { contentBlocksToResponsesFormat } from "../../shared/content-utils";

const ENDPOINT_PATHS: Record<EndpointKind, string> = {
  "chat-completions": "/v1/chat/completions",
  responses: "/v1/responses",
  messages: "/v1/messages"
};
const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";

export class OpenAiAdapter implements ProviderAdapter {
  readonly type = "openai" as const;
  private readonly oauthTokenStore: OpenAiOAuthTokenStore | null;

  constructor(private readonly config: ProviderConfig) {
    this.oauthTokenStore =
      config.openaiAuthMode === "oauth_codex" && config.openaiOauthTokenPath
        ? new OpenAiOAuthTokenStore(config.openaiOauthTokenPath)
        : null;
  }

  /** True when OAuth is active and we must bridge chat-completions through the responses API. */
  private get oauthBridge(): boolean {
    return this.oauthTokenStore !== null;
  }

  async prepareRequest(
    endpointKind: EndpointKind,
    body: unknown,
    incomingAuthHeader?: string,
    _incomingHeaders?: Record<string, string>
  ): Promise<ProviderAdapterResult> {
    // In OAuth mode, ALL requests go through the Codex responses endpoint.
    const effectiveKind: EndpointKind = this.oauthBridge ? "responses" : endpointKind;

    const url = this.resolveUrl(effectiveKind);
    const headers = await this.resolveHeaders(effectiveKind, incomingAuthHeader);

    let outgoingBody: unknown;
    if (this.oauthBridge && endpointKind === "chat-completions") {
      // Convert chat/completions format → responses format; Codex API requires stream: true
      outgoingBody = chatCompletionsToResponsesBody(body);
      if (isRecord(outgoingBody)) {
        (outgoingBody as Record<string, unknown>).stream = true;
      }
    } else if (this.oauthBridge && endpointKind === "responses") {
      outgoingBody = normalizeCodexResponsesBody(body);
    } else if (endpointKind === "responses") {
      // Public Responses API: max_tokens → max_output_tokens
      outgoingBody = body;
      if (isRecord(outgoingBody)) {
        const rec = outgoingBody as Record<string, unknown>;
        if ("max_tokens" in rec) {
          const { max_tokens, ...rest } = rec;
          outgoingBody = { ...rest, max_output_tokens: max_tokens };
        }
      }
    } else {
      // chat-completions (non-OAuth): pass through as-is (max_tokens is valid)
      outgoingBody = body;
    }

    // Sanitize the outgoing body for the public OpenAI API.
    // Clients like Codex CLI may send internal/proprietary fields that the
    // public API does not accept (e.g. "reasoning.idn_*" in include,
    // unknown properties on input items like "phase").
    if (isRecord(outgoingBody)) {
      outgoingBody = sanitizeResponsesBody(outgoingBody as Record<string, unknown>);
    }

    return { url, headers, body: outgoingBody };
  }

  translateJsonResponse(raw: unknown, originalEndpointKind: EndpointKind): unknown {
    if (this.oauthBridge && originalEndpointKind === "chat-completions") {
      return responsesJsonToChatCompletions(raw);
    }
    return raw;
  }

  createSseTranslationTransform(originalEndpointKind: EndpointKind): Transform {
    if (this.oauthBridge && originalEndpointKind === "chat-completions") {
      return createResponsesSseToChatCompletionsSseTransform();
    }
    return new PassThrough();
  }

  private resolveUrl(effectiveKind: EndpointKind): string {
    if (effectiveKind === "responses" && this.oauthTokenStore) {
      return resolveCodexResponsesUrl(this.config.baseUrl);
    }
    const path = ENDPOINT_PATHS[effectiveKind];
    return new URL(path, this.config.baseUrl).toString();
  }

  private async resolveHeaders(
    effectiveKind: EndpointKind,
    incomingAuthHeader?: string
  ): Promise<Record<string, string>> {
    if (this.oauthTokenStore) {
      const { accessToken, accountId } = await this.oauthTokenStore.getAuthToken();

      if (effectiveKind === "responses") {
        if (!accountId) {
          throw new Error("OpenAI OAuth token is missing chatgpt_account_id");
        }
        return {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
          "ChatGPT-Account-Id": accountId,
          originator: "opencode",
          "User-Agent": `opencode/0.1.0 (${process.platform}; ${process.arch})`
        };
      }

      return {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`
      };
    }

    const authHeader = incomingAuthHeader ?? (await this.resolveApiKeyAuthHeader());
    return {
      "content-type": "application/json",
      authorization: authHeader
    };
  }

  private async resolveApiKeyAuthHeader(): Promise<string> {
    if (this.oauthTokenStore) {
      const { accessToken } = await this.oauthTokenStore.getAuthToken();
      return `Bearer ${accessToken}`;
    }
    if (!this.config.apiKey) {
      throw new Error("OpenAI provider is configured without API key or OAuth token store");
    }
    return `Bearer ${this.config.apiKey}`;
  }
}

// ---------------------------------------------------------------------------
// Bridge: chat/completions request → responses request
// ---------------------------------------------------------------------------

function chatCompletionsToResponsesBody(body: unknown): unknown {
  const input = isRecord(body) ? body : {};
  const messages = (input.messages ?? []) as Array<Record<string, unknown>>;

  const systemParts: string[] = [];
  const inputItems: Array<Record<string, unknown>> = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      if (typeof msg.content === "string") {
        systemParts.push(msg.content);
      }
      continue;
    }

    const role = msg.role === "assistant" ? "assistant" : "user";
    inputItems.push({
      role,
      content: contentBlocksToResponsesFormat(msg.content, role)
    });
  }

  if (inputItems.length === 0) {
    inputItems.push({ role: "user", content: [{ type: "input_text", text: "" }] });
  }

  const result: Record<string, unknown> = {
    model: input.model,
    input: inputItems,
    store: false
  };

  if (systemParts.length > 0) {
    result.instructions = systemParts.join("\n\n");
  } else {
    result.instructions = "You are a helpful assistant.";
  }

  if (input.stream !== undefined) result.stream = input.stream;
  if (input.temperature !== undefined) result.temperature = input.temperature;
  if (input.top_p !== undefined) result.top_p = input.top_p;

  // Note: max_tokens / max_output_tokens intentionally NOT forwarded here.
  // This bridge targets the Codex backend which rejects both parameters.

  // Convert chat/completions tools → responses tools
  if (Array.isArray(input.tools) && input.tools.length > 0) {
    result.tools = (input.tools as Array<Record<string, unknown>>).map(convertChatToolToResponsesTool);
  }
  if (input.tool_choice !== undefined) result.tool_choice = input.tool_choice;
  if (input.parallel_tool_calls !== undefined) result.parallel_tool_calls = input.parallel_tool_calls;

  // Forward reasoning config (o-series / gpt-5 / codex models)
  if (input.reasoning !== undefined) result.reasoning = input.reasoning;
  if (input.reasoning_effort !== undefined) {
    result.reasoning = { ...(isRecord(result.reasoning) ? result.reasoning : {}), effort: input.reasoning_effort };
  }

  // Forward truncation, include, metadata, previous_response_id
  if (input.truncation !== undefined) result.truncation = input.truncation;
  if (Array.isArray(input.include)) result.include = input.include;
  if (input.metadata !== undefined) result.metadata = input.metadata;
  if (input.previous_response_id !== undefined) result.previous_response_id = input.previous_response_id;
  if (input.service_tier !== undefined) result.service_tier = input.service_tier;

  return result;
}

/**
 * Convert a chat/completions tool definition to responses API format.
 * Chat format: {type: "function", function: {name, description, parameters, strict}}
 * Responses format: {type: "function", name, description, parameters, strict}
 */
function convertChatToolToResponsesTool(tool: Record<string, unknown>): Record<string, unknown> {
  if (tool.type === "function" && isRecord(tool.function)) {
    const fn = tool.function as Record<string, unknown>;
    return { type: "function", ...fn };
  }
  // Non-function tools (web_search, code_interpreter, etc.) — pass through as-is
  return tool;
}

// ---------------------------------------------------------------------------
// Bridge: responses JSON response → chat/completions JSON response
// ---------------------------------------------------------------------------

function responsesJsonToChatCompletions(raw: unknown): unknown {
  const response = isRecord(raw) ? raw : {};

  if (response.error) {
    return { error: response.error };
  }

  const output = Array.isArray(response.output) ? response.output : [];
  const textParts: string[] = [];
  const toolCalls: Array<Record<string, unknown>> = [];
  let toolCallIndex = 0;

  for (const item of output) {
    if (!isRecord(item)) continue;

    // Text output
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const block of item.content) {
        if (isRecord(block) && block.type === "output_text" && typeof block.text === "string") {
          textParts.push(block.text);
        }
      }
    }

    // Function call output → convert to chat/completions tool_calls
    if (item.type === "function_call") {
      toolCalls.push({
        id: item.call_id ?? `call_${Date.now()}_${toolCallIndex}`,
        type: "function",
        function: {
          name: item.name,
          arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? "")
        }
      });
      toolCallIndex++;
    }
  }

  const content = textParts.join("") || null;
  const usage = isRecord(response.usage) ? response.usage : {};
  const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
  const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;

  const message: Record<string, unknown> = { role: "assistant", content };
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }

  return {
    id: response.id ?? `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: response.model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop"
      }
    ],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens
    }
  };
}

// ---------------------------------------------------------------------------
// Bridge: responses SSE stream → chat/completions SSE stream
// ---------------------------------------------------------------------------

function createResponsesSseToChatCompletionsSseTransform(): Transform {
  let messageId = "";
  let model = "";
  let buffer = "";
  let toolCallIndex = -1;
  // Track active tool calls by output_index
  const toolCalls = new Map<number, { name: string; callId: string; index: number }>();

  return new Transform({
    transform(chunk, _encoding, callback) {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      let out = "";

      for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.startsWith("event:")) continue;
        if (!trimmed.startsWith("data:")) continue;

        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;

        let data: Record<string, unknown>;
        try {
          data = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        const eventType = data.type as string | undefined;

        if (eventType === "response.created") {
          const resp = isRecord(data.response) ? data.response : {};
          messageId = (typeof resp.id === "string" ? resp.id : "") || `chatcmpl-${Date.now()}`;
          model = (typeof resp.model === "string" ? resp.model : "") || "";
          out += formatChatCompletionChunk(messageId, model, { role: "assistant" }, null);
          continue;
        }

        // Text delta
        if (eventType === "response.output_text.delta") {
          const delta = typeof data.delta === "string" ? data.delta : "";
          if (delta) {
            out += formatChatCompletionChunk(messageId, model, { content: delta }, null);
          }
          continue;
        }

        // Function call started — emit tool_calls chunk with function name
        if (eventType === "response.output_item.added") {
          const item = isRecord(data.item) ? data.item : {};
          if (item.type === "function_call") {
            toolCallIndex++;
            const outputIndex = typeof data.output_index === "number" ? data.output_index : toolCallIndex;
            const name = typeof item.name === "string" ? item.name : "";
            const callId = typeof item.call_id === "string" ? item.call_id : `call_${Date.now()}_${toolCallIndex}`;
            toolCalls.set(outputIndex, { name, callId, index: toolCallIndex });
            out += formatChatCompletionChunk(messageId, model, {
              tool_calls: [{
                index: toolCallIndex,
                id: callId,
                type: "function",
                function: { name, arguments: "" }
              }]
            }, null);
          }
          continue;
        }

        // Function call arguments streaming
        if (eventType === "response.function_call_arguments.delta") {
          const delta = typeof data.delta === "string" ? data.delta : "";
          const outputIndex = typeof data.output_index === "number" ? data.output_index : -1;
          const tc = toolCalls.get(outputIndex);
          if (delta && tc) {
            out += formatChatCompletionChunk(messageId, model, {
              tool_calls: [{
                index: tc.index,
                function: { arguments: delta }
              }]
            }, null);
          }
          continue;
        }

        // Response completed
        if (eventType === "response.completed") {
          const finishReason = toolCalls.size > 0 ? "tool_calls" : "stop";
          out += formatChatCompletionChunk(messageId, model, {}, finishReason);
          out += "data: [DONE]\n\n";
          continue;
        }
      }

      callback(null, out || undefined);
    },

    flush(callback) {
      callback(null, buffer.trim() ? undefined : undefined);
    }
  });
}

function formatChatCompletionChunk(
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
    choices: [{ index: 0, delta, finish_reason: finishReason }]
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

// ---------------------------------------------------------------------------
// Existing helpers for native responses endpoint
// ---------------------------------------------------------------------------

function resolveCodexResponsesUrl(baseUrl: string): string {
  const raw = baseUrl && baseUrl.trim() ? baseUrl : DEFAULT_CODEX_BASE_URL;
  const normalized = raw.replace(/\/+$/, "");

  if (normalized.endsWith("/codex/responses")) return normalized;
  if (normalized.endsWith("/codex")) return `${normalized}/responses`;
  if (normalized.endsWith("/backend-api")) return `${normalized}/codex/responses`;

  if (normalized === "https://api.openai.com" || normalized === "http://api.openai.com") {
    return `${DEFAULT_CODEX_BASE_URL}/codex/responses`;
  }

  return `${normalized}/codex/responses`;
}

function normalizeCodexResponsesBody(body: unknown): unknown {
  const input = isRecord(body) ? { ...body } : {};

  const normalized: Record<string, unknown> = {
    ...input,
    store: false
  };

  // Codex backend supports max_output_tokens but not max_tokens.
  // Convert max_tokens → max_output_tokens if the client sent the wrong one.
  if ("max_tokens" in normalized && !("max_output_tokens" in normalized)) {
    normalized.max_output_tokens = normalized.max_tokens;
  }
  delete normalized.max_tokens;

  if (typeof normalized.instructions !== "string" || normalized.instructions.trim().length === 0) {
    normalized.instructions = "You are a helpful assistant.";
  }

  normalized.input = normalizeCodexInput(normalized.input);
  return normalized;
}

function normalizeCodexInput(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    const items = value
      .map((entry) => normalizeCodexInputItem(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null);
    return items.length > 0 ? items : [createUserInputItem("")];
  }
  if (typeof value === "string") return [createUserInputItem(value)];
  if (value == null) return [createUserInputItem("")];
  if (isRecord(value)) {
    const item = normalizeCodexInputItem(value);
    return item ? [item] : [createUserInputItem("")];
  }
  return [createUserInputItem(String(value))];
}

function normalizeCodexInputItem(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") return createUserInputItem(value);
  if (!isRecord(value)) return createUserInputItem(String(value));

  // Only normalize role/content for message-type items.
  // Other item types (function_call_output, item_reference, computer_call_output, etc.)
  // must be passed through as-is — they don't have a `role` field.
  const itemType = typeof value.type === "string" ? value.type : undefined;
  if (itemType && itemType !== "message") {
    return { ...value };
  }

  const role = typeof value.role === "string" ? value.role : "user";
  const content = normalizeCodexContent(value.content);
  return { ...value, role, content };
}

function normalizeCodexContent(content: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(content)) {
    const blocks = content
      .map((block) => normalizeCodexContentBlock(block))
      .filter((block): block is Record<string, unknown> => block !== null);
    return blocks.length > 0 ? blocks : [createInputTextBlock("")];
  }
  if (typeof content === "string") return [createInputTextBlock(content)];
  if (content == null) return [createInputTextBlock("")];
  if (isRecord(content)) {
    const block = normalizeCodexContentBlock(content);
    return block ? [block] : [createInputTextBlock("")];
  }
  return [createInputTextBlock(String(content))];
}

function normalizeCodexContentBlock(block: unknown): Record<string, unknown> | null {
  if (typeof block === "string") return createInputTextBlock(block);
  if (!isRecord(block)) return createInputTextBlock(String(block));
  if (typeof block.type !== "string") return createInputTextBlock(JSON.stringify(block));

  if (block.type === "input_text") {
    return { ...block, text: typeof block.text === "string" ? block.text : stringifyUnknown(block.text) };
  }
  if (block.type === "text") {
    const text = typeof block.text === "string" ? block.text : stringifyUnknown(block.text);
    return { ...block, type: "input_text", text };
  }
  return block;
}

function createUserInputItem(text: string): Record<string, unknown> {
  return { role: "user", content: [createInputTextBlock(text)] };
}

function createInputTextBlock(text: string): Record<string, unknown> {
  return { type: "input_text", text };
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? "");
  } catch {
    return String(value ?? "");
  }
}

// ---------------------------------------------------------------------------
// Sanitize outgoing Responses API body
// ---------------------------------------------------------------------------
// Codex CLI (and similar clients) may attach internal/proprietary fields that
// the public OpenAI Responses API rejects. We whitelist known properties at
// both the top-level `include` array and per input-item `type`.

const SUPPORTED_INCLUDE_VALUES = new Set([
  "file_search_call.results",
  "web_search_call.results",
  "web_search_call.action.sources",
  "message.input_image.image_url",
  "computer_call_output.output.image_url",
  "code_interpreter_call.outputs",
  "reasoning.encrypted_content",
  "message.output_text.logprobs"
]);

// Allowed properties per input item type.  Any property not listed here is
// stripped before forwarding.  `null` means "pass through everything" (we
// don't know all valid fields for that type yet).
const KNOWN_INPUT_ITEM_KEYS: Record<string, Set<string> | null> = {
  message:              new Set(["type", "role", "content", "status"]),
  function_call_output: new Set(["type", "call_id", "output", "id", "status"]),
  item_reference:       new Set(["type", "item_id", "id"]),
  computer_call_output: new Set(["type", "call_id", "output", "id", "acknowledged_safety_checks", "status"]),
  reasoning:            new Set(["type", "id", "summary", "encrypted_content", "status"]),
};

function sanitizeResponsesBody(body: Record<string, unknown>): Record<string, unknown> {
  let result = body;

  // 1. Filter `include` values
  if (Array.isArray(result.include)) {
    const filtered = (result.include as unknown[]).filter(
      (v) => typeof v === "string" && SUPPORTED_INCLUDE_VALUES.has(v)
    );
    if (filtered.length === 0) {
      const { include: _, ...rest } = result;
      result = rest;
    } else {
      result = { ...result, include: filtered };
    }
  }

  // 2. Sanitize input items — strip unknown properties per item type
  if (Array.isArray(result.input)) {
    result = { ...result, input: (result.input as unknown[]).map(sanitizeInputItem) };
  }

  return result;
}

function sanitizeInputItem(item: unknown): unknown {
  if (!isRecord(item)) return item;
  const itemType = typeof item.type === "string" ? item.type : undefined;
  if (!itemType) return item;

  const allowedKeys = KNOWN_INPUT_ITEM_KEYS[itemType];
  // null or unknown type → pass through as-is (don't break unknown future types)
  if (allowedKeys === undefined || allowedKeys === null) return item;

  const cleaned: Record<string, unknown> = {};
  for (const key of Object.keys(item)) {
    if (allowedKeys.has(key)) {
      cleaned[key] = item[key];
    }
  }
  return cleaned;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
