import fs from "node:fs";
import { resolve } from "node:path";
import type { FastifyBaseLogger } from "fastify";
import { AuditService } from "../modules/audit/audit-service";
import { LanguageRegistry } from "../modules/ast/language-registry";
import { AstClassifier } from "../modules/ast/ast-classifier";
import { DetectionEngine } from "../modules/detection/detection-engine";
import { SqliteMappingStore } from "../modules/mapping-store/sqlite-mapping-store";
import { PolicyEngine } from "../modules/policy/policy-engine";
import { ChatCompletionsProxyRoute } from "../modules/proxy/chat-completions-proxy-route";
import { MessagesProxyRoute } from "../modules/proxy/messages-proxy-route";
import { ResponsesProxyRoute } from "../modules/proxy/responses-proxy-route";
import { ResponseRemapEngine } from "../modules/remap/response-remap-engine";
import { RewriteEngineV4 as RewriteEngine } from "../modules/rewrite/rewrite-engine-v4";
import { createProviderAdapter } from "../modules/provider-adapter/provider-adapter-factory";
import { ProviderRouter } from "../modules/provider-adapter/provider-router";
import { LlmEntityExtractor } from "../modules/llm-extractor/llm-entity-extractor";
import { EntityCache } from "../modules/llm-extractor/entity-cache";
import { ProjectShield } from "../modules/project-shield/project-shield";
import { generateHeuristicShield, autoGenerateShield } from "../modules/project-shield/shield-generator";
import type { AppConfig, ProviderType } from "../shared/config";

function getProviderConfig(config: AppConfig, type: ProviderType) {
  if (type === "anthropic") {
    return {
      type: "anthropic" as const,
      baseUrl: config.anthropicBaseUrl,
      apiKey: config.anthropicApiKey ?? "",
      anthropicAuthMode: config.anthropicAuthMode,
      anthropicOauthTokenPath: config.anthropicOauthTokenPath,
      anthropicVersion: config.anthropicVersion
    };
  }
  if (type === "litellm") {
    return {
      type: "litellm" as const,
      baseUrl: config.litellmBaseUrl || "http://localhost:4000",
      apiKey: config.litellmApiKey ?? "",
      // Forward Anthropic OAuth config so LiteLLM can inject fresh tokens for Claude models
      anthropicAuthMode: config.anthropicAuthMode,
      anthropicOauthTokenPath: config.anthropicOauthTokenPath,
      anthropicVersion: config.anthropicVersion
    };
  }
  if (type === "azure-openai") {
    return {
      type: "azure-openai" as const,
      baseUrl: config.azureOpenaiBaseUrl,
      apiKey: config.azureOpenaiApiKey,
      azureApiVersion: config.azureOpenaiApiVersion,
      azureDeployment: config.azureOpenaiDeployment,
    };
  }
  if (type === "gemini") {
    return {
      type: "gemini" as const,
      baseUrl: config.geminiBaseUrl,
      apiKey: config.geminiApiKey,
    };
  }
  if (type === "mistral") {
    return {
      type: "mistral" as const,
      baseUrl: config.mistralBaseUrl,
      apiKey: config.mistralApiKey,
    };
  }
  return {
    type: "openai" as const,
    baseUrl: config.openaiBaseUrl,
    apiKey: config.openaiApiKey ?? "",
    openaiAuthMode: config.openaiAuthMode,
    openaiOauthTokenPath: config.openaiOauthTokenPath
  };
}

