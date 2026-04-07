import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import multipart from "@fastify/multipart";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildModules } from "./app/modules";
import { registerDashboardRoutes } from "./modules/dashboard/dashboard-routes";
import type { AppConfig } from "./shared/config";
import { stripImageMetadata, describeImageMetadata } from "./shared/image-sanitizer";
import { extractText, isSupportedFile, isTextFile, isDocumentFile, isImageFile } from "./shared/file-extractors";
import { 
  parseSecurityConfig, 
  registerSecurityMiddleware, 
  validatePromptSize, 
  validateContentType 
} from "./shared/security-middleware";
import { parsePromptInjectionConfig, createPromptInjectionGuard } from "./shared/prompt-injection-guard";
import {
  initializeMetrics,
  exportMetrics,
  updateSystemMetrics,
  observeHistogram,
  incCounter,
  incrementActiveSessions,
  decrementActiveSessions,
  recordHttpRequest,
} from "./shared/metrics";

const PKG_VERSION = (() => {
  try {
    return (JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf-8")
    ) as { version: string }).version;
  } catch {
    return "unknown";
  }
})();

export function buildServer(config: AppConfig): FastifyInstance {
  let lastProxyRequestAt: string | null = null;

  const securityConf = parseSecurityConfig(process.env);
  const server = Fastify({
    logger: {
      level: config.logLevel
    },
    disableRequestLogging: false,
    requestTimeout: config.requestTimeoutMs,
    bodyLimit: securityConf.bodyLimit,
    genReqId: () => randomUUID(),
  });

  // ── Initialize metrics system ────────────────────────────────────
  if (config.metricsEnabled) {
    initializeMetrics();

    // Update system metrics every 15 seconds
    const metricsInterval = setInterval(updateSystemMetrics, 15_000);
    server.addHook("onClose", () => clearInterval(metricsInterval));

    server.log.info({ path: config.metricsPath }, "Prometheus metrics enabled");
  }

  const modules = buildModules(config, server.log);

  void server.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 1
    }
  });

  server.log.info("LLMask running as community (OSS)");

  // ── Enhanced Security Middleware ─────────────────────────────────
  const advancedRateLimiter = registerSecurityMiddleware(server, securityConf, server.log);

  // ── Metrics hooks (latency tracking & session counting) ───────────
  if (config.metricsEnabled) {
    server.addHook("onRequest", async (request) => {
      (request as any).startTime = Date.now();
      incrementActiveSessions();
    });

    server.addHook("onResponse", async (request, reply) => {
      decrementActiveSessions();

      const startTime = (request as any).startTime as number | undefined;
      if (!startTime) return;

      const duration = (Date.now() - startTime) / 1000; // seconds
      const route = request.routeOptions?.url || request.url;
      const method = request.method;
      const status = String(reply.statusCode);

      observeHistogram("llmask_request_duration_seconds", {
        route,
        method,
        status,
      }, duration);
      recordHttpRequest(method, route, status);
    });
  }

  // ── Track last proxied request ─────────────────────────────────────
  server.addHook("onRequest", async (request) => {
    if (request.url.startsWith("/v1/")) {
      lastProxyRequestAt = new Date().toISOString();
    }
  });

  // ── Health ─────────────────────────────────────────────────────────
  server.get("/health", async (_request, reply) => {
    const mem = process.memoryUsage();
    const toMb = (b: number) => Math.round(b / 1024 / 1024 * 10) / 10;

    // Database stats (single query to getStats covers mapping count + request totals)
    let dbStatus: "ok" | "error" = "ok";
    let dbSizeBytes = 0;
    let totalMappings = 0;
    let totalRequests = 0;
    let totalTransforms = 0;
    try {
      const stats = modules.mappingStore.getStats();
      totalMappings = stats.totalMappings;
      totalRequests = stats.totalRequests;
      totalTransforms = stats.totalTransforms;
      try {
        dbSizeBytes = fs.statSync(config.sqlitePath).size;
      } catch {
        // file may not exist yet on first startup before any requests
      }
    } catch {
      dbStatus = "error";
    }

    // Provider statuses — check if API key / OAuth token path is configured
    const providers: Record<string, { configured: boolean }> = {
      openai: { configured: !!(config.openaiApiKey || config.openaiAuthMode === "oauth_codex") },
      anthropic: { configured: !!(config.anthropicApiKey || config.anthropicAuthMode === "oauth_claude_code") },
    };
    if (config.litellmBaseUrl) {
      providers.litellm = { configured: true };
    }
    if (config.azureOpenaiApiKey && config.azureOpenaiBaseUrl) {
      providers["azure-openai"] = { configured: true };
    }
    if (config.geminiApiKey) {
      providers.gemini = { configured: true };
    }
    if (config.mistralApiKey) {
      providers.mistral = { configured: true };
    }

    const anyProviderConfigured = Object.values(providers).some((p) => p.configured);
    let status: "healthy" | "degraded" | "unhealthy";
    if (dbStatus === "ok" && anyProviderConfigured) {
      status = "healthy";
    } else if (dbStatus === "ok" || anyProviderConfigured) {
      status = "degraded";
    } else {
      status = "unhealthy";
    }

    return reply.code(status === "unhealthy" ? 503 : 200).send({
      status,
      uptime: Math.round(process.uptime()),
      version: PKG_VERSION,
      database: {
        status: dbStatus,
        size_bytes: dbSizeBytes,
        mapping_count: totalMappings,
      },
      memory: {
        rss: toMb(mem.rss),
        heapUsed: toMb(mem.heapUsed),
        heapTotal: toMb(mem.heapTotal),
      },
      providers,
      last_request: lastProxyRequestAt,
      masking_stats: {
        total_requests: totalRequests,
        total_elements_masked: totalTransforms,
        active_strategy: config.llmaskMode,
      },
    });
  });

  // ── Health: liveness probe (Kubernetes) ───────────────────────────
  server.get("/health/live", async (_request, reply) => {
    return reply.code(200).send({ status: "ok" });
  });

  // ── Health: readiness probe ────────────────────────────────────────
  server.get("/health/ready", async (_request, reply) => {
    // Check DB is accessible
    let dbOk = false;
    try {
      modules.mappingStore.getStats();
      dbOk = true;
    } catch {
      dbOk = false;
    }

    // Check at least one provider is configured
    const anyProvider = !!(
      config.openaiApiKey ||
      config.openaiAuthMode === "oauth_codex" ||
      config.anthropicApiKey ||
      config.anthropicAuthMode === "oauth_claude_code" ||
      config.litellmBaseUrl ||
      (config.azureOpenaiApiKey && config.azureOpenaiBaseUrl) ||
      config.geminiApiKey ||
      config.mistralApiKey
    );

    if (dbOk && anyProvider) {
      return reply.code(200).send({ status: "ready" });
    }

    const reason = !dbOk ? "database unavailable" : "no provider configured";
    return reply.code(503).send({ status: "not ready", reason });
  });

  // ── Metrics (Prometheus) ───────────────────────────────────────────
  if (config.metricsEnabled) {
    server.get(config.metricsPath, async (request, reply) => {
      if (config.metricsAuthToken) {
        const authHeader = request.headers.authorization;
        const expected = `Bearer ${config.metricsAuthToken}`;
        if (authHeader !== expected) {
          return reply.code(401).send({ error: "metrics unauthorized" });
        }
      }

      if (config.metricsAllowPrivateOnly && !isPrivateRequest(request)) {
        return reply.code(403).send({ error: "metrics forbidden" });
      }

      const metricsText = await exportMetrics();

      return reply
        .code(200)
        .header("content-type", "text/plain; version=0.0.4; charset=utf-8")
        .send(metricsText);
    });
  }

  // ── Auth middleware (OSS: no-op) ─────────────────────────────────────
  const authMiddleware = async (_request: FastifyRequest, _reply: FastifyReply) => {
    // No auth in OSS edition
  };

  // ── Proxy routes (core — available in both editions) ───────────────
  // ── Prompt Injection Guard ──────────────────────────────────────────
  const injectionConfig = parsePromptInjectionConfig(process.env);
  if (injectionConfig.enabled) {
    server.log.info({ mode: injectionConfig.mode }, "Prompt injection guard enabled");
  }

  const inputValidationHandlers = [
    validateContentType(securityConf.allowedContentTypes),
    validatePromptSize(securityConf.maxPromptSize),
    createPromptInjectionGuard(injectionConfig, server.log),
    authMiddleware,
  ];

  server.post("/v1/chat/completions", { preHandler: inputValidationHandlers }, async (request, reply) => {
    return modules.chatCompletionsProxy.handle(request, reply);
  });

  server.post("/v1/responses", { preHandler: inputValidationHandlers }, async (request, reply) => {
    return modules.responsesProxy.handle(request, reply);
  });

  server.post("/v1/messages", { preHandler: inputValidationHandlers }, async (request, reply) => {
    return modules.messagesProxy.handle(request, reply);
  });

  server.post("/v1/files/anonymize", { preHandler: authMiddleware }, async (request, reply) => {
    const part = await (request as any).file?.();
    if (!part) {
      return reply.code(400).send({
        error: {
          message: "Missing file upload (multipart/form-data, field name: file)",
          type: "invalid_request_error",
          code: "MISSING_FILE"
        }
      });
    }

    const filename = String(part.filename ?? "upload.txt");
    const ext = getFileExtension(filename);

    if (!isSupportedFile(ext)) {
      return reply.code(400).send({
        error: {
          message: `Unsupported file extension: ${ext || "(none)"}. Supported: text (.txt,.md,.json,.csv,.xml,.html), documents (.pdf,.docx,.xlsx,.pptx), images (.jpg,.png,.webp)`,
          type: "invalid_request_error",
          code: "UNSUPPORTED_FILE_TYPE"
        }
      });
    }

    const buffer = await part.toBuffer();
    const scopeId = String((part.fields?.scope_id?.value as string | undefined) ?? randomUUID());

    // ── Images: strip EXIF metadata ────────────────────────────────
    if (isImageFile(ext)) {
      const metadataFound = describeImageMetadata(buffer);
      const { sanitized, format, strippedChunks } = stripImageMetadata(buffer);

      server.log.info(
        { filename, format, originalSize: buffer.length, sanitizedSize: sanitized.length, strippedChunks, metadataFound },
        "image metadata sanitization"
      );

      return reply.code(200).send({
        status: "ok",
        fileName: filename,
        scopeId,
        type: "image",
        format,
        originalSize: buffer.length,
        sanitizedSize: sanitized.length,
        strippedMetadataChunks: strippedChunks,
        metadataFound,
        sanitizedBase64: sanitized.toString("base64")
      });
    }

    // ── Text & Documents: extract text → detect → anonymize ────────
    let originalText: string;
    let extractionMeta: Record<string, unknown> = {};

    if (isDocumentFile(ext)) {
      try {
        const extraction = await extractText(buffer, ext);
        originalText = extraction.text;
        extractionMeta = {
          format: extraction.format,
          pageCount: extraction.pageCount,
          documentMetadata: extraction.metadata,
        };
        server.log.info(
          { filename, format: extraction.format, textLength: originalText.length, pageCount: extraction.pageCount },
          "document text extraction"
        );
      } catch (err) {
        return reply.code(422).send({
          error: {
            message: `Failed to extract text from ${ext} file: ${(err as Error).message}`,
            type: "processing_error",
            code: "EXTRACTION_FAILED"
          }
        });
      }
    } else {
      originalText = buffer.toString("utf8");
    }

    const detection = modules.detectionEngine.detect({ fileName: filename, content: originalText });
    const policyDecision = modules.policyEngine.evaluate(detection);

    if (policyDecision.action === "block") {
      return reply.code(403).send({
        error: { message: "File blocked by LLMask policy", type: "access_error", code: "POLICY_BLOCKED" }
      });
    }

    const rewrite = modules.rewriteEngine.rewriteUnknownPayload(
      { content: originalText },
      detection,
      { scopeId }
    );

    const rewritten = (rewrite.rewrittenPayload as Record<string, unknown>)?.content;
    const anonymizedText = typeof rewritten === "string" ? rewritten : originalText;

    return reply.code(200).send({
      status: "ok",
      fileName: filename,
      scopeId,
      type: isDocumentFile(ext) ? "document" : "text",
      transformedCount: rewrite.transformedCount,
      originalSize: buffer.length,
      ...extractionMeta,
      anonymizedContent: anonymizedText
    });
  });

  // ── Dashboard (core: session logs & mappings) ──────────────────────
  registerDashboardRoutes(server, {
    mappingStore: modules.mappingStore,
    rewriteEngine: modules.rewriteEngine,
    remapEngine: modules.remapEngine,
    detectionEngine: modules.detectionEngine,
    providerRouter: modules.providerRouter,
    requestTimeoutMs: config.requestTimeoutMs,
    shieldTerms: modules.shieldTerms,
    adminKey: config.adminKey,
  });

  return server;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function isPrivateRequest(request: FastifyRequest): boolean {
  const xff = request.headers["x-forwarded-for"];
  const forwarded = Array.isArray(xff) ? xff[0] : xff;
  const firstForwardedIp = typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : undefined;

  const ip = firstForwardedIp || request.ip || request.socket.remoteAddress || "";
  return isPrivateIp(ip);
}

function isPrivateIp(ip: string): boolean {
  const normalized = ip.replace(/^::ffff:/, "").toLowerCase();
  if (normalized === "::1" || normalized === "127.0.0.1" || normalized === "localhost") return true;
  if (normalized.startsWith("10.")) return true;
  if (normalized.startsWith("192.168.")) return true;
  if (normalized.startsWith("172.")) {
    const second = Number(normalized.split(".")[1]);
    return second >= 16 && second <= 31;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local IPv6
  return false;
}

function getFileExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx < 0) return "";
  return filename.slice(idx).toLowerCase();
}
