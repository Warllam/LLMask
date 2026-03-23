import type { FastifyBaseLogger } from "fastify";
import { recordFallbackProvider } from "../../shared/metrics";
import type { EndpointKind, ProviderAdapter, ProviderType } from "./types";

export type ForwardRequest = {
  endpointKind: EndpointKind;
  body: unknown;
  incomingAuthHeader?: string;
  incomingHeaders?: Record<string, string>;
  requestId: string;
  traceId: string;
};

export type ForwardResult = {
  response: Response;
  adapter: ProviderAdapter;
};

const CLAUDE_MODEL_RE = /^claude[-\s]/i;
const OPENAI_MODEL_RE = /^(?:gpt-|o[0-9]|chatgpt-|dall-e|whisper|tts-|text-)/i;
const GEMINI_MODEL_RE = /^gemini[-\s]/i;
const MISTRAL_MODEL_RE = /^(?:mistral[-\s]|codestral|pixtral|ministral)/i;

// --- Retry configuration (inspired by OpenClaw infra/retry.ts) ---------------
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 15_000;
const JITTER_MS = 500;

function detectProviderFromModel(body: unknown): ProviderType | null {
  if (!body || typeof body !== "object") return null;
  const model = (body as Record<string, unknown>).model;
  if (typeof model !== "string") return null;
  if (CLAUDE_MODEL_RE.test(model)) return "anthropic";
  if (OPENAI_MODEL_RE.test(model)) return "openai";
  if (GEMINI_MODEL_RE.test(model)) return "gemini";
  if (MISTRAL_MODEL_RE.test(model)) return "mistral";
  // Unknown model names → route to LiteLLM if registered, otherwise null → primary
  return "litellm";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeRetryDelay(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs && retryAfterMs > 0) {
    // Respect upstream Retry-After + small jitter
    return Math.min(retryAfterMs + Math.random() * JITTER_MS, MAX_RETRY_DELAY_MS);
  }
  // Exponential backoff: 1s, 2s, 4s + jitter
  const base = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
  return Math.min(base + Math.random() * JITTER_MS, MAX_RETRY_DELAY_MS);
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // Timeout (AbortController)
  if (error.name === "AbortError") return true;
  // Network-level failures
  if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|UND_ERR|fetch failed/i.test(error.message)) return true;
  // Server errors (5xx) and rate limits (429)
  if (/returned [5]\d\d/.test(error.message)) return true;
  if (/returned 429/.test(error.message)) return true;
  return false;
}

export class ProviderRouter {
  private readonly adapters = new Map<ProviderType, ProviderAdapter>();
  /** When true, all requests are routed through the primary adapter (gateway mode). */
  private _gatewayMode = false;

  constructor(
    private readonly primary: ProviderAdapter,
    private readonly fallback: ProviderAdapter | null,
    private readonly requestTimeoutMs: number,
    private readonly logger: FastifyBaseLogger
  ) {
    this.adapters.set(primary.type, primary);
    if (fallback) {
      this.adapters.set(fallback.type, fallback);
    }
  }

  get primaryType() {
    return this.primary.type;
  }

  get fallbackType() {
    return this.fallback?.type ?? null;
  }

  hasAdapter(type: ProviderType): boolean {
    return this.adapters.has(type);
  }

  /** Returns the list of registered provider types. */
  getRegisteredProviders(): ProviderType[] {
    return Array.from(this.adapters.keys());
  }

  registerAdapter(adapter: ProviderAdapter) {
    if (!this.adapters.has(adapter.type)) {
      this.adapters.set(adapter.type, adapter);
    }
  }

  /** Enable gateway mode: all requests go through primary (e.g. LiteLLM). */
  setGatewayMode(enabled: boolean) {
    this._gatewayMode = enabled;
  }

  async forward(request: ForwardRequest): Promise<ForwardResult> {
    const bestAdapter = this.resolveAdapter(request);
    const otherAdapter = this.getOtherAdapter(bestAdapter);

    try {
      return await this.tryProviderWithRetry(bestAdapter, request);
    } catch (primaryError) {
      if (!otherAdapter) {
        throw primaryError;
      }

      this.logger.warn(
        {
          err: primaryError,
          traceId: request.traceId,
          requestId: request.requestId,
          primaryProvider: bestAdapter.type,
          fallbackProvider: otherAdapter.type
        },
        "selected provider failed after retries, trying fallback"
      );

      recordFallbackProvider(bestAdapter.type, otherAdapter.type);
      return this.tryProviderWithRetry(otherAdapter, request);
    }
  }

