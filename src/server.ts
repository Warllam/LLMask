import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import multipart from "@fastify/multipart";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { buildModules } from "./app/modules";
import { registerDashboardRoutes } from "./modules/dashboard/dashboard-routes";
import { registerGdprRoutes } from "./modules/dashboard/gdpr-routes";
import { UserAuthService } from "./modules/users/user-auth";
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

export async function buildServer(config: AppConfig): Promise<FastifyInstance> {
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

  // ── User auth service ─────────────────────────────────────────────
  const jwtSecret = config.jwtSecret || randomBytes(32).toString("hex");
  if (!config.jwtSecret) {
    server.log.warn("LLMASK_JWT_SECRET not set — using a random secret (tokens invalidated on restart)");
  }
  const userAuth = new UserAuthService(modules.userStore, jwtSecret);

  // Seed default admin on first run
  if (!modules.userStore.hasUsers()) {
    const adminUsername = config.adminUser || "admin";
    const adminPassword = config.adminPassword || randomBytes(12).toString("hex");
    const passwordHash = await userAuth.hashPassword(adminPassword);
    modules.userStore.createUser(randomUUID(), adminUsername, passwordHash, "admin");
    server.log.info(
      { username: adminUsername },
      `Default admin created — username: ${adminUsername}  password: ${adminPassword}`
    );
    if (!config.adminPassword) {
      // Print prominently to console since this is the first-run credential
      console.log("\n========================================");
      console.log("  LLMask: default admin credentials");
      console.log(`  Username: ${adminUsername}`);
      console.log(`  Password: ${adminPassword}`);
      console.log("  (set LLMASK_ADMIN_PASSWORD to use a fixed password)");
      console.log("========================================\n");
    }
  }

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

  // ── OpenAPI / Swagger UI ───────────────────────────────────────────────
  const openapiYamlPath = resolve(join(process.cwd(), "docs", "openapi.yaml"));
  const openapiYaml = existsSync(openapiYamlPath) ? readFileSync(openapiYamlPath, "utf-8") : null;

  if (openapiYaml) {
    server.get("/openapi.yaml", async (_request, reply) => {
      return reply
        .code(200)
        .header("Content-Type", "application/yaml; charset=utf-8")
        .header("Access-Control-Allow-Origin", "*")
        .send(openapiYaml);
    });

    const swaggerUiHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>LLMask API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>body { margin: 0; } .topbar { display: none; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: "/openapi.yaml",
      dom_id: "#swagger-ui",
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: "BaseLayout",
      deepLinking: true,
    });
  </script>
</body>
</html>`;

    server.get("/docs", async (_request, reply) => {
      return reply.code(200).header("Content-Type", "text/html; charset=utf-8").send(swaggerUiHtml);
    });

    server.log.info("API docs available at /docs (Swagger UI) and /openapi.yaml");
  }

  // ── Health ─────────────────────────────────────────────────────────
  server.get("/health", async () => ({
    status: "ok",
    service: "llmask",
    tier: "community",
    edition: "community",
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

  // ── Browser extension: text mask / remap ─────────────────────────────
  // These lightweight endpoints are called by the LLMask Chrome extension via
  // its background service worker. They mask plain text (no file upload, no
  // LLM proxy) and return the pseudonym → original mappings for response remap.
  //
  // CORS headers are added so the extension origin is accepted.

  const extensionCorsHeaders = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  } as const;

  // Preflight for both routes
  server.options("/v1/text/mask", async (_request, reply) => {
    return reply.code(204).headers(extensionCorsHeaders).send();
  });

  server.options("/v1/text/remap", async (_request, reply) => {
    return reply.code(204).headers(extensionCorsHeaders).send();
  });

  server.post("/v1/text/mask", async (request, reply) => {
    reply.headers(extensionCorsHeaders);

    const body = request.body as { text?: unknown; scope_id?: unknown } | null;
    if (!body?.text || typeof body.text !== "string") {
      return reply.code(400).send({
        error: { message: "Missing or invalid 'text' field", type: "invalid_request_error", code: "MISSING_TEXT" }
      });
    }

    const scopeId = typeof body.scope_id === "string" && body.scope_id ? body.scope_id : randomUUID();
    const detection = modules.detectionEngine.detect({ fileName: "browser-input.txt", content: body.text });
    const rewrite = modules.rewriteEngine.rewriteUnknownPayload(
      { content: body.text },
      detection,
      { scopeId }
    );

    const rewrittenContent = (rewrite.rewrittenPayload as Record<string, unknown>)?.content;
    const maskedText = typeof rewrittenContent === "string" ? rewrittenContent : body.text;

    return reply.code(200).send({
      masked_text: maskedText,
      scope_id: scopeId,
      entity_count: rewrite.transformedCount,
    });
  });

  server.post("/v1/text/remap", async (request, reply) => {
    reply.headers(extensionCorsHeaders);

    const body = request.body as { scope_id?: unknown; text?: unknown } | null;
    if (!body?.scope_id || typeof body.scope_id !== "string") {
      return reply.code(400).send({
        error: { message: "Missing or invalid 'scope_id' field", type: "invalid_request_error", code: "MISSING_SCOPE_ID" }
      });
    }

    const mappings = modules.mappingStore.listMappings(body.scope_id);
    const replacements = mappings
      .map((entry) => ({ from: entry.pseudonym, to: entry.originalValue }))
      // Sort longest pseudonym first so partial-match replacements can't interfere
      .sort((a, b) => b.from.length - a.from.length);

    // Optionally also remap a provided text string
    let remappedText: string | undefined;
    if (typeof body.text === "string" && body.text) {
      const remapped = modules.remapEngine.remapJsonResponse({ content: body.text }, body.scope_id, mappings);
      const remappedContent = (remapped as Record<string, unknown>)?.content;
      remappedText = typeof remappedContent === "string" ? remappedContent : body.text;
    }

    return reply.code(200).send({
      replacements,
      ...(remappedText !== undefined && { remapped_text: remappedText }),
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
    userStore: modules.userStore,
    userAuth,
  });

  // ── GDPR routes (audit log, erasure, export, retention) ────────────
  registerGdprRoutes(server, {
    mappingStore: modules.mappingStore,
    retentionDays: config.gdprRetentionDays,
  });

  // ── Data retention cleanup job ──────────────────────────────────────
  // Runs once on startup and every 24h to delete old data (GDPR Article 5(e))
  if (config.gdprRetentionDays > 0) {
    const runRetention = () => {
      try {
        const result = modules.mappingStore.deleteOlderThan(config.gdprRetentionDays);
        if (result.deletedRequests > 0 || result.deletedMappings > 0) {
          server.log.info(
            { retentionDays: config.gdprRetentionDays, ...result },
            "GDPR retention cleanup completed"
          );
        }
      } catch (err) {
        server.log.error({ err }, "GDPR retention cleanup failed");
      }
    };

    // Run on startup
    setImmediate(runRetention);

    // Re-run every 24h
    const retentionInterval = setInterval(runRetention, 24 * 60 * 60 * 1000);
    server.addHook("onClose", () => clearInterval(retentionInterval));

    server.log.info({ retentionDays: config.gdprRetentionDays }, "GDPR data retention enabled");
  }

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
