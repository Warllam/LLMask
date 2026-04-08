import { Readable, Transform } from "node:stream";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fastifyStatic from "@fastify/static";
import type { MappingStore } from "../mapping-store/mapping-store";
import type { RewriteEngineV4 as RewriteEngine } from "../rewrite/rewrite-engine-v4";
import type { ResponseRemapEngine } from "../remap/response-remap-engine";
import type { DetectionEngine } from "../detection/detection-engine";
import type { ProviderRouter } from "../provider-adapter/provider-router";
import type { RateLimitTracker } from "../../shared/security-middleware";
import type { CustomRulesStore } from "../custom-rules/custom-rules-store";
import { buildCliPrompt, spawnClaudeCli } from "../claude-cli/claude-cli-adapter";
import { liveBus, type LiveMaskingEvent } from "./live-events";
import type { UserStore, UserRole } from "../users/user-store";
import type { UserAuthService } from "../users/user-auth";

type ChatDeps = {
  mappingStore: MappingStore;
  rewriteEngine: RewriteEngine;
  remapEngine: ResponseRemapEngine;
  detectionEngine: DetectionEngine;
  providerRouter: ProviderRouter;
  customRulesStore: CustomRulesStore;
  requestTimeoutMs: number;
  shieldTerms?: string[];
  adminKey?: string;
  userStore?: UserStore;
  userAuth?: UserAuthService;
  rateLimitTracker?: RateLimitTracker;
};

// ---------------------------------------------------------------------------
// Runtime settings (persisted to .llmask-settings.json in CWD)
// ---------------------------------------------------------------------------

interface RuntimeSettings {
  maskingStrategy: "pseudonymization" | "redaction" | "generalization" | "tokenization";
  retentionDays: number;
  provider: string;
}

const settingsPath = path.join(process.cwd(), ".llmask-settings.json");
let runtimeSettings: RuntimeSettings = {
  maskingStrategy: "pseudonymization",
  retentionDays: 30,
  provider: "anthropic",
};
try {
  const raw = fs.readFileSync(settingsPath, "utf-8");
  runtimeSettings = { ...runtimeSettings, ...JSON.parse(raw) };
} catch { /* use defaults */ }

