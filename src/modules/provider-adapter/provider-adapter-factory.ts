import { AnthropicAdapter } from "./anthropic-adapter";
import { AzureOpenAiAdapter } from "./azure-openai-adapter";
import { GeminiAdapter } from "./gemini-adapter";
import { LiteLlmAdapter } from "./litellm-adapter";
import { MistralAdapter } from "./mistral-adapter";
import { OpenAiAdapter } from "./openai-adapter";
import type { ProviderAdapter, ProviderConfig } from "./types";

export function createProviderAdapter(config: ProviderConfig): ProviderAdapter {
  switch (config.type) {
    case "anthropic":
      return new AnthropicAdapter(config);
    case "azure-openai":
      return new AzureOpenAiAdapter(config);
    case "gemini":
      return new GeminiAdapter(config);
    case "mistral":
      return new MistralAdapter(config);
    case "litellm":
      return new LiteLlmAdapter(config);
    default:
      return new OpenAiAdapter(config);
  }
}
