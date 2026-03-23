import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import multipart from "@fastify/multipart";
import { randomUUID } from "node:crypto";
import { buildModules } from "./app/modules";
import { registerDashboardRoutes } from "./modules/dashboard/dashboard-routes";
import { registerEnterprise, type EnterpriseServices } from "./enterprise/index";
import type { AppConfig } from "./shared/config";
import { stripImageMetadata, describeImageMetadata } from "./shared/image-sanitizer";
import { extractText, isSupportedFile, isTextFile, isDocumentFile, isImageFile } from "./shared/file-extractors";
import { validateLicense, type Tier } from "./licensing/license";
import { createTierGuard } from "./licensing/tier-guard";
import { AlertStore } from "./modules/alerts/alert-store";
import { AlertManager, type AlertManagerConfig } from "./modules/alerts/alert-manager";
import { RateLimiter } from "./modules/auth/rate-limiter";
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

// Extend Fastify request to carry tenant info
declare module "fastify" {
  interface FastifyRequest {
    tenant?: import("./modules/auth/auth-service").Tenant;
  }
}

export function buildServer(config: AppConfig): FastifyInstance {
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

  // ── License & tier resolution ──────────────────────────────────────
  const licenseInfo = validateLicense({
    licenseKey: config.licenseKey || undefined,
    licenseFile: config.licenseFile || undefined,
  });

  // License key overrides config edition; if no license, use config edition
  const tier: Tier = licenseInfo.valid && licenseInfo.tier !== "community"
    ? licenseInfo.tier
    : config.edition === "enterprise" ? "enterprise"
    : config.edition === "pro" ? "pro"
    : "community";

  if (licenseInfo.valid && licenseInfo.tier !== "community") {
    server.log.info({ tier, org: licenseInfo.org, expiresAt: licenseInfo.expiresAt?.toISOString() }, "License validated");
  } else if (!licenseInfo.valid && licenseInfo.reason) {
    server.log.warn({ reason: licenseInfo.reason }, "License invalid — running as community");
  }

  server.log.info({ tier }, `LLMask running as ${tier}`);

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

  // ── Health ─────────────────────────────────────────────────────────
  server.get("/health", async () => ({
    status: "ok",
    service: "llmask",
    tier,
    edition: tier, // backward compat
    mode: config.llmaskMode,
    primaryProvider: config.primaryProvider,
    fallbackProvider: config.fallbackProvider ?? "none",
    authEnabled: config.authEnabled,
    uptime: Math.round(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024)
  }));

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

  // ── Tier guard (gates routes by tier) ─────────────────────────────
  server.addHook("onRequest", createTierGuard(tier));

  // ── Enterprise features (conditional on tier) ─────────────────────
  let enterprise: EnterpriseServices = { authService: null, rateLimiter: null as any, oidcProvider: null };

  if (tier === "enterprise") {
    enterprise = registerEnterprise(server, {
      config,
      mappingStore: modules.mappingStore,
      shieldTerms: modules.shieldTerms
    });
  } else {
    server.log.info({ tier }, "Enterprise features disabled");
  }

  // ── Auth middleware for proxy routes ────────────────────────────────
  // Works in both editions: enterprise uses full tenant auth,
  // OSS skips (no auth required)
  const authMiddleware = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!enterprise.authService) return; // auth disabled or OSS edition

    // Try API key first (for machines: Copilot, CLI, etc.)
    const apiKey = extractApiKey(request);

    // If no API key, try JWT/OIDC (for humans: dashboard, SSO)
    if (!apiKey && enterprise.oidcProvider) {
      const bearer = extractBearerToken(request);
      if (bearer) {
        const oidcResult = await enterprise.oidcProvider.authenticate(bearer);
        if (oidcResult.ok) {
          // OIDC user authenticated — map to a tenant or create an implicit one
          request.tenant = {
            id: `oidc:${oidcResult.claims.sub}`,
            name: oidcResult.claims.name || oidcResult.claims.email || oidcResult.claims.sub,
            apiKey: "",
            rateLimit: 0,
            enabled: true,
            createdAt: new Date().toISOString(),
          };
          return;
        }
        // OIDC failed — fall through to API key error
      }
    }

    if (!apiKey) {
      return reply.code(401).send({
        error: { message: "Missing API key. Set the x-llmask-key header or provide a valid JWT.", type: "authentication_error", code: "MISSING_API_KEY" }
      });
    }

    const result = enterprise.authService.authenticate(apiKey);
    if (!result.ok) {
      return reply.code(401).send({
        error: { message: result.reason, type: "authentication_error", code: "INVALID_API_KEY" }
      });
    }

    // Rate limiting (enterprise only)
    if (enterprise.rateLimiter) {
      const { allowed, remaining, resetMs } = enterprise.rateLimiter.check(result.tenant.id, result.tenant.rateLimit);
      if (!allowed) {
        reply.header("retry-after", String(Math.ceil(resetMs / 1000)));
        reply.header("x-ratelimit-limit", String(result.tenant.rateLimit));
        reply.header("x-ratelimit-remaining", "0");
        return reply.code(429).send({
          error: { message: "Rate limit exceeded. Try again later.", type: "rate_limit_error", code: "RATE_LIMITED" }
        });
      }
      if (result.tenant.rateLimit > 0) {
        reply.header("x-ratelimit-limit", String(result.tenant.rateLimit));
        reply.header("x-ratelimit-remaining", String(remaining));
      }
    }

    request.tenant = result.tenant;
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

  // ── Alerts ───────────────────────────────────────────────────────────
  const alertStore = new AlertStore(modules.mappingStore.getDb());
  alertStore.initialize();

  // Parse alert configuration from environment
  const alertConfig: AlertManagerConfig = {
    enabled: process.env.ALERTS_ENABLED === "true",
    channels: (process.env.ALERTS_CHANNELS || "console").split(",").map(c => c.trim()),
    webhookUrl: process.env.ALERTS_WEBHOOK_URL,
    webhookHeaders: process.env.ALERTS_WEBHOOK_HEADERS 
      ? JSON.parse(process.env.ALERTS_WEBHOOK_HEADERS) 
      : undefined,
    emailHost: process.env.ALERTS_EMAIL_HOST,
    emailPort: process.env.ALERTS_EMAIL_PORT ? parseInt(process.env.ALERTS_EMAIL_PORT, 10) : 587,
    emailSecure: process.env.ALERTS_EMAIL_SECURE === "true",
    emailUser: process.env.ALERTS_EMAIL_USER,
    emailPass: process.env.ALERTS_EMAIL_PASS,
    emailFrom: process.env.ALERTS_EMAIL_FROM,
    emailTo: process.env.ALERTS_EMAIL_TO,
    discordWebhook: process.env.ALERTS_DISCORD_WEBHOOK,
    slackWebhook: process.env.ALERTS_SLACK_WEBHOOK,
  };

  const alertManager = new AlertManager(
    alertConfig,
    alertStore,
    server.log,
    {
      getLeakCount: () => {
        try { return modules.mappingStore.scanLeaksCached(modules.shieldTerms).requestLeaks; }
        catch { return 0; }
      },
    }
  );

  // Start alert manager (evaluation every 60s)
  alertManager.start(60_000);
  server.addHook("onClose", () => alertManager.stop());

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
    tier,
    alertStore,
    alertEngine: alertManager as any, // Backward compatibility
    onPolicyBlock: () => { alertManager.recordBlock(); },
  });

  return server;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function extractApiKey(request: FastifyRequest): string | undefined {
  const llmaskKey = request.headers["x-llmask-key"];
  if (llmaskKey) return Array.isArray(llmaskKey) ? llmaskKey[0] : llmaskKey;

  const auth = request.headers.authorization;
  if (auth && typeof auth === "string" && auth.startsWith("Bearer llmask_")) {
    return auth.slice(7);
  }

  return undefined;
}

function extractBearerToken(request: FastifyRequest): string | undefined {
  const auth = request.headers.authorization;
  if (auth && typeof auth === "string" && auth.startsWith("Bearer ") && !auth.startsWith("Bearer llmask_")) {
    return auth.slice(7);
  }
  return undefined;
}

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
