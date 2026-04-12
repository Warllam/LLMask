import { useEffect, useState, useCallback } from "react";
import {
  Terminal,
  Shield,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  FileCode,
  MessageSquare,
  Cpu,
} from "lucide-react";
import { api } from "@/lib/api";
import type { CodeSessionSummary, CodeSessionTurn } from "@/lib/types";
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

function strategyBadgeClass(strategy: string): string {
  switch (strategy) {
    case "aggressive":  return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
    case "pii-only":    return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
    case "values-only": return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
    default:            return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, sub }: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex gap-3 items-start">
      <div className="rounded-lg bg-primary/10 p-2 mt-0.5">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
        {sub && <div className="text-xs text-muted-foreground/70 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function TurnRow({ turn }: { turn: CodeSessionTurn }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
        onClick={() => setExpanded((p) => !p)}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        )}
        <MessageSquare className="h-3.5 w-3.5 text-primary flex-shrink-0" />
        <span className="text-xs font-medium text-foreground truncate flex-1">
          {turn.prompt.length > 120 ? turn.prompt.slice(0, 120) + "…" : turn.prompt}
        </span>
        <span className="text-[11px] text-muted-foreground flex-shrink-0 ml-2">
          {formatRelativeTime(turn.createdAt)}
        </span>
        {turn.elementsMasked > 0 && (
          <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 ml-2 flex-shrink-0">
            <Shield className="h-3 w-3" />
            {turn.elementsMasked}
          </span>
        )}
      </button>

      {expanded && (
        <div className="divide-y divide-border">
          {/* Files scanned */}
          {turn.filesScanned.length > 0 && (
            <div className="px-4 py-2 bg-blue-50/50 dark:bg-blue-950/20">
              <div className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 mb-1 flex items-center gap-1">
                <FileCode className="h-3 w-3" /> Files scanned
              </div>
              <div className="flex flex-wrap gap-1">
                {turn.filesScanned.map((f) => (
                  <code key={f} className="text-[11px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
                    {f}
                  </code>
                ))}
              </div>
            </div>
          )}

          {/* Prompt */}
          <div className="px-4 py-3">
            <div className="text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">
              Prompt (masked)
            </div>
            <pre className="text-xs whitespace-pre-wrap break-words font-mono text-foreground bg-muted/30 rounded-lg p-3 max-h-48 overflow-y-auto">
              {turn.prompt}
            </pre>
          </div>

          {/* Response */}
          <div className="px-4 py-3">
            <div className="text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">
              Response
            </div>
            <pre className="text-xs whitespace-pre-wrap break-words font-mono text-foreground bg-muted/30 rounded-lg p-3 max-h-64 overflow-y-auto">
              {turn.response}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

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
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Session header row */}
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
            {session.model.replace("claude-", "").replace(/-\d{8}$/, "")}
          </span>
          <span>{formatRelativeTime(session.lastTurnAt)}</span>
        </div>

        {/* Expand chevron */}
        <div className="flex-shrink-0 ml-1">
          {expanded
            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />
          }
        </div>
      </button>

      {/* Expanded conversation */}
      {expanded && (
        <div className="border-t border-border">
          {/* Mobile stats */}
          <div className="sm:hidden px-4 py-2 bg-muted/20 flex flex-wrap gap-3 text-[11px] text-muted-foreground border-b border-border">
            <span className="flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />{session.turnsCount} turns
            </span>
            <span className="flex items-center gap-1">
              <Shield className="h-3 w-3 text-emerald-500" />{session.totalElementsMasked} masked
            </span>
            <span className="flex items-center gap-1">
              <Cpu className="h-3 w-3" />{session.model}
            </span>
            <span>Started {formatDate(session.startedAt)}</span>
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
              {turns.map((turn) => (
                <TurnRow key={turn.id} turn={turn} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function Sessions() {
  const [sessions, setSessions] = useState<CodeSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.codeSessions(100);
      setSessions(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Derived stats
  const totalTurns          = sessions.reduce((s, x) => s + x.turnsCount, 0);
  const totalMasked         = sessions.reduce((s, x) => s + x.totalElementsMasked, 0);
  const uniqueProjects      = new Set(sessions.map((s) => s.projectName)).size;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Code Sessions</h1>
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
        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <StatCard
            label="Total sessions"
            value={sessions.length}
            icon={Terminal}
            sub={`${uniqueProjects} project${uniqueProjects !== 1 ? "s" : ""}`}
          />
          <StatCard
            label="Total turns"
            value={totalTurns}
            icon={MessageSquare}
            sub="prompts sent to Claude"
          />
          <StatCard
            label="Elements masked"
            value={totalMasked}
            icon={Shield}
            sub="across all sessions"
          />
        </div>

        {/* Error state */}
        {error && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="rounded-2xl bg-muted p-5 mb-4">
              <Terminal className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold mb-1">No code sessions yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Start a session with{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">
                llmask code [directory]
              </code>{" "}
              and session activity will appear here automatically.
            </p>
            <div className="mt-4 flex flex-col gap-1 text-xs text-muted-foreground font-mono bg-muted/50 rounded-xl p-4 text-left">
              <span className="text-primary font-semibold mb-1">Quick start</span>
              <span><span className="text-emerald-500">$</span> llmask code ./my-project</span>
              <span><span className="text-emerald-500">$</span> llmask code . --strategy aggressive</span>
              <span><span className="text-emerald-500">$</span> llmask code . --verbose --model claude-opus-4-5</span>
            </div>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-16 rounded-xl border border-border bg-muted/20 animate-pulse"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
        )}

        {/* Session list */}
        {!loading && sessions.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Recent sessions
              </h2>
            </div>
            <div className="space-y-2">
              {sessions.map((session) => (
                <SessionRow key={session.sessionId} session={session} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
