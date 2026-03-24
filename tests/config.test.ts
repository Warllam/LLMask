import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/shared/config";

function baseEnv(): Record<string, string> {
  return {
    PORT: "9999",
    HOST: "127.0.0.1",
    LOG_LEVEL: "warn",
    PRIMARY_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-test-key",
    OPENAI_BASE_URL: "https://api.openai.com"
  };
}

describe("loadConfig", () => {
  it("parses minimal env with defaults", () => {
    const config = loadConfig({});
    expect(config.port).toBe(8787);
    expect(config.host).toBe("0.0.0.0");
    expect(config.logLevel).toBe("info");
    expect(config.primaryProvider).toBe("openai");
    expect(config.fallbackProvider).toBeNull();
    expect(config.llmaskMode).toBe("trust");
    expect(config.failSafeBlockOnError).toBe(true);
    expect(config.requestTimeoutMs).toBe(60_000);
  });

  it("parses explicit env values", () => {
    const config = loadConfig(baseEnv());
    expect(config.port).toBe(9999);
    expect(config.host).toBe("127.0.0.1");
    expect(config.logLevel).toBe("warn");
    expect(config.openaiApiKey).toBe("sk-test-key");
  });

  it("parses fallback provider", () => {
    const config = loadConfig({ ...baseEnv(), FALLBACK_PROVIDER: "anthropic" });
    expect(config.fallbackProvider).toBe("anthropic");
  });

  it("parses gemini fallback provider", () => {
    const config = loadConfig({ ...baseEnv(), FALLBACK_PROVIDER: "gemini" });
    expect(config.fallbackProvider).toBe("gemini");
  });

  it("parses mistral fallback provider", () => {
    const config = loadConfig({ ...baseEnv(), FALLBACK_PROVIDER: "mistral" });
    expect(config.fallbackProvider).toBe("mistral");
  });

  it("ignores invalid fallback provider", () => {
    const config = loadConfig({ ...baseEnv(), FALLBACK_PROVIDER: "invalid" });
    expect(config.fallbackProvider).toBeNull();
  });

  it("strips trailing slashes from base URLs", () => {
    const config = loadConfig({
      ...baseEnv(),
      OPENAI_BASE_URL: "https://api.openai.com///",
      ANTHROPIC_BASE_URL: "https://api.anthropic.com/"
    });
    expect(config.openaiBaseUrl).toBe("https://api.openai.com");
    expect(config.anthropicBaseUrl).toBe("https://api.anthropic.com");
  });

  it("uses backward compat PROVIDER_API_KEY", () => {
    const config = loadConfig({ PROVIDER_API_KEY: "old-key" });
    expect(config.openaiApiKey).toBe("old-key");
  });

  it("prefers OPENAI_API_KEY over PROVIDER_API_KEY", () => {
    const config = loadConfig({
      OPENAI_API_KEY: "new-key",
      PROVIDER_API_KEY: "old-key"
    });
    expect(config.openaiApiKey).toBe("new-key");
  });

  it("parses FAIL_SAFE_BLOCK_ON_ERROR string", () => {
    const config = loadConfig({ ...baseEnv(), FAIL_SAFE_BLOCK_ON_ERROR: "false" });
    expect(config.failSafeBlockOnError).toBe(false);
  });

  it("sets LiteLLM config when provided", () => {
    const config = loadConfig({
      ...baseEnv(),
      LITELLM_BASE_URL: "http://localhost:4000",
      LITELLM_API_KEY: "lm-key"
    });
    expect(config.litellmBaseUrl).toBe("http://localhost:4000");
    expect(config.litellmApiKey).toBe("lm-key");
  });

  it("parses metrics security settings", () => {
    const config = loadConfig({
      ...baseEnv(),
      METRICS_AUTH_TOKEN: "metrics-token",
      METRICS_ALLOW_PRIVATE_ONLY: "true",
    });
    expect(config.metricsAuthToken).toBe("metrics-token");
    expect(config.metricsAllowPrivateOnly).toBe(true);
  });
});
