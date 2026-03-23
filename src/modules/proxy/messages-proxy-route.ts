import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../shared/config";
import type { AuditService } from "../audit/audit-service";
import type { DetectionEngine } from "../detection/detection-engine";
import type { PolicyEngine } from "../policy/policy-engine";
import type { ProviderRouter } from "../provider-adapter/provider-router";
import type { ResponseRemapEngine } from "../remap/response-remap-engine";
import type { MappingStore } from "../mapping-store/mapping-store";
import type { RewriteEngineV4 as RewriteEngine } from "../rewrite/rewrite-engine-v4";
import type { AstClassifier } from "../ast/ast-classifier";
import type { LlmEntityExtractor } from "../llm-extractor/llm-entity-extractor";
import { getTraceId } from "../../shared/trace-id";
import { liveBus } from "../dashboard/live-events";
import {
  recordRequestMetrics,
  recordEntityDetection,
  recordEntityMasking,
  recordRewrite,
  extractTokenUsage,
} from "../../shared/metrics";

// Minimal Anthropic Messages schema — passthrough keeps all extra fields
const messagesRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(z.object({
    role: z.string(),
    content: z.unknown()
  }).passthrough()).min(1),
  stream: z.boolean().optional().default(false)
}).passthrough();

export type MessagesRequest = z.infer<typeof messagesRequestSchema>;

type Dependencies = {
  config: AppConfig;
  logger: FastifyBaseLogger;
  auditService: AuditService;
  detectionEngine: DetectionEngine;
  policyEngine: PolicyEngine;
  rewriteEngine: RewriteEngine;
  remapEngine: ResponseRemapEngine;
  providerRouter: ProviderRouter;
  mappingStore: MappingStore;
  astClassifier?: AstClassifier;
  llmExtractor?: LlmEntityExtractor;
};

export class MessagesProxyRoute {
  constructor(private readonly deps: Dependencies) {}