export function buildModules(config: AppConfig, logger: FastifyBaseLogger) {
  const mappingStore = new SqliteMappingStore(config.sqlitePath);
  mappingStore.initialize();
  const auditService = new AuditService(logger);
  const detectionEngine = new DetectionEngine();
  const policyEngine = new PolicyEngine();
  const rewriteEngine = new RewriteEngine(mappingStore);
  const remapEngine = new ResponseRemapEngine(mappingStore);
  remapEngine.setLogger(logger);

  // Project Shield — static string replacement to mask project/product/client identity
  // Auto-generates shield config if file doesn't exist (heuristic, no LLM needed)
  let shieldTerms: string[] = [];
  const shieldPath = config.projectShieldPath || ".llm-shield.json";
  const shieldFileExists = fs.existsSync(shieldPath);

  if (shieldFileExists) {
    try {
      const shield = ProjectShield.fromFile(shieldPath);
      rewriteEngine.setProjectShield(shield);
      remapEngine.setProjectShield(shield);
      shieldTerms = shield.originalTerms;
      logger.info({ path: shieldPath, rules: shield.ruleCount }, "Project Shield loaded");
    } catch (err) {
      logger.warn({ path: shieldPath, error: (err as Error).message }, "Failed to load Project Shield config — shield disabled");
    }
  } else {
    // Auto-generate shield from project metadata (sync heuristic for immediate startup)
    try {
      const heuristic = generateHeuristicShield(process.cwd());
      const ruleCount = Object.keys(heuristic.replacements).length;
      if (ruleCount > 0) {
        fs.writeFileSync(shieldPath, JSON.stringify(heuristic, null, 2) + "\n", "utf-8");
        const shield = ProjectShield.fromFile(shieldPath);
        rewriteEngine.setProjectShield(shield);
        remapEngine.setProjectShield(shield);
        shieldTerms = shield.originalTerms;
        logger.info({ path: shieldPath, rules: ruleCount, method: "heuristic" }, "Project Shield auto-generated");
      } else {
        logger.info("Project Shield: no project-identifying strings detected — shield disabled");
      }
    } catch (err) {
      logger.warn({ error: (err as Error).message }, "Project Shield auto-generation failed — shield disabled");
    }

    // If Ollama is available, try to regenerate with LLM in background (better results)
    if (config.ollamaEnabled) {
      autoGenerateShield(process.cwd(), shieldPath, {
        baseUrl: config.ollamaBaseUrl,
        model: config.ollamaModel,
        timeoutMs: config.ollamaTimeoutMs,
        enabled: true
      }).then((result) => {
        if (result && result.method === "llm") {
          // Reload shield with LLM-generated config
          try {
            const shield = ProjectShield.fromFile(result.path);
            rewriteEngine.setProjectShield(shield);
            remapEngine.setProjectShield(shield);
            shieldTerms.length = 0;
            shieldTerms.push(...shield.originalTerms);
            logger.info({ path: result.path, rules: result.ruleCount, method: "llm" }, "Project Shield upgraded with LLM detection");
          } catch { /* keep heuristic shield */ }
        }
      }).catch(() => { /* keep heuristic shield */ });
    }
  }

  const primaryAdapter = createProviderAdapter(
    getProviderConfig(config, config.primaryProvider)
  );

  const fallbackAdapter = config.fallbackProvider
    ? createProviderAdapter(getProviderConfig(config, config.fallbackProvider))
    : null;

  const providerRouter = new ProviderRouter(
    primaryAdapter,
    fallbackAdapter,
    config.requestTimeoutMs,
    logger
  );

  // Always register both OpenAI and Anthropic adapters so the router can
  // auto-route by model name (e.g. claude-* → anthropic, gpt-*/o1-* → openai)
  for (const providerType of ["openai", "anthropic"] as const) {
    if (!providerRouter.hasAdapter(providerType)) {
      providerRouter.registerAdapter(
        createProviderAdapter(getProviderConfig(config, providerType))
      );
    }
  }

  // Register LiteLLM adapter if configured (for catch-all model routing)
  if (config.litellmBaseUrl) {
    providerRouter.registerAdapter(
      createProviderAdapter(getProviderConfig(config, "litellm"))
    );
  }

  // Gateway mode: when LiteLLM is primary, route ALL models through it
  if (config.primaryProvider === "litellm") {
    providerRouter.setGatewayMode(true);
    logger.info("LiteLLM gateway mode enabled — all models routed through LiteLLM");
  }

  // Register Azure OpenAI adapter if configured
  if (config.azureOpenaiBaseUrl && config.azureOpenaiApiKey) {
    providerRouter.registerAdapter(
      createProviderAdapter({
        type: "azure-openai",
        baseUrl: config.azureOpenaiBaseUrl,
        apiKey: config.azureOpenaiApiKey,
        azureApiVersion: config.azureOpenaiApiVersion,
        azureDeployment: config.azureOpenaiDeployment,
      })
    );
    logger.info({ baseUrl: config.azureOpenaiBaseUrl }, "Azure OpenAI adapter registered");
  }

  // Register Gemini adapter if configured
  if (config.geminiApiKey) {
    providerRouter.registerAdapter(
      createProviderAdapter({
        type: "gemini",
        baseUrl: config.geminiBaseUrl,
        apiKey: config.geminiApiKey,
      })
    );
    logger.info("Google Gemini adapter registered");
  }

  // Register Mistral adapter if configured
  if (config.mistralApiKey) {
    providerRouter.registerAdapter(
      createProviderAdapter({
        type: "mistral",
        baseUrl: config.mistralBaseUrl,
        apiKey: config.mistralApiKey,
      })
    );
    logger.info("Mistral AI adapter registered");
  }

  // Initialize AST classifier (grammars loaded lazily on first use)
  const grammarDir = resolve(config.dataDir, "grammars");
  const languageRegistry = new LanguageRegistry(grammarDir);
  const astClassifier = new AstClassifier(languageRegistry);

  // Initialize local LLM entity extractor (Ollama)
  const entityCache = new EntityCache(config.ollamaCacheTtlMs, config.ollamaCacheMaxSize);
  const llmExtractor = new LlmEntityExtractor(
    {
      ollamaBaseUrl: config.ollamaBaseUrl,
      model: config.ollamaModel,
      timeoutMs: config.ollamaTimeoutMs,
      enabled: config.ollamaEnabled
    },
    entityCache
  );

  if (config.ollamaEnabled) {
    llmExtractor.isAvailable().then((available) => {
      if (available) {
        logger.info({ model: config.ollamaModel, url: config.ollamaBaseUrl }, "Ollama LLM extractor connected");
      } else {
        logger.warn({ url: config.ollamaBaseUrl }, "Ollama not reachable — falling back to regex-only anonymization");
      }
    });
  }

  const sharedDeps = {
    config,
    logger,
    auditService,
    detectionEngine,
    policyEngine,
    rewriteEngine,
    remapEngine,
    providerRouter,
    mappingStore,
    astClassifier,
    llmExtractor
  };

  return {
    chatCompletionsProxy: new ChatCompletionsProxyRoute(sharedDeps),
    responsesProxy: new ResponsesProxyRoute(sharedDeps),
    messagesProxy: new MessagesProxyRoute(sharedDeps),
    providerRouter,
    mappingStore,
    rewriteEngine,
    remapEngine,
    detectionEngine,
    policyEngine,
    shieldTerms
  };
}
