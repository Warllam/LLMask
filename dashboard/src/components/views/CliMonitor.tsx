import { useEffect, useState, useCallback } from "react";
import {
  Monitor,
  Terminal,
  Shield,
  MessageSquare,
  FileCode,
  Cpu,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Clock,
  FolderOpen,
  BarChart2,
  TrendingUp,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { api } from "@/lib/api";
import type { CodeSessionSummary, CodeSessionStats, CodeSessionTurn } from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDateShort(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso.slice(5, 10);
  }
}

function shortModel(model: string): string {
  return model.replace("claude-", "").replace(/-\d{8}$/, "");
}

function strategyBadgeClass(strategy: string): string {
  switch (strategy) {
    case "aggressive":  return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
    case "pii-only":    return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
    case "values-only": return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
    default:            return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
  }
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  sub?: string;
  accent?: "emerald" | "blue" | "purple" | "amber";
}) {
  const accentMap: Record<string, string> = {
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    blue:    "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    purple:  "bg-purple-500/10 text-purple-600 dark:text-purple-400",
    amber:   "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  };
  const iconClass = accent ? accentMap[accent] : "bg-primary/10 text-primary";

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm flex gap-3 items-start">
      <div className={cn("rounded-lg p-2 mt-0.5", iconClass)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-bold tabular-nums leading-tight">{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
        {sub && <div className="text-xs text-muted-foreground/70 mt-0.5 truncate">{sub}</div>}
      </div>
    </div>
  );
}

// ── Copy Button ───────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
      title="Copy to clipboard"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ── Turn Row ──────────────────────────────────────────────────────────────────

function TurnRow({ turn, index }: { turn: CodeSessionTurn; index: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        className={cn(
          "w-full flex items-center gap-2 px-4 py-2.5 text-left transition-colors",
          expanded ? "bg-primary/5" : "bg-muted/30 hover:bg-muted/50"
        )}
        onClick={() => setExpanded((p) => !p)}
      >
        {expanded
          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        }
        <span className="text-[11px] text-muted-foreground flex-shrink-0 font-mono w-5">
          #{index + 1}
        </span>
        <MessageSquare className="h-3.5 w-3.5 text-primary flex-shrink-0" />
        <span className="text-xs font-medium text-foreground truncate flex-1">
          {turn.prompt.length > 120 ? turn.prompt.slice(0, 120) + "…" : turn.prompt}
        </span>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          <span className="text-[11px] text-muted-foreground">
            {formatRelativeTime(turn.createdAt)}
          </span>
          {turn.filesScanned.length > 0 && (
            <span className="flex items-center gap-0.5 text-[11px] text-blue-600 dark:text-blue-400">
              <FileCode className="h-3 w-3" />
              {turn.filesScanned.length}
            </span>
          )}
          {turn.elementsMasked > 0 && (
            <span className="flex items-center gap-0.5 text-[11px] text-emerald-600 dark:text-emerald-400">
              <Shield className="h-3 w-3" />
              {turn.elementsMasked}
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="divide-y divide-border">
          {/* Metadata row */}
          <div className="px-4 py-2 bg-muted/20 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDate(turn.createdAt)}
            </span>
            <span className="flex items-center gap-1">
              <Shield className="h-3 w-3 text-emerald-500" />
              {turn.elementsMasked} element{turn.elementsMasked !== 1 ? "s" : ""} masked
            </span>
            <span className="flex items-center gap-1">
              <FileCode className="h-3 w-3 text-blue-500" />
              {turn.filesScanned.length} file{turn.filesScanned.length !== 1 ? "s" : ""} scanned
            </span>
          </div>

          {/* Files scanned */}
          {turn.filesScanned.length > 0 && (
            <div className="px-4 py-2.5 bg-blue-50/50 dark:bg-blue-950/20">
              <div className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 mb-1.5 flex items-center gap-1">
                <FileCode className="h-3 w-3" /> Files scanned
              </div>
              <div className="flex flex-wrap gap-1">
                {turn.filesScanned.map((f) => (
                  <code
                    key={f}
                    className="text-[11px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded font-mono"
                  >
                    {f}
                  </code>
                ))}
              </div>
            </div>
          )}

          {/* Prompt (masked) */}
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-amber-400" />
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Prompt (masked)
                </span>
                {turn.elementsMasked > 0 && (
                  <span className="text-[10px] bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded-full">
                    {turn.elementsMasked} masked
                  </span>
                )}
              </div>
              <CopyButton text={turn.prompt} />
            </div>
            <pre className="text-xs whitespace-pre-wrap break-words font-mono text-foreground bg-muted/30 rounded-lg p-3 max-h-48 overflow-y-auto border border-border/50">
              {turn.prompt}
            </pre>
          </div>

          {/* Response */}
          {turn.response && (
            <div className="px-4 py-3">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <div className="h-2 w-2 rounded-full bg-primary" />
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Claude response
                  </span>
                </div>
                <CopyButton text={turn.response} />
              </div>
              <pre className="text-xs whitespace-pre-wrap break-words font-mono text-foreground bg-muted/30 rounded-lg p-3 max-h-64 overflow-y-auto border border-border/50">
                {turn.response}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Session Row ───────────────────────────────────────────────────────────────

function SessionRow({ session }: { session: CodeSessionSummary }) {
  const [expanded, setExpanded] = useState(false);
  const [turns, setTurns] = useState<CodeSessionTurn[] | null>(null);
  const [loading, setLoading] = useState(false);

  const loadTurns = useCallback(async () => {
    if (turns !== null) return;
    setLoading(true);
    try {
      const data = await api.codeSessionTurns(session.sessionId);
      setTurns(data);
    } catch {
      setTurns([]);
    } finally {
      setLoading(false);
    }
  }, [session.sessionId, turns]);

  const toggle = () => {
    setExpanded((p) => !p);
    if (!expanded) loadTurns();
  };

  return (
    <div className="border border-border rounded-xl overflow-hidden shadow-sm">
      <button
        className={cn(
          "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
          expanded ? "bg-primary/5" : "hover:bg-muted/40"
        )}
        onClick={toggle}
      >
        <div className={cn(
          "flex-shrink-0 rounded-lg p-1.5",
          expanded ? "bg-primary/20" : "bg-muted"
        )}>
          <Terminal className={cn("h-4 w-4", expanded ? "text-primary" : "text-muted-foreground")} />
        </div>

        {/* Project info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground truncate">
              {session.projectName}
            </span>
            <span className={cn(
              "text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0",
              strategyBadgeClass(session.strategy)
            )}>
              {session.strategy}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
            {session.projectDir}
          </div>
        </div>

        {/* Stats */}
        <div className="hidden sm:flex items-center gap-4 flex-shrink-0 text-[12px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <MessageSquare className="h-3.5 w-3.5" />
            {session.turnsCount} turn{session.turnsCount !== 1 ? "s" : ""}
          </span>
          <span className="flex items-center gap-1">
            <Shield className="h-3.5 w-3.5 text-emerald-500" />
            {session.totalElementsMasked} masked
          </span>
          <span className="flex items-center gap-1">
            <Cpu className="h-3.5 w-3.5" />
            {shortModel(session.model)}
          </span>
          <span>{formatRelativeTime(session.lastTurnAt)}</span>
        </div>

        {/* Chevron */}
        <div className="flex-shrink-0 ml-1">
          {expanded
            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />
          }
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border">
          {/* Mobile stats strip */}
          <div className="sm:hidden px-4 py-2 bg-muted/20 flex flex-wrap gap-3 text-[11px] text-muted-foreground border-b border-border">
            <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3" />{session.turnsCount} turns</span>
            <span className="flex items-center gap-1"><Shield className="h-3 w-3 text-emerald-500" />{session.totalElementsMasked} masked</span>
            <span className="flex items-center gap-1"><Cpu className="h-3 w-3" />{shortModel(session.model)}</span>
            <span>Started {formatDate(session.startedAt)}</span>
          </div>

          {/* Session metadata */}
          <div className="hidden sm:flex px-4 py-2 bg-muted/10 gap-6 text-[11px] text-muted-foreground border-b border-border">
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Started {formatDate(session.startedAt)}</span>
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Last active {formatDate(session.lastTurnAt)}</span>
            <span className="flex items-center gap-1"><Cpu className="h-3 w-3" /> {session.model}</span>
          </div>

          {loading && (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Loading turns…
            </div>
          )}

          {turns !== null && turns.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-sm text-muted-foreground">
              <MessageSquare className="h-6 w-6 mb-2 opacity-30" />
              No turns recorded for this session.
            </div>
          )}

          {turns !== null && turns.length > 0 && (
            <div className="p-4 space-y-2">
              {turns.map((turn, i) => (
                <TurnRow key={turn.id} turn={turn} index={i} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Activity Chart ────────────────────────────────────────────────────────────

function ActivityChart({ data }: { data: Array<{ date: string; turns: number }> }) {
  const formatted = data.map((d) => ({ ...d, label: formatDateShort(d.date) }));
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <BarChart2 className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Turns per Day — Last 7 Days</h2>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={formatted} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            className="fill-muted-foreground"
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            className="fill-muted-foreground"
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="rounded-lg border border-border bg-card shadow-lg px-3 py-2 text-xs">
                  <div className="font-semibold mb-0.5">{label}</div>
                  <div className="text-muted-foreground">{payload[0].value} turn{payload[0].value !== 1 ? "s" : ""}</div>
                </div>
              );
            }}
          />
          <Bar dataKey="turns" radius={[4, 4, 0, 0]} className="fill-primary" fill="hsl(var(--primary))" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Files Analysis ────────────────────────────────────────────────────────────

function FilesAnalysis({ topFiles }: { topFiles: Array<{ file: string; count: number }> }) {
  if (topFiles.length === 0) return null;
  const max = topFiles[0]?.count ?? 1;

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <FileCode className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Most Frequently Scanned Files</h2>
        <span className="text-xs text-muted-foreground ml-auto">{topFiles.length} files</span>
      </div>
      <div className="space-y-2">
        {topFiles.map(({ file, count }) => (
          <div key={file} className="flex items-center gap-2 group">
            <code className="text-[11px] font-mono text-muted-foreground truncate flex-1 min-w-0" title={file}>
              {file}
            </code>
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary/60"
                  style={{ width: `${Math.round((count / max) * 100)}%` }}
                />
              </div>
              <span className="text-[11px] text-muted-foreground tabular-nums w-8 text-right">
                ×{count}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Model Distribution ────────────────────────────────────────────────────────

function ModelDistribution({ modelCounts }: { modelCounts: Record<string, number> }) {
  const entries = Object.entries(modelCounts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  const total = entries.reduce((s, [, v]) => s + v, 0);

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Cpu className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Model Usage</h2>
      </div>
      <div className="space-y-2">
        {entries.map(([model, count]) => (
          <div key={model} className="flex items-center gap-2">
            <span className="text-xs text-foreground truncate flex-1 min-w-0 font-mono">
              {shortModel(model)}
            </span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-purple-500/70"
                  style={{ width: `${Math.round((count / total) * 100)}%` }}
                />
              </div>
              <span className="text-[11px] text-muted-foreground tabular-nums w-10 text-right">
                {count} turn{count !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main View ─────────────────────────────────────────────────────────────────

export function CliMonitor() {
  const [stats, setStats] = useState<CodeSessionStats | null>(null);
  const [sessions, setSessions] = useState<CodeSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsData, sessionsData] = await Promise.all([
        api.codeSessionStats(),
        api.codeSessions(100),
      ]);
      setStats(statsData);
      setSessions(sessionsData);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <Monitor className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">CLI Monitor</h1>
          <span className="text-sm text-muted-foreground">— llmask code activity</span>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Error state */}
        {error && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !stats && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-20 rounded-xl border border-border bg-muted/20 animate-pulse" />
              ))}
            </div>
            <div className="h-52 rounded-xl border border-border bg-muted/20 animate-pulse" />
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-16 rounded-xl border border-border bg-muted/20 animate-pulse" />
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="rounded-2xl bg-muted p-5 mb-4">
              <Monitor className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold mb-1">No CLI activity yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Start a session with{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">
                llmask code [directory]
              </code>{" "}
              and monitoring data will appear here automatically.
            </p>
            <div className="mt-4 flex flex-col gap-1 text-xs text-muted-foreground font-mono bg-muted/50 rounded-xl p-4 text-left">
              <span className="text-primary font-semibold mb-1">Quick start</span>
              <span><span className="text-emerald-500">$</span> llmask code ./my-project</span>
              <span><span className="text-emerald-500">$</span> llmask code . --strategy aggressive</span>
              <span><span className="text-emerald-500">$</span> llmask code . --verbose</span>
            </div>
          </div>
        )}

        {stats && (
          <>
            {/* Stats cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              <StatCard
                label="Sessions"
                value={stats.totalSessions}
                icon={Terminal}
                accent="blue"
              />
              <StatCard
                label="Turns"
                value={stats.totalTurns}
                icon={MessageSquare}
                sub="prompts to Claude"
                accent="purple"
              />
              <StatCard
                label="Elements masked"
                value={stats.totalElementsMasked}
                icon={Shield}
                accent="emerald"
              />
              <StatCard
                label="Files scanned"
                value={stats.totalFilesScanned}
                icon={FileCode}
                accent="amber"
              />
              <StatCard
                label="Top model"
                value={stats.mostUsedModel ? shortModel(stats.mostUsedModel) : "—"}
                icon={Cpu}
                sub={stats.mostUsedModel ?? undefined}
              />
              <StatCard
                label="Last activity"
                value={stats.lastActivityAt ? formatRelativeTime(stats.lastActivityAt) : "—"}
                icon={TrendingUp}
                sub={stats.lastActivityAt ? formatDate(stats.lastActivityAt) : undefined}
              />
            </div>

            {/* Activity chart + model breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <ActivityChart data={stats.activityByDay} />
              </div>
              <ModelDistribution modelCounts={stats.modelCounts} />
            </div>

            {/* Sessions list */}
            {sessions.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <FolderOpen className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    Live sessions
                  </h2>
                  <span className="text-xs text-muted-foreground">({sessions.length})</span>
                </div>
                <div className="space-y-2">
                  {sessions.map((session) => (
                    <SessionRow key={session.sessionId} session={session} />
                  ))}
                </div>
              </div>
            )}

            {/* Files analysis */}
            {stats.topFiles.length > 0 && (
              <FilesAnalysis topFiles={stats.topFiles} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
