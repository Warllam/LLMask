import { useEffect, useState } from "react";
import {
  ClipboardList,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Shield,
  CheckCircle2,
  XCircle,
  Clock,
  Eye,
  EyeOff,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { RequestLogEntry } from "@/lib/types";

function formatDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" }),
    time: d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  };
}

function tryParseMessages(body: string): string | null {
  try {
    const parsed = JSON.parse(body);
    // Chat-completions format
    if (Array.isArray(parsed.messages)) {
      const userMsg = [...parsed.messages].reverse().find((m: { role: string }) => m.role === "user");
      if (userMsg && typeof userMsg.content === "string") return userMsg.content;
    }
    // Responses API format
    if (Array.isArray(parsed.input)) {
      const userMsg = [...parsed.input].reverse().find((m: { role: string }) => m.role === "user");
      if (userMsg && Array.isArray(userMsg.content)) {
        const block = userMsg.content.find((b: { type: string }) => b.type === "input_text");
        if (block?.text) return block.text;
      }
    }
  } catch { /* ignore */ }
  return null;
}

function RowDetail({ entry }: { entry: RequestLogEntry }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const originalMsg = tryParseMessages(entry.originalBody);
  const maskedMsg = tryParseMessages(entry.rewrittenBody);

  return (
    <div className="px-4 pb-4 space-y-3 animate-fade-in">
      {/* Original vs masked comparison */}
      {(originalMsg || maskedMsg) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/20 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <EyeOff className="h-3.5 w-3.5 text-rose-500" />
              <span className="text-xs font-semibold text-rose-700 dark:text-rose-400">Message original</span>
            </div>
            <p className="text-xs font-mono text-rose-900 dark:text-rose-200 whitespace-pre-wrap break-words leading-relaxed">
              {originalMsg ?? "—"}
            </p>
          </div>
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Shield className="h-3.5 w-3.5 text-emerald-500" />
              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Message masqué / envoyé au fournisseur IA</span>
            </div>
            <p className="text-xs font-mono text-emerald-900 dark:text-emerald-200 whitespace-pre-wrap break-words leading-relaxed">
              {maskedMsg ?? "—"}
            </p>
          </div>
        </div>
      )}

      {/* Raw JSON toggle */}
      <button
        onClick={() => setShowOriginal((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Eye className="h-3.5 w-3.5" />
        {showOriginal ? "Masquer les données brutes" : "Voir les données brutes (JSON)"}
      </button>
      {showOriginal && (
        <div className="rounded-xl border border-border bg-muted/30 p-3 max-h-48 overflow-auto">
          <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap break-words">
            {JSON.stringify(JSON.parse(entry.rewrittenBody), null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export function RequestLog() {
  const [entries, setEntries] = useState<RequestLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const data = await api.recentRequests(100);
      setEntries(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="p-4 md:p-6 space-y-4 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold">Journal des requêtes</h1>
            <span className="text-sm text-muted-foreground font-normal">/ Request log</span>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Historique des requêtes traitées par le proxy de masquage.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => load(true)}
          disabled={refreshing}
          className="gap-1.5"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          Actualiser
        </Button>
      </div>

      {/* Summary badges */}
      {!loading && entries.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="gap-1.5">
            <ClipboardList className="h-3 w-3" />
            {entries.length} requêtes
          </Badge>
          <Badge variant="secondary" className="gap-1.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
            <Shield className="h-3 w-3" />
            {entries.reduce((s, e) => s + e.transformedCount, 0).toLocaleString()} éléments masqués
          </Badge>
          {Array.from(new Set(entries.map((e) => e.model).filter(Boolean))).length > 0 && (
            <Badge variant="secondary" className="gap-1.5">
              {Array.from(new Set(entries.map((e) => e.model).filter(Boolean))).length} modèle(s)
            </Badge>
          )}
        </div>
      )}

      {/* Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground font-normal">
            Cliquez sur une ligne pour voir le détail — Click a row to see details
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
              <ClipboardList className="h-10 w-10 opacity-30" />
              <p className="text-sm">Aucune requête enregistrée</p>
              <p className="text-xs opacity-70">No requests logged yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left py-3 px-4 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold w-8" />
                    <th className="text-left py-3 px-4 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                      Date / Heure
                    </th>
                    <th className="text-left py-3 px-4 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                      Modèle IA
                    </th>
                    <th className="text-left py-3 px-4 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                      Endpoint
                    </th>
                    <th className="text-center py-3 px-4 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                      Éléments masqués
                    </th>
                    <th className="text-left py-3 px-4 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                      Statut
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const isOpen = expanded === entry.id;
                    const { date, time } = formatDateTime(entry.createdAt);
                    const hasResponse = !!entry.responseBody;
                    return (
                      <>
                        <tr
                          key={entry.id}
                          onClick={() => setExpanded(isOpen ? null : entry.id)}
                          className={cn(
                            "border-b border-border/50 cursor-pointer transition-colors",
                            isOpen
                              ? "bg-primary/5"
                              : "hover:bg-muted/30"
                          )}
                        >
                          <td className="py-3 px-4">
                            {isOpen
                              ? <ChevronDown className="h-4 w-4 text-primary" />
                              : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1.5 text-xs">
                              <Clock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                              <span className="font-mono">{time}</span>
                            </div>
                            <div className="text-[10px] text-muted-foreground font-mono pl-4">{date}</div>
                          </td>
                          <td className="py-3 px-4">
                            {entry.model ? (
                              <Badge variant="secondary" className="text-[10px] font-mono max-w-[120px] truncate block">
                                {entry.model}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-xs font-mono text-muted-foreground truncate max-w-[100px] block">
                              {entry.endpoint}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center">
                            {entry.transformedCount > 0 ? (
                              <div className="inline-flex items-center gap-1 bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400 rounded-full px-2.5 py-0.5 text-xs font-semibold">
                                <Shield className="h-3 w-3" />
                                {entry.transformedCount}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">0</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {hasResponse ? (
                              <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Succès
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <XCircle className="h-3.5 w-3.5" />
                                Pas de réponse
                              </div>
                            )}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr key={`${entry.id}-detail`} className="bg-muted/20">
                            <td colSpan={6} className="p-0">
                              <RowDetail entry={entry} />
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
