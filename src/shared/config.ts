import { z } from "zod";
import { findClaudeCredentialsPath } from "./anthropic-claude-oauth";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  // Multi-provider configuration
  PRIMARY_PROVIDER: z.enum(["openai", "anthropic", "litellm", "azure-openai", "gemini", "mistral"]).default("openai"),
  FALLBACK_PROVIDER: z.string().default(""),

  // OpenAI
  OPENAI_AUTH_MODE: z.enum(["api_key", "oauth_codex"]).default("api_key"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com"),
  OPENAI_OAUTH_TOKEN_PATH: z.string().optional(),

  // Anthropic
  ANTHROPIC_AUTH_MODE: z.enum(["api_key", "oauth_claude_code"]).default("api_key"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().default("https://api.anthropic.com"),
  ANTHROPIC_VERSION: z.string().default("2023-06-01"),
  ANTHROPIC_OAUTH_TOKEN_PATH: z.string().optional(),

  // Backward compat aliases (old single-provider config)
  PROVIDER_BASE_URL: z.string().optional(),
  PROVIDER_API_KEY: z.string().optional(),

  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  LLMASK_MODE: z.enum(["trust", "review"]).default("trust"),
  FAIL_SAFE_BLOCK_ON_ERROR: z.preprocess(
    (value) => {
      if (typeof value === "boolean") return value;
      if (typeof value === "string") return value.toLowerCase() === "true";
      return true;
    },
    z.boolean().default(true)
  ),
  DATA_DIR: z.string().default("./data"),
  SQLITE_PATH: z.string().default("./data/llmask.db"),

  // LiteLLM
  LITELLM_BASE_URL: z.string().default(""),
  LITELLM_API_KEY: z.string().optional(),
  LITELLM_FORWARD_AUTH: z.preprocess(
    (value) => {
      if (typeof value === "boolean") return value;
      if (typeof value === "string") return value.toLowerCase() !== "false";
      return true;
    },
    z.boolean().default(true)
  ),

  // Local LLM (Ollama) for entity extraction
  OLLAMA_ENABLED: z.preprocess(
    (value) => {
      if (typeof value === "boolean") return value;
      if (typeof value === "string") return value.toLowerCase() === "true";
      return false;
    },
    z.boolean().default(false)
  ),
  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("qwen2.5:3b"),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  OLLAMA_CACHE_TTL_MS: z.coerce.number().int().positive().default(1800000),
  OLLAMA_CACHE_MAX_SIZE: z.coerce.number().int().positive().default(500),

  // Project Shield — static string replacement to mask project/product/client identity
  PROJECT_SHIELD_PATH: z.string().default(""),

  // Authentication
  LLMASK_AUTH_ENABLED: z.preprocess(
    (value) => {
      if (typeof value === "boolean") return value;
      if (typeof value === "string") return value.toLowerCase() === "true";
      return false;
    },
    z.boolean().default(false)
  ),
  LLMASK_ADMIN_KEY: z.string().optional(),
  // JWT secret for dashboard session tokens (generated randomly if not set)
  LLMASK_JWT_SECRET: z.string().default(""),
  // Default admin credentials seeded on first run
  LLMASK_ADMIN_USER: z.string().default("admin"),
  LLMASK_ADMIN_PASSWORD: z.string().default(""),

  // Edition (deprecated — use LLMASK_LICENSE_KEY instead)
  LLMASK_EDITION: z.enum(["oss", "enterprise", "community", "pro"]).default("community"),

  // License key (JWT) — determines tier (community/pro/enterprise)
  LLMASK_LICENSE_KEY: z.string().default(""),
  LLMASK_LICENSE_FILE: z.string().default(""),

  // Azure OpenAI
  AZURE_OPENAI_API_KEY: z.string().default(""),
  AZURE_OPENAI_BASE_URL: z.string().default(""),
  AZURE_OPENAI_API_VERSION: z.string().default("2024-10-21"),
  AZURE_OPENAI_DEPLOYMENT: z.string().default(""),

  // Google Gemini
  GEMINI_API_KEY: z.string().default(""),
  GEMINI_BASE_URL: z.string().default("https://generativelanguage.googleapis.com/v1beta/openai"),

  // Mistral AI
  MISTRAL_API_KEY: z.string().default(""),
  MISTRAL_BASE_URL: z.string().default("https://api.mistral.ai"),

  // OIDC/SSO (Enterprise only)
  LLMASK_OIDC_ISSUER_URL: z.string().default(""),
  LLMASK_OIDC_CLIENT_ID: z.string().default(""),
  LLMASK_OIDC_JWKS_URL: z.string().default(""),

  // GDPR (Enterprise only)
  LLMASK_GDPR_RETENTION_DAYS: z.coerce.number().int().min(0).default(0),

  // TLS/HTTPS
  LLMASK_TLS_CERT: z.string().default(""),
  LLMASK_TLS_KEY: z.string().default(""),

  // Global rate limit (per-IP, requests/minute, 0 = disabled)
  LLMASK_RATE_LIMIT: z.coerce.number().int().min(0).default(0),

  // Security: Rate Limiting
  RATE_LIMIT_MAX: z.coerce.number().int().min(0).default(60),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_API_MAX: z.coerce.number().int().min(0).default(30),
  RATE_LIMIT_DASHBOARD_MAX: z.coerce.number().int().min(0).default(120),
  RATE_LIMIT_METRICS_MAX: z.coerce.number().int().min(0).default(10),
  RATE_LIMIT_HEALTH_MAX: z.coerce.number().int().min(0).default(60),

  // Security: CORS
  CORS_ORIGINS: z.string().default("http://localhost:*,http://127.0.0.1:*"),
  CORS_METHODS: z.string().default("GET,POST,PUT,DELETE,OPTIONS"),
  CORS_HEADERS: z.string().default("Content-Type,Authorization,x-llmask-key,anthropic-version,x-api-key,x-request-id"),

  // Security: Input Validation
  MAX_PROMPT_SIZE: z.coerce.number().int().positive().default(102400), // 100KB
  ALLOWED_CONTENT_TYPES: z.string().default("application/json,multipart/form-data"),
  BODY_LIMIT: z.coerce.number().int().positive().default(10485760), // 10MB

  // CORS extras
  CORS_ORIGIN: z.string().default(""),
  CORS_CREDENTIALS: z.preprocess(
    (v) => typeof v === "string" ? v.toLowerCase() === "true" : !!v,
    z.boolean().default(false)
  ),

  // Admin API Key (alias for LLMASK_ADMIN_KEY, takes precedence)
  ADMIN_API_KEY: z.string().default(""),

  // Security: CSP
  CSP_ENABLED: z.preprocess(
    (value) => {
      if (typeof value === "boolean") return value;
      if (typeof value === "string") return value.toLowerCase() !== "false";
      return true;
    },
    z.boolean().default(true)
  ),

  // Metrics (Prometheus)
  METRICS_ENABLED: z.preprocess(
    (value) => {
      if (typeof value === "boolean") return value;
      if (typeof value === "string") return value.toLowerCase() === "true";
      return true;
    },
    z.boolean().default(true)
  ),
  METRICS_PATH: z.string().default("/metrics"),
  METRICS_AUTH_TOKEN: z.string().default(""),
  METRICS_ALLOW_PRIVATE_ONLY: z.preprocess(
    (value) => {
      if (typeof value === "boolean") return value;
      if (typeof value === "string") return value.toLowerCase() === "true";
      return false;
    },
    z.boolean().default(false)
  ),
});

