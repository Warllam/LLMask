/**
 * Mistral AI Adapter
 *
 * Mistral uses an OpenAI-compatible API:
 * https://api.mistral.ai/v1/chat/completions
 *
 * Supported models: mistral-large, mistral-medium, codestral, etc.
 */

import { Transform } from "node:stream";
import type { ProviderAdapter, ProviderConfig, ProviderAdapterResult, EndpointKind } from "./types";
import {
  chatCompletionsToAnthropicJson,
  chatCompletionsToResponsesJson,
  messagesBodyToChatCompletions,
  responsesBodyToChatCompletions,
} from "./openai-compatible-mappers";

export class MistralAdapter implements ProviderAdapter {
  readonly type = "mistral" as const;
  private readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  prepareRequest(
    endpointKind: EndpointKind,
    body: unknown,
    _incomingAuthHeader?: string,
    _incomingHeaders?: Record<string, string>
  ): ProviderAdapterResult {
    const baseUrl = this.config.baseUrl.replace(/\/+$/, "") || "https://api.mistral.ai";

    const requestBody =
      endpointKind === "responses"
        ? responsesBodyToChatCompletions(body)
        : endpointKind === "messages"
          ? messagesBodyToChatCompletions(body)
          : body;

    return {
      url: `${baseUrl}/v1/chat/completions`,
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${this.config.apiKey}`,
      },
      body: requestBody,
    };
  }

  translateJsonResponse(raw: unknown, originalEndpointKind: EndpointKind): unknown {
    if (originalEndpointKind === "responses") {
      return chatCompletionsToResponsesJson(raw);
    }
    if (originalEndpointKind === "messages") {
      return chatCompletionsToAnthropicJson(raw);
    }
    return raw;
  }

  createSseTranslationTransform(_originalEndpointKind: EndpointKind): Transform {
    // Mistral SSE is OpenAI-compatible — pass through
    return new Transform({
      transform(chunk, _encoding, callback) {
        callback(null, chunk);
      },
    });
  }
}
