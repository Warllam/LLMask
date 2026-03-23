/**
 * Google Gemini Adapter
 *
 * Gemini uses the OpenAI-compatible endpoint:
 * https://generativelanguage.googleapis.com/v1beta/openai/
 *
 * This adapter translates LLMASK requests to Gemini's OpenAI-compatible format.
 * Supported models: gemini-2.5-pro, gemini-2.5-flash, etc.
 */

import { Transform } from "node:stream";
import type { ProviderAdapter, ProviderConfig, ProviderAdapterResult, EndpointKind } from "./types";
import {
  chatCompletionsToAnthropicJson,
  chatCompletionsToResponsesJson,
  messagesBodyToChatCompletions,
  responsesBodyToChatCompletions,
} from "./openai-compatible-mappers";

export class GeminiAdapter implements ProviderAdapter {
  readonly type = "gemini" as const;
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
    const baseUrl = this.config.baseUrl.replace(/\/+$/, "") ||
      "https://generativelanguage.googleapis.com/v1beta/openai";

    const url = `${baseUrl}/chat/completions`;

    const requestBody =
      endpointKind === "responses"
        ? responsesBodyToChatCompletions(body)
        : endpointKind === "messages"
          ? messagesBodyToChatCompletions(body)
          : body;

    return {
      url,
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
    // Gemini OpenAI-compatible SSE is standard — pass through
    return new Transform({
      transform(chunk, _encoding, callback) {
        callback(null, chunk);
      },
    });
  }
}
