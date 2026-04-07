import type {
  SessionSummary,
  RequestLogEntry,
  MappingEntry,
  DashboardStats,
  DsiStats,
  LeakReport,
  ChatPreviewResult,
  AlertRuleConfig,
  ConfigInfo,
  ActivityEntry,
  LatencyStats,
} from "./types";
import { authStore } from "./auth";

const BASE = "/dashboard/api";

function authHeaders(): Record<string, string> {
  const token = authStore.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders() });
  if (res.status === 401) {
    // Token expired or invalid — clear auth and reload to trigger login redirect
    authStore.clear();
    window.location.reload();
    throw new Error("Session expired");
  }
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => fetchJson<T>(path),
  stats: () => fetchJson<DashboardStats>("/stats"),
  sessions: (limit = 100) =>
    fetchJson<SessionSummary[]>(`/sessions?limit=${limit}`),
  sessionRequests: (traceId: string) =>
    fetchJson<RequestLogEntry[]>(`/sessions/${encodeURIComponent(traceId)}`),
  sessionMappings: (traceId: string) =>
    fetchJson<MappingEntry[]>(
      `/sessions/${encodeURIComponent(traceId)}/mappings`
    ),
  updateSessionTitle: async (traceId: string, title: string) => {
    const res = await fetch(
      `${BASE}/sessions/${encodeURIComponent(traceId)}/title`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ title }),
      }
    );
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json() as Promise<{ ok: true; title: string }>;
  },
  deleteSession: async (traceId: string) => {
    const res = await fetch(
      `${BASE}/sessions/${encodeURIComponent(traceId)}`,
      { method: "DELETE", headers: authHeaders() }
    );
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json() as Promise<{ ok: true }>;
  },
  chatPreview: async (
    message: string,
    history?: Array<{ role: string; content: string }>,
    sessionId?: string
  ) => {
    const res = await fetch(`${BASE}/chat/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ message, history, sessionId }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json() as Promise<ChatPreviewResult>;
  },
  dsiStats: () => fetchJson<DsiStats>("/dsi/stats"),
  dsiLeaks: () => fetchJson<LeakReport>("/dsi/leaks"),
  config: () =>
    fetchJson<{ primaryProvider: string; fallbackProvider: string }>("/config"),
  alertRules: () => fetchJson<AlertRuleConfig[]>("/alerts/rules"),
  acknowledgeAlert: async (ruleId: string) => {
    const res = await fetch(`${BASE}/alerts/rules/${encodeURIComponent(ruleId)}/acknowledge`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json() as Promise<{ ok: true }>;
  },
  toggleAlertRule: async (ruleId: string, enabled: boolean) => {
    const res = await fetch(`${BASE}/alerts/rules/${encodeURIComponent(ruleId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json() as Promise<{ ok: true }>;
  },
  configInfo: () => fetchJson<ConfigInfo>("/config/info"),
  recentActivity: (limit = 50) => fetchJson<ActivityEntry[]>(`/activity?limit=${limit}`),
  latencyStats: () => fetchJson<LatencyStats>("/stats/latency"),

  // ── User management (admin only) ──────────────────────────────────
  users: {
    list: () => fetchJson<UserInfo[]>("/users"),
    create: async (username: string, password: string, role: "admin" | "viewer") => {
      const res = await fetch(`${BASE}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ username, password, role }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(body?.error?.message ?? `API error ${res.status}`);
      }
      return res.json() as Promise<UserInfo>;
    },
    update: async (id: string, patch: { role?: "admin" | "viewer"; password?: string }) => {
      const res = await fetch(`${BASE}/users/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      return res.json() as Promise<{ ok: true }>;
    },
    delete: async (id: string) => {
      const res = await fetch(`${BASE}/users/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      return res.json() as Promise<{ ok: true }>;
    },
  },
};

export type UserInfo = {
  id: string;
  username: string;
  role: "admin" | "viewer";
  apiKey: string;
  createdAt: string;
  lastLogin: string | null;
};