export type ProviderType = "openai" | "anthropic" | "litellm" | "azure-openai" | "gemini" | "mistral";

export type AppConfig = {
  port: number;
  host: string;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

  primaryProvider: ProviderType;
  fallbackProvider: ProviderType | null;

  openaiApiKey?: string;
  openaiAuthMode: "api_key" | "oauth_codex";
  openaiBaseUrl: string;
  openaiOauthTokenPath?: string;

  anthropicApiKey?: string;
  anthropicAuthMode: "api_key" | "oauth_claude_code";
  anthropicBaseUrl: string;
  anthropicVersion: string;
  anthropicOauthTokenPath?: string;

  requestTimeoutMs: number;
  llmaskMode: "trust" | "review";
  failSafeBlockOnError: boolean;
  dataDir: string;
  sqlitePath: string;

  litellmBaseUrl: string;
  litellmApiKey?: string;
  litellmForwardAuth: boolean;

  ollamaEnabled: boolean;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaTimeoutMs: number;
  ollamaCacheTtlMs: number;
  ollamaCacheMaxSize: number;

  projectShieldPath: string;

  authEnabled: boolean;
  adminKey?: string;
  jwtSecret: string;
  adminUser: string;
  adminPassword: string;

  edition: "community" | "pro" | "enterprise";

  licenseKey: string;
  licenseFile: string;

  // Azure OpenAI
  azureOpenaiApiKey: string;
  azureOpenaiBaseUrl: string;
  azureOpenaiApiVersion: string;
  azureOpenaiDeployment: string;

  // Google Gemini
  geminiApiKey: string;
  geminiBaseUrl: string;

  // Mistral AI
  mistralApiKey: string;
  mistralBaseUrl: string;

  oidcIssuerUrl: string;
  oidcClientId: string;
  oidcJwksUrl: string;

  gdprRetentionDays: number;

  tlsCert: string;
  tlsKey: string;
  rateLimit: number;

  // Security enhancements
  rateLimitMax: number;
  rateLimitWindowMs: number;
  rateLimitApiMax: number;
  rateLimitDashboardMax: number;
  corsOrigins: string;
  corsMethods: string;
  corsHeaders: string;
  maxPromptSize: number;
  allowedContentTypes: string;
  cspEnabled: boolean;

  // Metrics
  metricsEnabled: boolean;
  metricsPath: string;
  metricsAuthToken?: string;
  metricsAllowPrivateOnly: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.parse(env);

  // Backward compat: if old PROVIDER_API_KEY is set but new keys are not
  const openaiApiKey =
    parsed.OPENAI_API_KEY || parsed.PROVIDER_API_KEY || undefined;
  const openaiBaseUrl =
    parsed.OPENAI_BASE_URL !== "https://api.openai.com" && parsed.OPENAI_BASE_URL
      ? parsed.OPENAI_BASE_URL
      : parsed.PROVIDER_BASE_URL ?? parsed.OPENAI_BASE_URL;

  // Parse fallback provider
  let fallbackProvider: ProviderType | null = null;
  const allowedFallbackProviders: ProviderType[] = [
    "openai",
    "anthropic",
    "litellm",
    "azure-openai",
    "gemini",
    "mistral"
  ];
  if (allowedFallbackProviders.includes(parsed.FALLBACK_PROVIDER as ProviderType)) {
    fallbackProvider = parsed.FALLBACK_PROVIDER as ProviderType;
  }

  return {
    port: parsed.PORT,
    host: parsed.HOST,
    logLevel: parsed.LOG_LEVEL,

    primaryProvider: parsed.PRIMARY_PROVIDER,
    fallbackProvider,

    openaiApiKey,
    openaiAuthMode: parsed.OPENAI_AUTH_MODE,
    openaiBaseUrl: openaiBaseUrl.replace(/\/+$/, ""),
    openaiOauthTokenPath: parsed.OPENAI_OAUTH_TOKEN_PATH || undefined,

    anthropicApiKey: parsed.ANTHROPIC_API_KEY || undefined,
    anthropicAuthMode: parsed.ANTHROPIC_AUTH_MODE,
    anthropicBaseUrl: parsed.ANTHROPIC_BASE_URL.replace(/\/+$/, ""),
    anthropicVersion: parsed.ANTHROPIC_VERSION,
    anthropicOauthTokenPath:
      parsed.ANTHROPIC_OAUTH_TOKEN_PATH ||
      (parsed.ANTHROPIC_AUTH_MODE === "oauth_claude_code" ? findClaudeCredentialsPath() : undefined),

    requestTimeoutMs: parsed.REQUEST_TIMEOUT_MS,
    llmaskMode: parsed.LLMASK_MODE,
    failSafeBlockOnError: parsed.FAIL_SAFE_BLOCK_ON_ERROR,
    dataDir: parsed.DATA_DIR,
    sqlitePath: parsed.SQLITE_PATH,

    litellmBaseUrl: (parsed.LITELLM_BASE_URL || "").replace(/\/+$/, ""),
    litellmApiKey: parsed.LITELLM_API_KEY || undefined,
    litellmForwardAuth: parsed.LITELLM_FORWARD_AUTH,

    ollamaEnabled: parsed.OLLAMA_ENABLED,
    ollamaBaseUrl: parsed.OLLAMA_BASE_URL.replace(/\/+$/, ""),
    ollamaModel: parsed.OLLAMA_MODEL,
    ollamaTimeoutMs: parsed.OLLAMA_TIMEOUT_MS,
    ollamaCacheTtlMs: parsed.OLLAMA_CACHE_TTL_MS,
    ollamaCacheMaxSize: parsed.OLLAMA_CACHE_MAX_SIZE,

    projectShieldPath: parsed.PROJECT_SHIELD_PATH,

    authEnabled: parsed.LLMASK_AUTH_ENABLED,
    adminKey: parsed.LLMASK_ADMIN_KEY || undefined,
    jwtSecret: parsed.LLMASK_JWT_SECRET,
    adminUser: parsed.LLMASK_ADMIN_USER,
    adminPassword: parsed.LLMASK_ADMIN_PASSWORD,

    // Map old edition values to new tier names
    edition: parsed.LLMASK_EDITION === "oss" ? "community"
           : parsed.LLMASK_EDITION === "enterprise" ? "enterprise"
           : parsed.LLMASK_EDITION as "community" | "pro" | "enterprise",

    licenseKey: parsed.LLMASK_LICENSE_KEY,
    licenseFile: parsed.LLMASK_LICENSE_FILE,

    azureOpenaiApiKey: parsed.AZURE_OPENAI_API_KEY,
    azureOpenaiBaseUrl: parsed.AZURE_OPENAI_BASE_URL.replace(/\/+$/, ""),
    azureOpenaiApiVersion: parsed.AZURE_OPENAI_API_VERSION,
    azureOpenaiDeployment: parsed.AZURE_OPENAI_DEPLOYMENT,

    geminiApiKey: parsed.GEMINI_API_KEY,
    geminiBaseUrl: parsed.GEMINI_BASE_URL.replace(/\/+$/, ""),

    mistralApiKey: parsed.MISTRAL_API_KEY,
    mistralBaseUrl: parsed.MISTRAL_BASE_URL.replace(/\/+$/, ""),

    oidcIssuerUrl: parsed.LLMASK_OIDC_ISSUER_URL,
    oidcClientId: parsed.LLMASK_OIDC_CLIENT_ID,
    oidcJwksUrl: parsed.LLMASK_OIDC_JWKS_URL,

    gdprRetentionDays: parsed.LLMASK_GDPR_RETENTION_DAYS,

    tlsCert: parsed.LLMASK_TLS_CERT,
    tlsKey: parsed.LLMASK_TLS_KEY,
    rateLimit: parsed.LLMASK_RATE_LIMIT,

    // Security enhancements
    rateLimitMax: parsed.RATE_LIMIT_MAX,
    rateLimitWindowMs: parsed.RATE_LIMIT_WINDOW_MS,
    rateLimitApiMax: parsed.RATE_LIMIT_API_MAX,
    rateLimitDashboardMax: parsed.RATE_LIMIT_DASHBOARD_MAX,
    corsOrigins: parsed.CORS_ORIGINS,
    corsMethods: parsed.CORS_METHODS,
    corsHeaders: parsed.CORS_HEADERS,
    maxPromptSize: parsed.MAX_PROMPT_SIZE,
    allowedContentTypes: parsed.ALLOWED_CONTENT_TYPES,
    cspEnabled: parsed.CSP_ENABLED,

    // Metrics
    metricsEnabled: parsed.METRICS_ENABLED,
    metricsPath: parsed.METRICS_PATH,
    metricsAuthToken: parsed.METRICS_AUTH_TOKEN || undefined,
    metricsAllowPrivateOnly: parsed.METRICS_ALLOW_PRIVATE_ONLY,
  };
}
