import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from "fastify";
import { responsesRequestSchema, type ResponsesRequest } from "../../contracts/openai";
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
import { liveBus } from "../dashboard/live-events";
import {
  recordRequestMetrics,
  recordEntityDetection,
  recordEntityMasking,
  recordRewrite,
  extractTokenUsage,
} from "../../shared/metrics";

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

export class ResponsesProxyRoute {
  constructor(private readonly deps: Dependencies) {}

  async handle(request: FastifyRequest, reply: FastifyReply) {
    const traceId = getTraceId(request);
    const requestId = request.id;

    let parsedBody: ResponsesRequest;
    try {
      // Apply model override: X-LLMask-Model header > request body > LLMASK_DEFAULT_MODEL
      const rawBody = { ...(request.body as Record<string, unknown>) };
      const modelHeader = getHeaderValue(request.headers["x-llmask-model"] as string | string[] | undefined);
      if (modelHeader) {
        rawBody.model = modelHeader;
      } else if (!rawBody.model) {
        rawBody.model = this.deps.config.defaultModel;
      }
      parsedBody = responsesRequestSchema.parse(rawBody);
    } catch (error) {
      const invalid = openAiError(400, "Invalid responses payload", "invalid_request_error", "INVALID_BODY");
      this.deps.auditService.record({
        eventName: "llmask.responses.request.invalid.v1",
        requestId,
        traceId,
        data: { error: error instanceof Error ? error.message : "unknown" }
      });
      return reply.code(invalid.statusCode).send(invalid.body);
    }

    try {
      const t0 = performance.now();

      this.deps.auditService.record({
        eventName: "llmask.responses.request.received.v1",
        requestId,
        traceId,
        provider: this.deps.config.primaryProvider,
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
        provider: this.deps.config.primaryProvider,
        policyAction: decision.action,
        data: {
          endpoint: "responses",
          findingsCount: detection.findings.length,
          reason: decision.reason,
          categories: [...new Set(detection.findings.map((f) => f.category))]
        }
      });

      if (decision.action === "block") {
        const blocked = openAiError(403, "Request blocked by LLMASK policy", "access_error", "POLICY_BLOCKED");
        return reply.code(blocked.statusCode).send(blocked.body);
      }

      // Collect text for analysis (truncate for LLM to avoid slow Ollama calls on huge Codex payloads)
      const payloadText = JSON.stringify(parsedBody);
      const llmText = payloadText.length > 8000 ? payloadText.slice(0, 8000) : payloadText;

      // Run AST classification and LLM entity extraction in parallel
      this.deps.logger.info({ requestId, payloadSize: payloadText.length, llmTextSize: llmText.length }, "starting AST+LLM extraction");
      const [astHints, llmResult] = await Promise.all([
        (async () => {
          if (!this.deps.astClassifier) { this.deps.logger.info({ requestId }, "AST: skipped (no classifier)"); return undefined; }
          try {
            this.deps.logger.info({ requestId }, "AST: starting");
            const r = await this.deps.astClassifier.classifyTokens(payloadText);
            this.deps.logger.info({ requestId, tokens: r.size }, "AST: done");
            return r;
          } catch {
            this.deps.logger.info({ requestId }, "AST: failed");
            return undefined;
          }
        })(),
        (async () => {
          if (!this.deps.llmExtractor?.enabled) { this.deps.logger.info({ requestId }, "LLM: skipped (disabled)"); return undefined; }
          try {
            this.deps.logger.info({ requestId }, "LLM: starting ollama call");
            const r = await this.deps.llmExtractor.extract(llmText);
            this.deps.logger.info({ requestId, entities: r.entities.length, cached: r.fromCache, durationMs: r.durationMs }, "LLM: done");
            return r;
          } catch (e) {
            this.deps.logger.info({ requestId, err: e }, "LLM: failed");
            return undefined;
          }
        })()
      ]);
      this.deps.logger.info({ requestId }, "AST+LLM extraction complete");

      // Prepare semantic pseudonyms via Ollama (fail-open)
      let semanticPseudonyms: Map<string, string> | undefined;
      if (this.deps.llmExtractor?.enabled) {
        try {
          semanticPseudonyms = await this.deps.rewriteEngine.prepareSemanticPseudonyms(
            llmText, this.deps.llmExtractor, astHints, llmResult?.entities
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
        endpoint: "responses",
        model: parsedBody.model,
        originalBody: originalJson,
        rewrittenBody: rewrittenJson,
        transformedCount: rewrite.transformedCount
      });

      liveBus.emit("masking", {
        timestamp: new Date().toISOString(),
        endpoint: "/v1/responses",
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
        "llmask responses pipeline timings"
      );

      // Diagnostic: log critical fields to verify tools & token limits reach the provider
      const rp = rewrite.rewrittenPayload as Record<string, unknown> | undefined;
      this.deps.logger.info(
        {
          traceId,
          requestId,
          tools: Array.isArray(rp?.tools) ? rp.tools.length : "MISSING",
          toolChoice: rp?.tool_choice ?? "not_set",
          maxOutputTokens: rp?.max_output_tokens ?? rp?.max_tokens ?? "not_set",
          reasoning: rp?.reasoning ?? "not_set",
          instructions: typeof rp?.instructions === "string" ? rp.instructions.slice(0, 80) + "..." : "not_set",
          inputItems: Array.isArray(rp?.input) ? rp.input.length : 0,
          stream: rp?.stream
        },
        "llmask responses outgoing payload summary"
      );

      const { response: upstream, adapter } = await this.deps.providerRouter.forward({
        endpointKind: "responses",
        body: rewrite.rewrittenPayload,
        incomingAuthHeader: getHeaderValue(request.headers.authorization),
        incomingHeaders: extractForwardableHeaders(request.headers),
        requestId,
        traceId
      });
      const t4 = performance.now();
      this.deps.logger.info(
        { traceId, requestId, forwardMs: Math.round(t4 - t3), upstreamStatus: upstream.status },
        "llmask upstream response received"
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
      this.deps.logger.error({ err: error, traceId, requestId }, "responses proxy pipeline failed");

      this.deps.auditService.record({
        eventName: "llmask.responses.pipeline.failed.v1",
        requestId,
        traceId,
        policyAction: "block",
        data: { failSafeBlock: this.deps.config.failSafeBlockOnError }
      });

      if (this.deps.config.failSafeBlockOnError) {
        const blocked = openAiError(
          502,
          "LLMASK fail-safe blocked responses request due to pipeline error",
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
      return reply.code(status).header("content-type", contentType).send(errorText);
    }

    const rawJson = (await upstream.json()) as unknown;
    const translatedJson = adapter.translateJsonResponse(rawJson, "responses");
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

    // Store response for dashboard
    try {
      const text = extractResponsesText(remapped);
      if (text) this.deps.mappingStore.updateResponseBody(context.logId, text);
    } catch { /* non-critical */ }

    this.deps.auditService.record({
      eventName: "llmask.responses.completed.v1",
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
    const sseTranslation = adapter.createSseTranslationTransform("responses");
    const remapTransform = this.deps.remapEngine.createEventLevelSseTransform(context.scopeId);

    request.raw.once("close", () => {
      upstreamReadable.destroy();
    });

    this.deps.auditService.record({
      eventName: "llmask.responses.streaming_started.v1",
      requestId: context.requestId,
      traceId: context.traceId,
      data: { transformedCount: context.transformedCount }
    });

    try {
      await pipeline(upstreamReadable, sseTranslation, remapTransform, raw);
      // Store captured response text
      try {
        const capturedText = remapTransform.getCapturedText();
        if (capturedText) this.deps.mappingStore.updateResponseBody(context.logId, capturedText);
      } catch { /* non-critical */ }
    } catch (error) {
      try {
        const capturedText = remapTransform.getCapturedText();
        if (capturedText) this.deps.mappingStore.updateResponseBody(context.logId, capturedText);
      } catch { /* non-critical */ }
      this.deps.logger.warn({ err: error, traceId: context.traceId, requestId: context.requestId }, "responses streaming pipeline terminated");
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

/** Extract text from a Responses API JSON response (output[].content[].text). */
function extractResponsesText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const rec = payload as Record<string, unknown>;
  if (!Array.isArray(rec.output)) return null;
  const parts: string[] = [];
  for (const item of rec.output) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    if (obj.type === "message" && Array.isArray(obj.content)) {
      for (const block of obj.content) {
        if (block && typeof block === "object" && (block as Record<string, unknown>).type === "output_text") {
          const text = (block as Record<string, unknown>).text;
          if (typeof text === "string") parts.push(text);
        }
      }
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
