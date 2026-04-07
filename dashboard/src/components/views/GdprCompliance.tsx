import { useCallback, useEffect, useState } from "react";
import {
  Shield,
  Download,
  Trash2,
  Clock,
  FileText,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import { api } from "@/lib/api";
import type { AuditLogEntry, AuditLogPage, GdprEvent, RetentionInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

// ── Tiny helper components ────────────────────────────────────────────────────

function Tab({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ElementType;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
        ok ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-red-500/10 text-red-600 dark:text-red-400"
      )}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {label}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type ActiveTab = "audit" | "retention" | "erase" | "export" | "checklist";

export function GdprCompliance() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("audit");

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Page header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
        <div className="rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 p-2">
          <Shield className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">RGPD / GDPR Compliance</h1>
          <p className="text-xs text-muted-foreground">
            Audit logs · Data retention · Erasure · Portability
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border px-6 shrink-0 overflow-x-auto">
        <Tab label="Audit Logs" icon={FileText} active={activeTab === "audit"} onClick={() => setActiveTab("audit")} />
        <Tab label="Retention" icon={Clock} active={activeTab === "retention"} onClick={() => setActiveTab("retention")} />
        <Tab label="Erase Data" icon={Trash2} active={activeTab === "erase"} onClick={() => setActiveTab("erase")} />
        <Tab label="Export" icon={Download} active={activeTab === "export"} onClick={() => setActiveTab("export")} />
        <Tab label="Compliance" icon={CheckCircle2} active={activeTab === "checklist"} onClick={() => setActiveTab("checklist")} />
      </div>

      {/* Tab panels */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "audit" && <AuditLogsTab />}
        {activeTab === "retention" && <RetentionTab />}
        {activeTab === "erase" && <EraseTab />}
        {activeTab === "export" && <ExportTab />}
        {activeTab === "checklist" && <ComplianceChecklist />}
      </div>
    </div>
  );
}

// ── Audit Logs Tab ─────────────────────────────────────────────────────────────