  async handle(request: FastifyRequest, reply: FastifyReply) {
    const traceId = getTraceId(request);
    const requestId = request.id;

    let parsedBody: MessagesRequest;
    try {
      parsedBody = messagesRequestSchema.parse(request.body);
    } catch (error) {
      this.deps.auditService.record({
        eventName: "llmask.messages.request.invalid.v1",
        requestId,
        traceId,
        data: { error: error instanceof Error ? error.message : "unknown" }
      });
      return reply.code(400).send({
        type: "error",
        error: { type: "invalid_request_error", message: "Invalid messages payload" }
      });
    }

    try {
      const t0 = performance.now();

      this.deps.auditService.record({
        eventName: "llmask.messages.request.received.v1",
        requestId,
        traceId,
        provider: "anthropic",
        data: { stream: Boolean(parsedBody.stream), model: parsedBody.model }
      });

      const detection = this.deps.detectionEngine.detect(parsedBody);
      const decision = this.deps.policyEngine.evaluate(detection);
      const t1 = performance.now();

      // Record entity detection metrics
      recordEntityDetection(detection.findings);

      this.deps.auditService.record({
        eventName: "llmask.policy.decision.made.v1",
        requestId,
        traceId,
        provider: "anthropic",
        policyAction: decision.action,
        data: {
          endpoint: "messages",
          findingsCount: detection.findings.length,
          reason: decision.reason,
          categories: [...new Set(detection.findings.map((f) => f.category))]
        }
      });

      if (decision.action === "block") {
        return reply.code(403).send({
          type: "error",
          error: { type: "permission_error", message: "Request blocked by LLMASK policy" }
        });
      }

      // Collect text for analysis (truncate for LLM to avoid slow Ollama calls)
      const allTextRaw = parsedBody.messages
        .filter((m) => typeof m.content === "string" && m.role !== "system")
        .map((m) => m.content as string)
        .join("\n");
      const allText = allTextRaw.length > 8000 ? allTextRaw.slice(0, 8000) : allTextRaw;

      // Run AST classification and LLM entity extraction in parallel
      const [astHints, llmResult] = await Promise.all([
        (async () => {
          if (!this.deps.astClassifier) return undefined;
          try {
            return await this.deps.astClassifier.classifyTokens(allText);
          } catch {
            return undefined;
          }
        })(),
        (async () => {
          if (!this.deps.llmExtractor?.enabled) return undefined;
          try {
            return await this.deps.llmExtractor.extract(allText);
          } catch {
            return undefined;
          }
        })()
      ]);

      // Prepare semantic pseudonyms via Ollama (fail-open)
      let semanticPseudonyms: Map<string, string> | undefined;
      if (this.deps.llmExtractor?.enabled) {
        try {
          semanticPseudonyms = await this.deps.rewriteEngine.prepareSemanticPseudonyms(
            allText, this.deps.llmExtractor, astHints, llmResult?.entities
          );
        } catch { /* fail-open */ }
      }

      const rewrite = this.deps.rewriteEngine.rewriteUnknownPayload(
        parsedBody, detection, { scopeId: traceId },
        astHints, llmResult?.entities,
        semanticPseudonyms ? { semanticPseudonyms } : undefined
      );
      const t2 = performance.now();

      // Record entity masking metrics
      recordEntityMasking(rewrite.transformedCount);
      recordRewrite();

      const originalJson = JSON.stringify(parsedBody);
      const rewrittenJson = JSON.stringify(rewrite.rewrittenPayload);

      const logId = this.deps.mappingStore.insertRequestLog({
        traceId,
        requestId,
        endpoint: "messages",
        model: parsedBody.model,
        originalBody: originalJson,
        rewrittenBody: rewrittenJson,
        transformedCount: rewrite.transformedCount
      });
      liveBus.emit("masking", {
        timestamp: new Date().toISOString(),
        endpoint: "/v1/messages",
        model: parsedBody.model,
        transformedCount: rewrite.transformedCount,
        entityKinds: [...new Set(detection.findings.map(f => f.category))],
        scopeId: traceId,
      });

      const t3 = performance.now();

      this.deps.logger.info(
        {
          traceId,
          requestId,
          timings: {
            detectPolicyMs: Math.round(t1 - t0),
            rewriteMs: Math.round(t2 - t1),
            dbInsertMs: Math.round(t3 - t2),
            totalPreForwardMs: Math.round(t3 - t0)
          },
          payloadSizeKb: Math.round(originalJson.length / 1024),
          rewrittenSizeKb: Math.round(rewrittenJson.length / 1024),
          transformedCount: rewrite.transformedCount
        },
        "llmask messages pipeline timings"
      );

      // Extract auth header to pass through to Anthropic (OAuth Bearer or x-api-key)
      const incomingAuth =
        getHeaderValue(request.headers.authorization) ??
        getHeaderValue(request.headers["x-api-key"] as string | string[] | undefined);

      const { response: upstream, adapter } = await this.deps.providerRouter.forward({
        endpointKind: "messages",
        body: rewrite.rewrittenPayload,
        incomingAuthHeader: incomingAuth,
        incomingHeaders: extractForwardableHeaders(request.headers),
        requestId,
        traceId
      });
      const t4 = performance.now();
      this.deps.logger.info(
        { traceId, requestId, forwardMs: Math.round(t4 - t3), upstreamStatus: upstream.status },
        "llmask messages upstream response received"
      );

      if (parsedBody.stream) {
        return this.handleStreamingResponse(request, reply, upstream, adapter, {
          requestId,
          traceId,
          transformedCount: rewrite.transformedCount,
          scopeId: traceId,
          logId
        });
      }

      return this.handleJsonResponse(reply, upstream, adapter, {
        requestId,
        traceId,
        transformedCount: rewrite.transformedCount,
        scopeId: traceId,
        logId
      });
    } catch (error) {
      this.deps.logger.error({ err: error, traceId, requestId }, "messages proxy pipeline failed");

      this.deps.auditService.record({
        eventName: "llmask.messages.pipeline.failed.v1",
        requestId,
        traceId,
        policyAction: "block",
        data: { failSafeBlock: this.deps.config.failSafeBlockOnError }
      });

      if (this.deps.config.failSafeBlockOnError) {
        return reply.code(502).send({
          type: "error",
          error: { type: "api_error", message: "LLMASK fail-safe blocked request due to pipeline error" }
        });
      }

      throw error;
    }
  }