  private resolveAdapter(request: ForwardRequest): ProviderAdapter {
    // Gateway mode: everything goes through primary (e.g. LiteLLM handles routing)
    if (this._gatewayMode) {
      this.logger.debug(
        { model: (request.body as any)?.model, resolvedProvider: this.primary.type },
        "gateway mode — routing all through primary"
      );
      return this.primary;
    }

    const detected = detectProviderFromModel(request.body);

    if (detected) {
      const matched = this.adapters.get(detected);
      if (matched) {
        this.logger.debug(
          { model: (request.body as any)?.model, resolvedProvider: detected },
          "model-based provider routing"
        );
        return matched;
      }
    }

    return this.primary;
  }

  private getOtherAdapter(current: ProviderAdapter): ProviderAdapter | null {
    // Fallback strategy is deterministic and tied to configured primary/fallback
    // (instead of depending on registration order in the adapter map).
    if (current === this.primary) {
      return this.fallback;
    }

    if (this.fallback && current === this.fallback) {
      return this.primary;
    }

    // If request was routed to an auxiliary adapter (e.g. model-based route),
    // prefer explicit fallback, then primary.
    if (this.fallback && current !== this.fallback) {
      return this.fallback;
    }

    if (current !== this.primary) {
      return this.primary;
    }

    return null;
  }

  private async tryProviderWithRetry(
    adapter: ProviderAdapter,
    request: ForwardRequest
  ): Promise<ForwardResult> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const retryAfterMs = (lastError as any)?.retryAfterMs as number | undefined;
        const delayMs = Math.round(computeRetryDelay(attempt, retryAfterMs));
        this.logger.info(
          {
            traceId: request.traceId,
            requestId: request.requestId,
            attempt,
            maxRetries: MAX_RETRIES,
            delayMs,
            provider: adapter.type
          },
          "retrying provider request"
        );
        await sleep(delayMs);
      }

      try {
        return await this.tryProvider(adapter, request);
      } catch (error) {
        lastError = error;
        if (!isRetryableError(error)) {
          throw error;
        }
        this.logger.warn(
          { err: error, traceId: request.traceId, requestId: request.requestId, attempt, provider: adapter.type },
          "retryable provider error"
        );
      }
    }

    throw lastError;
  }

  private async tryProvider(
    adapter: ProviderAdapter,
    request: ForwardRequest
  ): Promise<ForwardResult> {
    const prepared = await adapter.prepareRequest(
      request.endpointKind,
      request.body,
      request.incomingAuthHeader,
      request.incomingHeaders
    );

    // Stringify once — reuse for both logging metadata and fetch body
    const bodyString = JSON.stringify(prepared.body);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    this.logger.info(
      {
        traceId: request.traceId,
        requestId: request.requestId,
        provider: adapter.type,
        url: prepared.url,
        bodySizeKb: Math.round(bodyString.length / 1024)
      },
      "forwarding request to provider"
    );

    // Log full body only at debug level (opt-in via LOG_LEVEL=debug)
    this.logger.debug(
      { traceId: request.traceId, outgoingBody: prepared.body },
      "outgoing body detail"
    );

    try {
      const response = await fetch(prepared.url, {
        method: "POST",
        headers: prepared.headers,
        body: bodyString,
        signal: controller.signal
      });

      // Clear timeout as soon as headers arrive — streaming can continue
      // indefinitely without being killed by the connect timeout.
      clearTimeout(timeout);

      // Rate-limited: throw retryable error with Retry-After hint
      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        const err = new Error(`Provider ${adapter.type} returned 429 (rate limited)`);
        if (retryAfter) {
          (err as any).retryAfterMs = (parseInt(retryAfter, 10) || 1) * 1000;
        }
        // Consume body to free connection
        await response.text().catch(() => {});
        throw err;
      }

      if (!response.ok && response.status < 500) {
        const errorBody = await response.clone().text().catch(() => "");
        this.logger.warn(
          {
            traceId: request.traceId,
            requestId: request.requestId,
            provider: adapter.type,
            status: response.status,
            errorBody
          },
          "provider returned client error"
        );
      }

      if (!response.ok && response.status >= 500) {
        // Consume body to free connection before retry
        await response.text().catch(() => {});
        throw new Error(`Provider ${adapter.type} returned ${response.status}`);
      }

      return { response, adapter };
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }
}
