import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from "fastify";
import {
  chatCompletionsRequestSchema,
  type ChatCompletionsRequest
} from "../../contracts/openai";
import type { AppConfig } from "../../shared/config";
import { openAiError } from "../../shared/http-errors";
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
import { extractTextFromContent } from "../../shared/content-utils";
import { liveBus } from "../dashboard/live-events";
import {
  recordRequestMetrics,
  recordEntityDetection,
  recordEntityMasking,
  recordRewrite,
  extractTokenUsage,
} from "../../shared/metrics";
import {
  startTimer,
  recordMaskingDuration,
  recordDetectionDuration,
  recordPiiDetectionsByType,
  recordPipelineDuration,
  recordStreamingDuration,
  setMappingStoreSize,
} from "../metrics/prometheus-metrics";

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

export class ChatCompletionsProxyRoute {
  constructor(private readonly deps: Dependencies) {}

  async handle(request: FastifyRequest, reply: FastifyReply) {
    const traceId = getTraceId(request);
    const requestId = request.id;

    let parsedBody: ChatCompletionsRequest;
    try {
      parsedBody = chatCompletionsRequestSchema.parse(request.body);
    } catch (error) {
      const invalid = openAiError(400, "Invalid request payload", "invalid_request_error", "INVALID_BODY");
      this.deps.auditService.record({
        eventName: "llmask.proxy.request.invalid.v1",
        requestId,
        traceId,
        data: { error: error instanceof Error ? error.message : "unknown" }
      });
      return reply.code(invalid.statusCode).send(invalid.body);
    }

    try {
      this.deps.auditService.record({
        eventName: "llmask.proxy.request.received.v1",
        requestId,
        traceId,
        provider: this.deps.config.primaryProvider,
        data: { stream: Boolean(parsedBody.stream), model: parsedBody.model }
      });

      const pipelineTimer = startTimer();
      const detectionTimer = startTimer();
      const detection = this.deps.detectionEngine.detect(parsedBody);
      recordDetectionDuration(this.deps.config.primaryProvider, detectionTimer());
      const decision = this.deps.policyEngine.evaluate(detection);

      // Record entity detection metrics
      recordEntityDetection(detection.findings);
      recordPiiDetectionsByType(detection.findings, this.deps.config.primaryProvider);

      this.deps.auditService.record({
        eventName: "llmask.policy.decision.made.v1",
        requestId,
        traceId,
        provider: this.deps.config.primaryProvider,
        policyAction: decision.action,
        data: {
          findingsCount: detection.findings.length,
          reason: decision.reason,
          categories: [...new Set(detection.findings.map((f) => f.category))]
        }
      });

      if (decision.action === "block") {
        const blocked = openAiError(403, "Request blocked by LLMASK policy", "access_error", "POLICY_BLOCKED");
        return reply.code(blocked.statusCode).send(blocked.body);
      }

      // Collect user message text for analysis (truncate for LLM to avoid slow Ollama calls)
      const allTextRaw = parsedBody.messages
        .filter((m) => m.content !== undefined && m.role !== "system" && m.role !== "developer")
        .map((m) => extractTextFromContent(m.content))
        .filter(Boolean)
        .join("\n");
      const allText = allTextRaw.length > 8000 ? allTextRaw.slice(0, 8000) : allTextRaw;

      // Run AST classification and LLM entity extraction in parallel (both optional, best-effort)
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
            const result = await this.deps.llmExtractor.extract(allText);
            if (result.entities.length > 0) {
              this.deps.logger.info(
                { entities: result.entities.length, cached: result.fromCache, durationMs: result.durationMs },
                "LLM entity extraction completed"
              );
            }
            return result;
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

      const maskTimer = startTimer();
      const rewrite = this.deps.rewriteEngine.rewriteRequest(
        parsedBody, detection, { scopeId: traceId },
        astHints, llmResult?.entities,
        semanticPseudonyms ? { semanticPseudonyms } : undefined
      );
      recordMaskingDuration(this.deps.config.primaryProvider, "chat-completions", maskTimer());

      // Record entity masking metrics
      recordEntityMasking(rewrite.transformedCount);
      recordRewrite();
      try { setMappingStoreSize(this.deps.mappingStore.getStats().totalMappings); } catch { /* best-effort */ }

      const logId = this.deps.mappingStore.insertRequestLog({
        traceId,
        requestId,
        endpoint: "chat-completions",
        model: parsedBody.model,
        originalBody: JSON.stringify(parsedBody),
        rewrittenBody: JSON.stringify(rewrite.rewrittenRequest),
        transformedCount: rewrite.transformedCount
      });

      liveBus.emit("masking", {
        timestamp: new Date().toISOString(),
        endpoint: "/v1/chat/completions",
        model: parsedBody.model,
        transformedCount: rewrite.transformedCount,
        entityKinds: [...new Set(detection.findings.map(f => f.category))],
        scopeId: traceId,
      });

      const { response: upstream, adapter } = await this.deps.providerRouter.forward({
        endpointKind: "chat-completions",
        body: rewrite.rewrittenRequest,
        incomingAuthHeader: getHeaderValue(request.headers.authorization),
        incomingHeaders: extractForwardableHeaders(request.headers),
        requestId,
        traceId
      });

      // Detect actual response format: the adapter may have forced streaming (Codex requires it)
      const upstreamContentType = upstream.headers.get("content-type") ?? "";
      const isActuallyStreaming =
        upstreamContentType.includes("text/event-stream") ||
        upstreamContentType.includes("text/plain") ||
        upstreamContentType.includes("application/x-ndjson") ||
        (upstreamContentType === "" && upstream.ok);

      this.deps.logger.info(
        { traceId, requestId, upstreamContentType, isActuallyStreaming, status: upstream.status },
        "upstream response received"
      );

      if (isActuallyStreaming) {
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
      this.deps.logger.error(
        {
          err: error,
          traceId,
          requestId
        },
        "proxy pipeline failed"
      );

      this.deps.auditService.record({
        eventName: "llmask.proxy.pipeline.failed.v1",
        requestId,
        traceId,
        policyAction: "block",
        data: { failSafeBlock: this.deps.config.failSafeBlockOnError }
      });

      if (this.deps.config.failSafeBlockOnError) {
        const blocked = openAiError(
          502,
          "LLMASK fail-safe blocked request due to pipeline error",
          "server_error",
          "LLMASK_FAIL_SAFE"
        );
        return reply.code(blocked.statusCode).send(blocked.body);
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
      this.deps.auditService.record({
        eventName: "llmask.provider.response.error.v1",
        requestId: context.requestId,
        traceId: context.traceId,
        data: { status }
      });
      return reply
        .code(status)
        .header("content-type", contentType)
        .send(errorText);
    }

    const rawJson = (await upstream.json()) as unknown;
    const translatedJson = adapter.translateJsonResponse(rawJson, "chat-completions");
    const remapped = this.deps.remapEngine.remapJsonResponse(translatedJson, context.scopeId);

    // Extract token usage and record metrics
    const tokenUsage = extractTokenUsage(translatedJson);
    recordRequestMetrics({
      provider: this.deps.config.primaryProvider,
      model: String((translatedJson as any)?.model || "unknown"),
      status: String(status),
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
    });

    // Store remapped response for dashboard
    try {
      const responseText = extractAssistantText(remapped);
      if (responseText) {
        this.deps.mappingStore.updateResponseBody(context.logId, responseText);
      }
    } catch { /* non-critical */ }

    this.deps.auditService.record({
      eventName: "llmask.proxy.response.completed.v1",
      requestId: context.requestId,
      traceId: context.traceId,
      data: {
        status,
        streaming: false,
        transformedCount: context.transformedCount
      }
    });

    return reply
      .code(status)
      .header("content-type", "application/json")
      .send(remapped);
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
      const err = openAiError(502, "Upstream provider returned empty stream body", "server_error", "EMPTY_STREAM");
      return reply.code(err.statusCode).send(err.body);
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
    const sseTranslation = adapter.createSseTranslationTransform("chat-completions");
    const remapTransform = this.deps.remapEngine.createEventLevelSseTransform(context.scopeId);

    request.raw.once("close", () => {
      upstreamReadable.destroy();
    });

    this.deps.auditService.record({
      eventName: "llmask.proxy.response.streaming_started.v1",
      requestId: context.requestId,
      traceId: context.traceId,
      data: { transformedCount: context.transformedCount }
    });

    try {
      await pipeline(upstreamReadable, sseTranslation, remapTransform, raw);

      // Store captured response text for dashboard
      try {
        const capturedText = remapTransform.getCapturedText();
        if (capturedText) {
          this.deps.mappingStore.updateResponseBody(context.logId, capturedText);
        }
      } catch { /* non-critical */ }

      // Record metrics for streaming response (no token count available in streams usually)
      recordRequestMetrics({
        provider: this.deps.config.primaryProvider,
        model: "unknown", // streaming responses don't always include model in chunks
        status: String(upstream.status),
      });

      this.deps.auditService.record({
        eventName: "llmask.proxy.response.completed.v1",
        requestId: context.requestId,
        traceId: context.traceId,
        data: {
          status: upstream.status,
          streaming: true,
          transformedCount: context.transformedCount
        }
      });
    } catch (error) {
      // Still try to save partial response
      try {
        const capturedText = remapTransform.getCapturedText();
        if (capturedText) {
          this.deps.mappingStore.updateResponseBody(context.logId, capturedText);
        }
      } catch { /* non-critical */ }

      this.deps.logger.warn(
        {
          err: error,
          requestId: context.requestId,
          traceId: context.traceId
        },
        "streaming pipeline terminated"
      );
    }

    return reply;
  }
}

// getTraceId imported from ../../shared/trace-id

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
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

/** Extract assistant text from a chat-completions JSON response. */
function extractAssistantText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const rec = payload as Record<string, unknown>;
  if (!Array.isArray(rec.choices)) return null;
  const choice = rec.choices[0] as Record<string, unknown> | undefined;
  if (!choice?.message || typeof choice.message !== "object") return null;
  const message = choice.message as Record<string, unknown>;
  return typeof message.content === "string" ? message.content : null;
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