export function registerDashboardRoutes(
  server: FastifyInstance,
  deps: ChatDeps
) {
  const { mappingStore, rewriteEngine, detectionEngine, providerRouter, customRulesStore, requestTimeoutMs, shieldTerms, adminKey, userStore, userAuth, rateLimitTracker } = deps;

  // ── JWT-based dashboard auth (when userAuth is configured) ──────────
  if (userAuth) {
    server.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.url.startsWith("/dashboard")) return;
      // Allow HTML pages and static assets through (SPA handles the login redirect)
      if (
        request.url === "/dashboard" ||
        request.url === "/dashboard/" ||
        request.url.startsWith("/dashboard/assets/") ||
        // Allow login endpoint itself
        request.url === "/dashboard/api/auth/login"
      ) return;

      const authHeader = request.headers.authorization;
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
      if (!token) {
        return reply.code(401).send({ error: { message: "Unauthorized — JWT required", code: "MISSING_TOKEN" } });
      }
      const payload = userAuth.verifyToken(token);
      if (!payload) {
        return reply.code(401).send({ error: { message: "Unauthorized — invalid or expired token", code: "INVALID_TOKEN" } });
      }
      // Attach user info to request for downstream handlers
      (request as any).authUser = { id: payload.sub, username: payload.username, role: payload.role };
    });
  } else if (adminKey) {
    // Legacy: static admin key (backward compat)
    server.addHook("onRequest", async (request, reply) => {
      if (!request.url.startsWith("/dashboard")) return;
      if (request.url === "/dashboard" || request.url === "/dashboard/") return;
      const queryKey = (request.query as Record<string, string>)?.key;
      const headerKey = request.headers["x-llmask-key"];
      const key = queryKey || (Array.isArray(headerKey) ? headerKey[0] : headerKey);
      if (key !== adminKey) {
        return reply.code(401).send({ error: { message: "Unauthorized — provide admin key via ?key= or x-llmask-key header" } });
      }
    });
  }

  // ── Auth endpoints ──────────────────────────────────────────────────
  if (userAuth) {
    server.post<{ Body: { username: string; password: string } }>(
      "/dashboard/api/auth/login",
      async (request, reply) => {
        const { username, password } = request.body as { username?: string; password?: string };
        if (!username || !password) {
          return reply.code(400).send({ error: { message: "username and password are required" } });
        }
        const result = await userAuth.login(username, password);
        if (!result) {
          return reply.code(401).send({ error: { message: "Invalid credentials" } });
        }
        return { token: result.token, user: result.user };
      }
    );

    server.post("/dashboard/api/auth/logout", async (request, reply) => {
      const authHeader = request.headers.authorization;
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
      if (token) userAuth.logout(token);
      return reply.code(204).send();
    });

    server.get("/dashboard/api/auth/me", async (request) => {
      return (request as any).authUser ?? null;
    });
  }

  // ── User management (admin only) ────────────────────────────────────
  if (userStore && userAuth) {
    function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
      const user = (request as any).authUser as { role: string } | undefined;
      if (!user || user.role !== "admin") {
        reply.code(403).send({ error: { message: "Forbidden — admin role required" } });
        return false;
      }
      return true;
    }

    server.get("/dashboard/api/users", async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      return userStore.listUsers();
    });

    server.post<{ Body: { username: string; password: string; role?: UserRole } }>(
      "/dashboard/api/users",
      async (request, reply) => {
        if (!requireAdmin(request, reply)) return;
        const { username, password, role = "viewer" } = request.body as {
          username?: string; password?: string; role?: UserRole;
        };
        if (!username || !password) {
          return reply.code(400).send({ error: { message: "username and password are required" } });
        }
        if (role !== "admin" && role !== "viewer") {
          return reply.code(400).send({ error: { message: "role must be 'admin' or 'viewer'" } });
        }
        if (userStore.getUserByUsername(username)) {
          return reply.code(409).send({ error: { message: "Username already exists" } });
        }
        const passwordHash = await userAuth.hashPassword(password);
        const user = userStore.createUser(randomUUID(), username, passwordHash, role);
        return reply.code(201).send(user);
      }
    );

    server.patch<{ Params: { id: string }; Body: { role?: UserRole; password?: string } }>(
      "/dashboard/api/users/:id",
      async (request, reply) => {
        if (!requireAdmin(request, reply)) return;
        const { id } = request.params;
        const { role, password } = request.body as { role?: UserRole; password?: string };

        if (!userStore.getUserById(id)) {
          return reply.code(404).send({ error: { message: "User not found" } });
        }
        if (role) {
          if (role !== "admin" && role !== "viewer") {
            return reply.code(400).send({ error: { message: "role must be 'admin' or 'viewer'" } });
          }
          userStore.updateRole(id, role);
        }
        if (password) {
          const passwordHash = await userAuth.hashPassword(password);
          userStore.updatePassword(id, passwordHash);
        }
        return { ok: true };
      }
    );

    server.delete<{ Params: { id: string } }>(
      "/dashboard/api/users/:id",
      async (request, reply) => {
        if (!requireAdmin(request, reply)) return;
        const { id } = request.params;
        const callerUser = (request as any).authUser as { id: string } | undefined;
        if (callerUser?.id === id) {
          return reply.code(400).send({ error: { message: "Cannot delete your own account" } });
        }
        if (!userStore.getUserById(id)) {
          return reply.code(404).send({ error: { message: "User not found" } });
        }
        userStore.deleteUser(id);
        return { ok: true };
      }
    );
  }

  server.get("/dashboard/api/config", async () => ({
    primaryProvider: providerRouter.primaryType,
    fallbackProvider: providerRouter.fallbackType
  }));

  // ---- Settings (read/write dashboard preferences) ----
  server.get("/dashboard/api/settings", async () => {
    return { ...runtimeSettings, provider: runtimeSettings.provider || providerRouter.primaryType };
  });

  server.post<{ Body: Partial<RuntimeSettings> }>(
    "/dashboard/api/settings",
    async (request, reply) => {
      const body = request.body as Partial<RuntimeSettings>;
      const validStrategies = ["pseudonymization", "redaction", "generalization", "tokenization"];
      const updated: RuntimeSettings = {
        maskingStrategy: validStrategies.includes(body.maskingStrategy ?? "")
          ? (body.maskingStrategy as RuntimeSettings["maskingStrategy"])
          : runtimeSettings.maskingStrategy,
        retentionDays: typeof body.retentionDays === "number" && body.retentionDays > 0
          ? body.retentionDays
          : runtimeSettings.retentionDays,
        provider: typeof body.provider === "string" && body.provider.length > 0
          ? body.provider
          : runtimeSettings.provider,
      };
      runtimeSettings = updated;
      try {
        fs.writeFileSync(settingsPath, JSON.stringify(updated, null, 2), "utf-8");
      } catch (err) {
        server.log.warn({ err }, "Failed to persist settings");
      }
      return { ok: true, settings: updated };
    }
  );

  // --- Available models based on configured providers ---
  const MODEL_CATALOG: Record<string, Array<{ id: string; label: string }>> = {
    anthropic: [
      { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
      { id: "claude-opus-4-20250514", label: "Claude Opus 4" },
      { id: "claude-haiku-3-5-20241022", label: "Claude Haiku 3.5" },
    ],
    openai: [
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4o-mini", label: "GPT-4o Mini" },
      { id: "o3", label: "o3" },
      { id: "o4-mini", label: "o4-mini" },
    ],
    gemini: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    ],
    mistral: [
      { id: "mistral-large-latest", label: "Mistral Large" },
    ],
    litellm: [
      { id: "claude-sonnet", label: "Claude Sonnet (LiteLLM)" },
      { id: "claude-opus", label: "Claude Opus (LiteLLM)" },
      { id: "claude-haiku", label: "Claude Haiku (LiteLLM)" },
      { id: "gpt-4o", label: "GPT-4o (LiteLLM)" },
      { id: "gpt-4o-mini", label: "GPT-4o Mini (LiteLLM)" },
      { id: "o1", label: "o1 (LiteLLM)" },
      { id: "o1-mini", label: "o1-mini (LiteLLM)" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro (LiteLLM)" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (LiteLLM)" },
      { id: "mistral-large", label: "Mistral Large (LiteLLM)" },
      { id: "codestral", label: "Codestral (LiteLLM)" },
    ],
  };

  server.get("/dashboard/api/models", async () => {
    const providers = providerRouter.getRegisteredProviders();
    const models: Array<{ id: string; label: string; provider: string }> = [];
    for (const provider of providers) {
      const catalog = MODEL_CATALOG[provider] ?? [];
      for (const m of catalog) {
        models.push({ ...m, provider });
      }
    }
    return { models, primaryProvider: providerRouter.primaryType };
  });

  server.get("/dashboard/api/scopes", async () => {
    return mappingStore.listScopes();
  });

  server.get<{ Params: { scopeId: string } }>(
    "/dashboard/api/mappings/:scopeId",
    async (request) => {
      return mappingStore.listMappings(request.params.scopeId);
    }
  );

  server.get<{ Querystring: { limit?: string } }>(
    "/dashboard/api/recent",
    async (request) => {
      const limit = Math.min(
        parseInt(request.query.limit ?? "50", 10) || 50,
        500
      );
      return mappingStore.listRecentMappings(limit);
    }
  );

  server.get<{ Querystring: { limit?: string } }>(
    "/dashboard/api/requests",
    async (request) => {
      const limit = Math.min(
        parseInt(request.query.limit ?? "50", 10) || 50,
        500
      );
      return mappingStore.listRequestLogs(limit);
    }
  );

  server.get<{ Params: { id: string } }>(
    "/dashboard/api/requests/:id",
    async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      if (Number.isNaN(id)) {
        return reply.code(400).send({ error: "Invalid request id" });
      }
      const entry = mappingStore.getRequestLog(id);
      if (!entry) {
        return reply.code(404).send({ error: "Request log not found" });
      }
      return entry;
    }
  );

  server.get("/dashboard/api/stats", async () => {
    const base = mappingStore.getStats();
    const rateLimitStats = rateLimitTracker
      ? {
          rateLimiting: {
            totalExceededRequests: rateLimitTracker.totalHits(),
            topExceedingKeys: rateLimitTracker.getStats().slice(0, 10),
          },
        }
      : {};
    return { ...base, ...rateLimitStats };
  });

  // ---- Live SSE feed (community-accessible) ----
  server.get("/dashboard/api/live", async (request, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // Send initial heartbeat
    reply.raw.write("data: {\"type\":\"connected\"}\n\n");

    const onEvent = (event: LiveMaskingEvent) => {
      reply.raw.write(`data: ${JSON.stringify({ type: "masking", ...event })}\n\n`);
    };

    liveBus.on("masking", onEvent);

    // Heartbeat every 30s to keep connection alive
    const heartbeat = setInterval(() => {
      reply.raw.write(": heartbeat\n\n");
    }, 30_000);

    request.raw.on("close", () => {
      liveBus.removeListener("masking", onEvent);
      clearInterval(heartbeat);
    });
  });

  server.get<{ Querystring: { limit?: string } }>(
    "/dashboard/api/sessions",
    async (request) => {
      const limit = Math.min(
        parseInt(request.query.limit ?? "50", 10) || 50,
        500
      );
      return mappingStore.listSessions(limit);
    }
  );

  server.get<{ Params: { traceId: string } }>(
    "/dashboard/api/sessions/:traceId",
    async (request) => {
      return mappingStore.listRequestLogsByTraceId(request.params.traceId);
    }
  );

  server.get<{ Params: { traceId: string } }>(
    "/dashboard/api/sessions/:traceId/mappings",
    async (request) => {
      return mappingStore.listMappings(request.params.traceId);
    }
  );

  server.put<{ Params: { traceId: string }; Body: { title: string } }>(
    "/dashboard/api/sessions/:traceId/title",
    async (request, reply) => {
      const { title } = request.body as { title: string };
      if (!title || typeof title !== "string" || title.trim().length === 0) {
        return reply.code(400).send({ error: "title is required" });
      }
      const trimmed = title.trim().slice(0, 100);
      mappingStore.upsertSessionTitle(request.params.traceId, trimmed, false);
      return { ok: true, title: trimmed };
    }
  );

  server.delete<{ Params: { traceId: string } }>(
    "/dashboard/api/sessions/:traceId",
    async (request) => {
      mappingStore.deleteSession(request.params.traceId);
      return { ok: true };
    }
  );

  // ---- Custom Rules API ----

  server.get("/dashboard/api/rules", async () => {
    return customRulesStore.list();
  });

  server.post<{ Body: { name: string; pattern: string; replacementPrefix: string; category: string } }>(
    "/dashboard/api/rules",
    async (request, reply) => {
      const { name, pattern, replacementPrefix, category } = request.body as {
        name: string;
        pattern: string;
        replacementPrefix: string;
        category: string;
      };

      if (!name || typeof name !== "string" || !name.trim()) {
        return reply.code(400).send({ error: "name is required" });
      }
      if (!pattern || typeof pattern !== "string" || !pattern.trim()) {
        return reply.code(400).send({ error: "pattern is required" });
      }

      // Validate regex
      try {
        new RegExp(pattern);
      } catch (err) {
        return reply.code(400).send({ error: `Invalid regex: ${(err as Error).message}` });
      }

      const rule = customRulesStore.create({
        name: name.trim(),
        pattern: pattern.trim(),
        replacementPrefix: (replacementPrefix || "CUSTOM").trim(),
        category: (category || "Custom").trim(),
      });
      return reply.code(201).send(rule);
    }
  );

  server.post<{ Body: { pattern: string; text: string } }>(
    "/dashboard/api/rules/test",
    async (request, reply) => {
      const { pattern, text } = request.body as { pattern: string; text: string };
      if (!pattern || typeof pattern !== "string") {
        return reply.code(400).send({ error: "pattern is required" });
      }
      if (typeof text !== "string") {
        return reply.code(400).send({ error: "text is required" });
      }
      return customRulesStore.testRule(pattern, text);
    }
  );

  server.patch<{
    Params: { id: string };
    Body: { name?: string; pattern?: string; replacementPrefix?: string; category?: string; enabled?: boolean };
  }>(
    "/dashboard/api/rules/:id",
    async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      if (Number.isNaN(id)) {
        return reply.code(400).send({ error: "Invalid rule id" });
      }

      const body = request.body as {
        name?: string;
        pattern?: string;
        replacementPrefix?: string;
        category?: string;
        enabled?: boolean;
      };

      // Validate regex if pattern is being updated
      if (body.pattern !== undefined) {
        try {
          new RegExp(body.pattern);
        } catch (err) {
          return reply.code(400).send({ error: `Invalid regex: ${(err as Error).message}` });
        }
      }

      const updated = customRulesStore.update(id, body);
      if (!updated) {
        return reply.code(404).send({ error: "Rule not found" });
      }
      return updated;
    }
  );

  server.delete<{ Params: { id: string } }>(
    "/dashboard/api/rules/:id",
    async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      if (Number.isNaN(id)) {
        return reply.code(400).send({ error: "Invalid rule id" });
      }
      const deleted = customRulesStore.delete(id);
      if (!deleted) {
        return reply.code(404).send({ error: "Rule not found" });
      }
      return { ok: true };
    }
  );

  // ---- DSI Dashboard API ----
  server.get("/dashboard/api/dsi/stats", async () => {
    return mappingStore.getDsiStats();
  });

  server.get<{ Querystring: { limit?: string } }>(
    "/dashboard/api/dsi/leaks",
    async (request) => {
      return mappingStore.scanLeaksCached(shieldTerms);
    }
  );

  // ---- Serve React dashboard (built static files) ----
  const dashboardDist = path.resolve(__dirname, "../../../dashboard/dist");
  const dashboardIndexPath = path.join(dashboardDist, "index.html");
  const hasDashboardBuild = fs.existsSync(dashboardIndexPath);

  if (hasDashboardBuild) {
    server.register(fastifyStatic, {
      root: dashboardDist,
      prefix: "/dashboard/",
      decorateReply: false,
    });
  }

  // Serve index.html for /dashboard and any /dashboard/* SPA routes
  const dashboardFallbackHtml = hasDashboardBuild
    ? fs.readFileSync(dashboardIndexPath, "utf-8")
    : `<html><body style="font-family:system-ui;padding:40px;text-align:center">
        <h2>Dashboard not built</h2>
        <p>Run <code>cd dashboard && npm run build</code> to build the React dashboard.</p>
      </body></html>`;

  server.get("/dashboard", async (_request, reply) => {
    return reply.type("text/html").send(dashboardFallbackHtml);
  });

  // ---- Chat Preview: dry-run rewrite to show masking before sending ----
  server.post<{
    Body: {
      message: string;
      history?: Array<{ role: string; content: string }>;
      sessionId?: string;
    };
  }>("/dashboard/api/chat/preview", async (request, reply) => {
    const { message, history, sessionId } = request.body as {
      message: string;
      history?: Array<{ role: string; content: string }>;
      sessionId?: string;
    };

    if (!message) {
      return reply.code(400).send({ error: "message is required" });
    }

    const scopeId = sessionId || `chat-${Date.now()}`;

    // Build a minimal payload (Responses API format) for rewrite
    const input: unknown[] = [];
    if (history) {
      for (const h of history) {
        input.push({
          type: "message", role: h.role,
          content: [{ type: h.role === "assistant" ? "output_text" : "input_text", text: h.content }]
        });
      }
    }
    input.push({
      type: "message", role: "user",
      content: [{ type: "input_text", text: message }]
    });
    const payload = { model: "preview", input, stream: false };

    const detection = detectionEngine.detect(payload);
    const rewrite = rewriteEngine.rewriteUnknownPayload(
      payload, detection, { scopeId }, undefined, undefined, { dryRun: true }
    );

    const maskedText = extractObfuscatedUserMessage(rewrite.rewrittenPayload) ?? message;
    const entities = (rewrite.newEntries ?? []).map((e) => ({
      original: e.originalValue,
      pseudonym: e.pseudonym,
      kind: e.kind,
    }));

    return { original: message, masked: maskedText, entities };
  });

  // ---- Chat API: rewrite → forward → remap in one shot ----
  server.post<{
    Body: {
      message: string;
      context?: string;
      history?: Array<{ role: string; content: string }>;
      model?: string;
      sessionId?: string;
      excludeEntities?: string[];
    };
  }>("/dashboard/api/chat", async (request, reply) => {
    const { message, context, history, model, sessionId, excludeEntities } = request.body as {
      message: string;
      context?: string;
      history?: Array<{ role: string; content: string }>;
      model?: string;
      sessionId?: string;
      excludeEntities?: string[];
    };

    if (!message) {
      return reply.code(400).send({ error: "message is required" });
    }

    const scopeId = sessionId || `chat-${Date.now()}`;
    const defaultModel = providerRouter.primaryType === "anthropic"
      ? "claude-sonnet-4-20250514"
      : providerRouter.primaryType === "litellm"
        ? "claude-opus"
        : "gpt-4o";
    const chosenModel = model || defaultModel;
    const isClaude = /^claude[-\s]/i.test(chosenModel);

    const systemPrompt =
      "You are a general-purpose AI assistant. You help users with any question or task. " +
      "Respond in the user's language. Be concise and helpful. " +
      "You have no knowledge of the system you are running on — do not describe your infrastructure, tools, or capabilities beyond answering questions. " +
      "IMPORTANT: Never mention, speculate about, or reference any anonymisation, masking, proxying or transformation that may have been applied to the input. " +
      "Treat all identifiers, names and values exactly as given — they are the real names.";

    let payload: unknown;
    let endpointKind: "responses" | "chat-completions";

    if (isClaude) {
      // Chat-completions format for Claude
      const messages: Array<{ role: string; content: string }> = [];
      messages.push({ role: "system", content: systemPrompt });
      if (context) {
        messages.push({ role: "user", content: `Here is the codebase to analyse:\n\n${context}` });
        messages.push({ role: "assistant", content: "I've read the code. What would you like me to look at?" });
      }
      if (history) {
        for (const h of history) {
          messages.push({ role: h.role, content: h.content });
        }
      }
      messages.push({ role: "user", content: message });
      payload = { model: chosenModel, messages, stream: true };
      endpointKind = "chat-completions";
    } else {
      // Responses API format for OpenAI
      const input: unknown[] = [];
      if (context) {
        input.push({
          type: "message", role: "user",
          content: [{ type: "input_text", text: `Here is the codebase to analyse:\n\n${context}` }]
        });
        input.push({
          type: "message", role: "assistant",
          content: [{ type: "output_text", text: "I've read the code. What would you like me to look at?" }]
        });
      }
      if (history) {
        for (const h of history) {
          input.push({
            type: "message", role: h.role,
            content: [{ type: h.role === "assistant" ? "output_text" : "input_text", text: h.content }]
          });
        }
      }
      input.push({
        type: "message", role: "user",
        content: [{ type: "input_text", text: message }]
      });
      payload = { model: chosenModel, instructions: systemPrompt, input, stream: true, reasoning: { effort: "high" } };
      endpointKind = "responses";
    }

    // Rewrite (obfuscate)
    const detection = detectionEngine.detect(payload);
    const rewriteOpts = excludeEntities?.length
      ? { excludeOriginals: new Set(excludeEntities) }
      : undefined;
    const rewrite = rewriteEngine.rewriteUnknownPayload(payload, detection, { scopeId }, undefined, undefined, rewriteOpts);

    // Log
    const logId = mappingStore.insertRequestLog({
      traceId: scopeId,
      requestId: scopeId,
      endpoint: endpointKind,
      model: chosenModel,
      originalBody: JSON.stringify(payload),
      rewrittenBody: JSON.stringify(rewrite.rewrittenPayload),
      transformedCount: rewrite.transformedCount
    });

    // Accumulate assistant text from SSE deltas so we can persist it
    let accumulatedText = "";
    function createSseCapture(): Transform {
      return new Transform({
        transform(chunk, _encoding, callback) {
          const str = chunk.toString("utf8");
          for (const line of str.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              // OpenAI chat-completions
              const delta = parsed.choices?.[0]?.delta?.content
                // Anthropic content_block_delta
                ?? parsed.delta?.text
                // OpenAI Responses API
                ?? (typeof parsed.delta === "string" ? parsed.delta : null);
              if (delta) accumulatedText += delta;
            } catch { /* not JSON or llmask-* event */ }
          }
          callback(null, chunk);
        }
      });
    }

    function saveResponse() {
      if (accumulatedText) {
        try { mappingStore.updateResponseBody(logId, accumulatedText); }
        catch (err) { server.log.warn({ err, logId }, "failed to save chat response"); }
      }
    }

    // Send obfuscated user message + prepare SSE headers helper
    const obfuscatedText = extractObfuscatedUserMessage(rewrite.rewrittenPayload);

    const beginSse = () => {
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*"
      });
      if (obfuscatedText) {
        raw.write(`data: ${JSON.stringify({ type: "llmask-obfuscated", text: obfuscatedText })}\n\n`);
      }
      return raw;
    };

    const sendRemapAndEnd = (raw: import("node:http").ServerResponse) => {
      const mappings = mappingStore.listMappings(scopeId)
        .map((m) => [m.pseudonym, m.originalValue]);
      if (mappings.length > 0) {
        raw.write(`data: ${JSON.stringify({ type: "llmask-remap", mappings, scopeId })}\n\n`);
      }
      raw.end();
    };

    if (isClaude) {
      // --- Claude Code CLI path (OAuth/setup-tokens only work via the CLI) ---
      const obfuscatedMessages = (rewrite.rewrittenPayload as Record<string, unknown>)
        .messages as Array<{ role: string; content: string }> | undefined;

      if (!obfuscatedMessages) {
        return reply.code(500).send({ error: "Failed to extract messages from obfuscated payload" });
      }

      const { systemPrompt: cliSystemPrompt, userPrompt } = buildCliPrompt(obfuscatedMessages);

      const { sseStream, processPromise } = spawnClaudeCli({
        prompt: userPrompt,
        systemPrompt: cliSystemPrompt ?? undefined,
        model: chosenModel,
        timeoutMs: requestTimeoutMs,
        logger: server.log
      });

      const raw = beginSse();

      // Collect SSE data from the PassThrough and write directly to HTTP response
      const sseChunks: Buffer[] = [];
      sseStream.on("data", (chunk: Buffer) => sseChunks.push(chunk));

      const result = await processPromise;
      const sseData = Buffer.concat(sseChunks).toString("utf8");

      server.log.info(
        { scopeId, cost: result.costUsd, usage: result.usage, exitCode: result.exitCode, sseLen: sseData.length },
        "claude-cli completed"
      );

      if (result.error) {
        server.log.warn({ scopeId, error: result.error }, "claude-cli error");
      }

      // Extract text from SSE deltas for persistence
      for (const line of sseData.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          const parsed = JSON.parse(line.slice(6));
          const delta = parsed.delta?.text;
          if (delta) accumulatedText += delta;
        } catch { /* skip */ }
      }

      // Write SSE to HTTP response
      if (sseData) {
        raw.write(sseData);
      }

      saveResponse();
      sendRemapAndEnd(raw);
    } else {
      // --- Provider router path (OpenAI etc.) ---
      let upstream: Response;
      try {
        const result = await providerRouter.forward({
          endpointKind,
          body: rewrite.rewrittenPayload,
          requestId: scopeId,
          traceId: scopeId
        });
        upstream = result.response;
      } catch (err) {
        server.log.error({ err, scopeId }, "chat forward failed");
        return reply.code(502).send({ error: "Upstream provider error" });
      }

      if (!upstream.ok) {
        const errText = await upstream.text().catch(() => "");
        return reply.code(upstream.status).send({ error: errText || "Upstream error" });
      }

      const raw = beginSse();
      const capture = createSseCapture();
      const upstreamReadable = Readable.fromWeb(upstream.body as any);
      request.raw.once("close", () => upstreamReadable.destroy());
      upstreamReadable.pipe(capture).pipe(raw, { end: false });

      await new Promise<void>((resolve) => {
        capture.on("end", () => {
          saveResponse();
          sendRemapAndEnd(raw);
          resolve();
        });
        capture.on("error", (err) => {
          server.log.warn({ err, scopeId }, "chat streaming pipeline terminated");
          saveResponse();
          raw.end();
          resolve();
        });
      });
    }

    return reply;
  });
}

// ---------------------------------------------------------------------------
// Helper: extract the obfuscated user message from the rewritten payload
// ---------------------------------------------------------------------------

function extractObfuscatedUserMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;

  // Responses API format (input array)
  if (Array.isArray(p.input)) {
    for (let i = p.input.length - 1; i >= 0; i--) {
      const item = p.input[i] as Record<string, unknown>;
      if (item.role !== "user" || (item.type && item.type !== "message")) continue;
      if (typeof item.content === "string") return item.content;
      if (Array.isArray(item.content)) {
        for (const block of item.content) {
          const b = block as Record<string, unknown>;
          if (b.type === "input_text" && typeof b.text === "string") return b.text;
        }
      }
    }
  }

  // Chat Completions format (messages array — used for Claude)
  if (Array.isArray(p.messages)) {
    for (let i = p.messages.length - 1; i >= 0; i--) {
      const msg = p.messages[i] as Record<string, unknown>;
      if (msg.role !== "user") continue;
      if (typeof msg.content === "string") return msg.content;
    }
  }

  return null;
}

// Dashboard HTML removed — now served as React build from dashboard/dist/
