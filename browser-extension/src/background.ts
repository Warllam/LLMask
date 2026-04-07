/**
 * LLMask Privacy Shield — Background Service Worker
 *
 * Manages extension state and proxies API calls to the LLMask server.
 * Content scripts cannot call localhost directly due to CORS restrictions,
 * so they route through this service worker instead.
 */

// ── Types ────────────────────────────────────────────────────────────────

interface ExtensionState {
  enabled: boolean;
  proxyUrl: string;
  stats: {
    maskedToday: number;
    entitiesProtected: number;
    lastReset: string; // ISO date string (YYYY-MM-DD)
  };
}

type Message =
  | { type: "MASK_TEXT"; text: string; scopeId?: string }
  | { type: "REMAP_RESPONSE"; scopeId: string }
  | { type: "GET_STATE" }
  | { type: "SET_STATE"; patch: Partial<Pick<ExtensionState, "enabled" | "proxyUrl">> }
  | { type: "CHECK_PROXY" }
  | { type: "RECORD_MASK"; entityCount: number };

interface MaskResponse {
  ok: boolean;
  masked_text?: string;
  scope_id?: string;
  entity_count?: number;
  error?: string;
}

interface RemapResponse {
  ok: boolean;
  replacements?: Array<{ from: string; to: string }>;
  error?: string;
}

interface StateResponse {
  ok: boolean;
  state?: ExtensionState;
}

interface ProxyStatusResponse {
  ok: boolean;
  reachable?: boolean;
  error?: string;
}

// ── Default state ────────────────────────────────────────────────────────

const DEFAULT_STATE: ExtensionState = {
  enabled: true,
  proxyUrl: "http://localhost:3456",
  stats: {
    maskedToday: 0,
    entitiesProtected: 0,
    lastReset: new Date().toISOString().slice(0, 10),
  },
};

// ── State helpers ────────────────────────────────────────────────────────

async function loadState(): Promise<ExtensionState> {
  const stored = await chrome.storage.sync.get("llmask_state");
  const saved = stored["llmask_state"] as Partial<ExtensionState> | undefined;
  if (!saved) return { ...DEFAULT_STATE };

  // Reset daily stats if day has changed
  const today = new Date().toISOString().slice(0, 10);
  const stats =
    saved.stats?.lastReset === today
      ? saved.stats
      : { maskedToday: 0, entitiesProtected: 0, lastReset: today };

  return {
    enabled: saved.enabled ?? DEFAULT_STATE.enabled,
    proxyUrl: saved.proxyUrl ?? DEFAULT_STATE.proxyUrl,
    stats,
  };
}

async function saveState(state: ExtensionState): Promise<void> {
  await chrome.storage.sync.set({ llmask_state: state });
}

// ── Proxy API helpers ────────────────────────────────────────────────────

async function callProxy(
  proxyUrl: string,
  path: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const url = `${proxyUrl.replace(/\/$/, "")}${path}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      (err as { error?: { message?: string } })?.error?.message ??
        `HTTP ${response.status}`
    );
  }
  return response.json();
}

// ── Message handler ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (
    message: Message,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((err: Error) =>
        sendResponse({ ok: false, error: err.message })
      );
    return true; // keep channel open for async response
  }
);

async function handleMessage(
  message: Message
): Promise<
  | MaskResponse
  | RemapResponse
  | StateResponse
  | ProxyStatusResponse
  | { ok: boolean }
> {
  const state = await loadState();

  switch (message.type) {
    case "GET_STATE":
      return { ok: true, state };

    case "SET_STATE": {
      const updated: ExtensionState = { ...state, ...message.patch };
      await saveState(updated);
      return { ok: true, state: updated };
    }

    case "RECORD_MASK": {
      const today = new Date().toISOString().slice(0, 10);
      const stats = state.stats.lastReset === today ? state.stats : {
        maskedToday: 0, entitiesProtected: 0, lastReset: today,
      };
      stats.maskedToday += 1;
      stats.entitiesProtected += message.entityCount;
      await saveState({ ...state, stats });
      return { ok: true };
    }

    case "MASK_TEXT": {
      try {
        const body: Record<string, unknown> = { text: message.text };
        if (message.scopeId) body["scope_id"] = message.scopeId;

        const data = (await callProxy(state.proxyUrl, "/v1/text/mask", body)) as {
          masked_text: string;
          scope_id: string;
          entity_count: number;
        };
        return {
          ok: true,
          masked_text: data.masked_text,
          scope_id: data.scope_id,
          entity_count: data.entity_count,
        };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }

    case "REMAP_RESPONSE": {
      try {
        const data = (await callProxy(state.proxyUrl, "/v1/text/remap", {
          scope_id: message.scopeId,
        })) as { replacements: Array<{ from: string; to: string }> };
        return { ok: true, replacements: data.replacements };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }

    case "CHECK_PROXY": {
      try {
        const url = `${state.proxyUrl.replace(/\/$/, "")}/health`;
        const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
        return { ok: true, reachable: response.ok };
      } catch {
        return { ok: true, reachable: false };
      }
    }

    default:
      return { ok: false, error: "Unknown message type" };
  }
}