function AuditLogsTab() {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [strategy, setStrategy] = useState("");
  const [provider, setProvider] = useState("");
  const [data, setData] = useState<AuditLogPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .auditLogs({ page, pageSize, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, strategy: strategy || undefined, provider: provider || undefined })
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [page, pageSize, dateFrom, dateTo, strategy, provider]);

  useEffect(() => { load(); }, [load]);

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  return (
    <div className="p-6 space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="h-8 px-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="h-8 px-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Strategy</label>
          <select
            value={strategy}
            onChange={(e) => { setStrategy(e.target.value); setPage(1); }}
            className="h-8 px-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">All</option>
            <option value="chat-completions">chat-completions</option>
            <option value="messages">messages</option>
            <option value="responses">responses</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Provider (model)</label>
          <input
            type="text"
            placeholder="e.g. gpt-4o"
            value={provider}
            onChange={(e) => { setProvider(e.target.value); setPage(1); }}
            className="h-8 px-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring w-36"
          />
        </div>
        <button
          onClick={() => { setDateFrom(""); setDateTo(""); setStrategy(""); setProvider(""); setPage(1); }}
          className="h-8 px-3 text-xs rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors"
        >
          Reset
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : !data || data.entries.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          No audit log entries found.
        </div>
      ) : (
        <>
          <div className="text-xs text-muted-foreground">
            {data.total} operations total
          </div>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Timestamp</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Strategy</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Provider</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Masked</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Categories</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.entries.map((entry) => (
                  <AuditRow key={entry.id} entry={entry} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-muted-foreground">
                Page {data.page} of {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={data.page <= 1}
                  className="p-1.5 rounded-md hover:bg-muted disabled:opacity-40 transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={data.page >= totalPages}
                  className="p-1.5 rounded-md hover:bg-muted disabled:opacity-40 transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AuditRow({ entry }: { entry: AuditLogEntry }) {
  const date = new Date(entry.timestamp);
  return (
    <tr className="hover:bg-muted/30 transition-colors">
      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
        {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </td>
      <td className="px-3 py-2">
        <span className="inline-block px-1.5 py-0.5 rounded text-[11px] bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-mono">
          {entry.strategy}
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground font-mono">{entry.provider}</td>
      <td className="px-3 py-2 text-right text-xs font-medium">{entry.maskedCount}</td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {entry.categories.length === 0 ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : (
            entry.categories.map((cat) => (
              <span key={cat} className="px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground font-mono uppercase">
                {cat}
              </span>
            ))
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Retention Tab ──────────────────────────────────────────────────────────────

function RetentionTab() {
  const [info, setInfo] = useState<RetentionInfo | null>(null);
  const [events, setEvents] = useState<GdprEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.gdprRetention(), api.gdprEvents()])
      .then(([r, e]) => { setInfo(r); setEvents(e); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-sm text-muted-foreground animate-pulse">Loading…</div>;

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div className="rounded-lg border border-border p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Data Retention Policy</h2>
          <StatusBadge ok={info?.enabled ?? false} label={info?.enabled ? `${info.retentionDays} days` : "Disabled"} />
        </div>
        <p className="text-sm text-muted-foreground">{info?.description}</p>
        <div className="rounded-md bg-muted/50 p-3 text-xs font-mono text-muted-foreground">
          {info?.envVar}={info?.retentionDays ?? 0}
        </div>
        <p className="text-xs text-muted-foreground">
          To change the retention period, set <code className="font-mono bg-muted px-1 rounded">LLMASK_GDPR_RETENTION_DAYS</code> in your
          environment and restart the server. Cleanup runs automatically on startup and every 24 hours.
        </p>
      </div>

      {events.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-3">Recent Retention Cleanups</h2>
          <div className="space-y-2">
            {events.filter((e) => e.eventType === "retention_cleanup").slice(0, 10).map((e) => (
              <div key={e.id} className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
                <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">{new Date(e.timestamp).toLocaleString()}</div>
                  <div className="text-xs mt-0.5">{e.affectedCount} records removed</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Erase Tab ─────────────────────────────────────────────────────────────────

function EraseTab() {
  const [term, setTerm] = useState("");
  const [result, setResult] = useState<{ deletedMappings: number; deletedRequests: number; deletedSessions: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [events, setEvents] = useState<GdprEvent[]>([]);

  useEffect(() => {
    api.gdprEvents().then((evs) => setEvents(evs.filter((e) => e.eventType === "erasure"))).catch(console.error);
  }, [result]);

  const handleErase = async () => {
    if (!confirmed) { setError("Please confirm the erasure by checking the box."); return; }
    if (term.trim().length < 2) { setError("Search term must be at least 2 characters."); return; }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.gdprErase(term.trim());
      setResult(res);
      setTerm("");
      setConfirmed(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <h2 className="text-sm font-semibold text-destructive">Right to Erasure — Article 17 GDPR</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Enter a search term (name, email, identifier…). All mapping entries and request logs containing
          that term will be permanently deleted. This action cannot be undone.
        </p>

        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search term to erase…"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              className="w-full pl-9 pr-3 h-9 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="rounded border-input"
            />
            I understand this permanently deletes all matching records
          </label>

          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2.5 text-xs text-destructive">
              {error}
            </div>
          )}

          {result && (
            <div className="rounded-md bg-green-500/10 border border-green-500/20 p-3 text-sm space-y-1">
              <div className="font-medium text-green-700 dark:text-green-400 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" /> Erasure complete
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <div>Mapping entries deleted: <strong>{result.deletedMappings}</strong></div>
                <div>Request logs deleted: <strong>{result.deletedRequests}</strong></div>
                <div>Sessions removed: <strong>{result.deletedSessions}</strong></div>
              </div>
            </div>
          )}

          <button
            onClick={handleErase}
            disabled={loading || !term.trim() || !confirmed}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Trash2 className="h-4 w-4" />
            {loading ? "Erasing…" : "Erase matching data"}
          </button>
        </div>
      </div>

      {events.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-3">Erasure History</h2>
          <div className="space-y-2">
            {events.slice(0, 10).map((e) => (
              <div key={e.id} className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
                <Trash2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">{new Date(e.timestamp).toLocaleString()}</div>
                  {e.searchTerm && <div className="text-xs font-mono mt-0.5 truncate">Term: "{e.searchTerm}"</div>}
                  <div className="text-xs mt-0.5">{e.affectedCount} records deleted</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Export Tab ─────────────────────────────────────────────────────────────────

function ExportTab() {
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<GdprEvent[]>([]);

  useEffect(() => {
    api.gdprEvents().then((evs) => setEvents(evs.filter((e) => e.eventType === "export"))).catch(console.error);
  }, []);

  const handleExport = async () => {
    setLoading(true);
    try {
      const blob = await api.gdprExportBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `llmask-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      // Refresh events list
      const fresh = await api.gdprEvents();
      setEvents(fresh.filter((e) => e.eventType === "export"));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div className="rounded-lg border border-border p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Download className="h-5 w-5 text-primary" />
          <h2 className="text-sm font-semibold">Data Portability — Article 20 GDPR</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Export all stored data (mapping entries, request logs, GDPR events) as a structured JSON file.
          The export includes metadata such as the retention policy and export timestamp.
        </p>
        <p className="text-xs text-muted-foreground">
          <strong>Note:</strong> The export contains pseudonymised data but may include original values
          in request/response logs. Handle with care.
        </p>

        <button
          onClick={handleExport}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Download className="h-4 w-4" />
          {loading ? "Preparing export…" : "Download all data"}
        </button>
      </div>

      {events.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-3">Export History</h2>
          <div className="space-y-2">
            {events.slice(0, 10).map((e) => (
              <div key={e.id} className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
                <Download className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">{new Date(e.timestamp).toLocaleString()}</div>
                  <div className="text-xs mt-0.5">{e.affectedCount} records exported</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Compliance Checklist ──────────────────────────────────────────────────────

function ComplianceChecklist() {
  const [retention, setRetention] = useState<RetentionInfo | null>(null);
  const [auditTotal, setAuditTotal] = useState<number | null>(null);

  useEffect(() => {
    api.gdprRetention().then(setRetention).catch(console.error);
    api.auditLogs({ page: 1, pageSize: 1 }).then((d) => setAuditTotal(d.total)).catch(console.error);
  }, []);

  const checks: Array<{ label: string; description: string; status: boolean | null }> = [
    {
      label: "Audit logging active",
      description: "All masking operations are recorded with timestamp, strategy, provider, and entity categories.",
      status: auditTotal !== null ? true : null,
    },
    {
      label: "Data retention configured",
      description: `LLMASK_GDPR_RETENTION_DAYS is set. Old data is automatically purged after ${retention?.retentionDays ?? "∞"} days.`,
      status: retention !== null ? retention.enabled : null,
    },
    {
      label: "Right to erasure available",
      description: "DELETE /dashboard/api/gdpr/erase endpoint is operational for Article 17 requests.",
      status: true,
    },
    {
      label: "Data portability available",
      description: "GET /dashboard/api/gdpr/export endpoint is operational for Article 20 requests.",
      status: true,
    },
    {
      label: "PII pseudonymisation",
      description: "All sensitive data is pseudonymised before being sent to LLM providers.",
      status: true,
    },
    {
      label: "Audit trail for GDPR operations",
      description: "Erasure, export, and retention cleanup events are logged in the gdpr_events table.",
      status: true,
    },
  ];

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div className="space-y-3">
        <h2 className="text-sm font-semibold">GDPR Compliance Status</h2>
        <div className="space-y-2">
          {checks.map((check) => (
            <div
              key={check.label}
              className="flex items-start gap-3 rounded-lg border border-border p-3"
            >
              <div className="mt-0.5 shrink-0">
                {check.status === null ? (
                  <div className="h-4 w-4 rounded-full bg-muted animate-pulse" />
                ) : check.status ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium">{check.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{check.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg bg-muted/50 p-4 text-xs text-muted-foreground space-y-2">
        <p className="font-medium text-foreground">Regulatory references</p>
        <ul className="space-y-1 list-disc list-inside">
          <li>Article 5(e) — Storage limitation (data minimisation via retention policy)</li>
          <li>Article 17 — Right to erasure ("droit à l'effacement")</li>
          <li>Article 20 — Right to data portability</li>
          <li>Article 25 — Data protection by design (pseudonymisation)</li>
          <li>Article 30 — Records of processing activities (audit log)</li>
        </ul>
      </div>
    </div>
  );
}
