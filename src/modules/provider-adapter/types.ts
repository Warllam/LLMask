import type { Transform } from "node:stream";

export type ProviderType = "openai" | "anthropic" | "litellm" | "azure-openai" | "gemini" | "mistral";

export type ProviderConfig = {
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
  openaiAuthMode?: "api_key" | "oauth_codex";
  openaiOauthTokenPath?: string;
  anthropicAuthMode?: "api_key" | "oauth_claude_code";
  anthropicOauthTokenPath?: string;
  anthropicVersion?: string;
  // Azure OpenAI
  azureApiVersion?: string;
  azureDeployment?: string;
  // Gemini
  geminiProjectId?: string;
};

export type ProviderAdapterResult = {
  url: string;
  headers: Record<string, string>;
  body: unknown;
};

export type EndpointKind = "chat-completions" | "responses" | "messages";

export interface ProviderAdapter {
  readonly type: ProviderType;

  prepareRequest(
    endpointKind: EndpointKind,
    body: unknown,
    incomingAuthHeader?: string,
    incomingHeaders?: Record<string, string>
  ): ProviderAdapterResult | Promise<ProviderAdapterResult>;

  translateJsonResponse(raw: unknown, originalEndpointKind: EndpointKind): unknown;

  createSseTranslationTransform(originalEndpointKind: EndpointKind): Transform;
}
