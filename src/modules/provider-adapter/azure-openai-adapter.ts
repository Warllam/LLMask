/**
 * Azure OpenAI Adapter
 *
 * Azure OpenAI uses a slightly different URL format and auth:
 * - URL: https://{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions?api-version={version}
 * - Auth: api-key header instead of Authorization: Bearer
 *
 * But the request/response format is identical to OpenAI.
 */

import { Transform } from "node:stream";
import type { ProviderAdapter, ProviderConfig, ProviderAdapterResult, EndpointKind } from "./types";
import {
  chatCompletionsToAnthropicJson,
  chatCompletionsToResponsesJson,
  messagesBodyToChatCompletions,
  responsesBodyToChatCompletions,
} from "./openai-compatible-mappers";

export class AzureOpenAiAdapter implements ProviderAdapter {
  readonly type = "azure-openai" as const;
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
    const apiVersion = this.config.azureApiVersion || "2024-10-21";
    const deployment = this.config.azureDeployment || (body as any)?.model || "gpt-4o";

    // Azure URL format
    const baseUrl = this.config.baseUrl.replace(/\/+$/, "");
    const url = `${baseUrl}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

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
        "api-key": this.config.apiKey,
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
    // Azure SSE format is identical to OpenAI — pass through
    return new Transform({
      transform(chunk, _encoding, callback) {
        callback(null, chunk);
      },
    });
  }
}