  private async handleJsonResponse(
    reply: FastifyReply,
    upstream: Response,
    adapter: import("../provider-adapter/types").ProviderAdapter,
    context: { requestId: string; traceId: string; transformedCount: number; scopeId: string; logId: number }
  ) {
    const contentType = upstream.headers.get("content-type") ?? "application/json";
    const status = upstream.status;

    if (!upstream.ok) {
      const errorText = await upstream.text();
      return reply.code(status).header("content-type", contentType).send(errorText);
    }

    const rawJson = (await upstream.json()) as unknown;
    const translatedJson = adapter.translateJsonResponse(rawJson, "messages");
    const remapped = this.deps.remapEngine.remapJsonResponse(translatedJson, context.scopeId);

    // Extract token usage and record metrics
    const tokenUsage = extractTokenUsage(translatedJson);
    recordRequestMetrics({
      provider: "anthropic",
      model: String((translatedJson as any)?.model || "unknown"),
      status: String(status),
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
    });

    // Store response for dashboard
    try {
      const text = extractAnthropicText(remapped);
      if (text) this.deps.mappingStore.updateResponseBody(context.logId, text);
    } catch { /* non-critical */ }

    this.deps.auditService.record({
      eventName: "llmask.messages.completed.v1",
      requestId: context.requestId,
      traceId: context.traceId,
      data: { status, streaming: false, transformedCount: context.transformedCount }
    });

    return reply.code(status).header("content-type", "application/json").send(remapped);
  }

  private async handleStreamingResponse(
    request: FastifyRequest,
    reply: FastifyReply,
    upstream: Response,
    adapter: import("../provider-adapter/types").ProviderAdapter,
    context: { requestId: string; traceId: string; transformedCount: number; scopeId: string; logId: number }
  ) {
    const body = upstream.body;
    if (!body) {
      return reply.code(502).send({
        type: "error",
        error: { type: "api_error", message: "Upstream provider returned empty stream body" }
      });
    }

    if (!upstream.ok) {
      const errorText = await upstream.text();
      return reply
        .code(upstream.status)
        .header("content-type", upstream.headers.get("content-type") ?? "application/json")
        .send(errorText);
    }

    reply.hijack();
    const raw = reply.raw;
    raw.statusCode = upstream.status;
    applyUpstreamHeaders(raw, upstream.headers);

    const upstreamReadable = Readable.fromWeb(body as any);
    const sseTranslation = adapter.createSseTranslationTransform("messages");
    const remapTransform = this.deps.remapEngine.createEventLevelSseTransform(context.scopeId);

    request.raw.once("close", () => {
      upstreamReadable.destroy();
    });

    this.deps.auditService.record({
      eventName: "llmask.messages.streaming_started.v1",
      requestId: context.requestId,
      traceId: context.traceId,
      data: { transformedCount: context.transformedCount }
    });

    try {
      await pipeline(upstreamReadable, sseTranslation, remapTransform, raw);

      // Record metrics for streaming response
      recordRequestMetrics({
        provider: "anthropic",
        model: "unknown", // streaming doesn't always include model
        status: String(upstream.status),
      });

      try {
        const capturedText = remapTransform.getCapturedText();
        if (capturedText) this.deps.mappingStore.updateResponseBody(context.logId, capturedText);
      } catch { /* non-critical */ }
    } catch (error) {
      try {
        const capturedText = remapTransform.getCapturedText();
        if (capturedText) this.deps.mappingStore.updateResponseBody(context.logId, capturedText);
      } catch { /* non-critical */ }
      this.deps.logger.warn(
        { err: error, traceId: context.traceId, requestId: context.requestId },
        "messages streaming pipeline terminated"
      );
    }

    return reply;
  }
}

// getTraceId imported from ../../shared/trace-id

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Extract headers that should be forwarded to the provider adapter.
 * Used for LiteLLM and other proxies that need client headers.
 */
function extractForwardableHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  const headersToForward = [
    "x-litellm-api-key",
    "x-api-key",
    "anthropic-version",
    "openai-organization",
    "openai-project"
  ];
  
  for (const key of headersToForward) {
    const value = getHeaderValue(headers[key]);
    if (value) {
      result[key] = value;
    }
  }
  
  return result;
}

/** Extract text from an Anthropic Messages JSON response (content[].text). */
function extractAnthropicText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const rec = payload as Record<string, unknown>;
  if (!Array.isArray(rec.content)) return null;
  const parts: string[] = [];
  for (const block of rec.content) {
    if (block && typeof block === "object" && (block as Record<string, unknown>).type === "text") {
      const text = (block as Record<string, unknown>).text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.length > 0 ? parts.join("") : null;
}

function applyUpstreamHeaders(raw: import("node:http").ServerResponse, headers: Headers) {
  for (const [key, value] of headers.entries()) {
    const lower = key.toLowerCase();
    if (lower === "content-length") continue;
    if (lower === "connection") continue;
    if (lower === "keep-alive") continue;
    if (lower === "transfer-encoding") continue;
    raw.setHeader(key, value);
  }
}
