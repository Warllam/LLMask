import { useEffect, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Activity, FileText, Hash, Shield, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { api } from "@/lib/api";
import { useSSE } from "@/lib/use-sse";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { DashboardStats } from "@/lib/types";

const kindColors: Record<string, string> = {
  org: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  svc: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  tbl: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  col: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  idn: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400",
};

const PIE_COLORS = ["#6366f1", "#8b5cf6", "#f59e0b", "#10b981", "#f43f5e", "#06b6d4", "#ec4899"];

const statColors = ["indigo", "blue", "amber", "emerald"] as const;

export function Welcome() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const { events, isConnected } = useSSE("/dashboard/api/live");

  useEffect(() => {
    api
      .stats()
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const statCards = stats
    ? [
        {
          label: "Sessions",
          value: Object.keys(stats.requestsByEndpoint).length,
          icon: FileText,
        },
        { label: "Requests", value: stats.totalRequests, icon: Activity },
        { label: "Tokens Masked", value: stats.totalTransforms, icon: Hash },
        { label: "Entities", value: stats.totalMappings, icon: Shield },
      ]
    : [];

  const entityPieData = stats
    ? Object.entries(stats.mappingsByKind).map(([kind, count]) => ({
        name: kind.toUpperCase(),
        value: count,
      }))
    : [];

  return (
    <div className="p-4 md:p-6 space-y-6 h-full overflow-y-auto">
      {/* Hero banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 animate-gradient p-6 md:p-8 text-white">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48cGF0dGVybiBpZD0iZyIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIj48Y2lyY2xlIGN4PSIxMCIgY3k9IjEwIiByPSIxIiBmaWxsPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMDgpIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCBmaWxsPSJ1cmwoI2cpIiB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIvPjwvc3ZnPg==')] opacity-50" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="h-5 w-5" />
            <span className="text-sm font-semibold tracking-wide uppercase opacity-90">LLMask Dashboard</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold mb-1">
            Data Protection Overview
          </h1>
          <p className="text-sm opacity-80 max-w-lg">
            Real-time monitoring of your LLM data anonymization pipeline. All sensitive data is masked before reaching external providers.
          </p>
          {stats && (
            <div className="flex flex-wrap gap-4 mt-4">
              <div className="flex items-center gap-1.5 bg-white/15 rounded-lg px-3 py-1.5 text-sm font-medium">
                <Zap className="h-3.5 w-3.5" />
                {stats.totalTransforms.toLocaleString()} transforms applied
              </div>
              <div className="flex items-center gap-1.5 bg-white/15 rounded-lg px-3 py-1.5 text-sm font-medium">
                <Shield className="h-3.5 w-3.5" />
                {stats.totalMappings.toLocaleString()} entities protected
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-5">
                  <Skeleton className="h-3 w-20 mb-3" />
                  <Skeleton className="h-8 w-16" />
                </CardContent>
              </Card>
            ))
          : statCards.map((s, i) => (
              <StatCard
                key={s.label}
                label={s.label}
                value={s.value}
                icon={s.icon}
                color={statColors[i]}
                delay={i * 60}
              />
            ))}
      </div>

      {/* Entity breakdown + Live feed row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Entity donut chart */}
        {stats && entityPieData.length > 0 && (
          <Card className="animate-fade-in-up" style={{ animationDelay: "200ms" }}>
            <CardHeader>
              <CardTitle>Entities by Kind</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div className="w-32 h-32 flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={entityPieData}
                        innerRadius={30}
                        outerRadius={55}
                        paddingAngle={3}
                        dataKey="value"
                        strokeWidth={0}
                      >
                        {entityPieData.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          borderColor: "hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "11px",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-1.5 flex-1 min-w-0">
                  {entityPieData.map((entry, i) => (
                    <div key={entry.name} className="flex items-center gap-2">
                      <div
                        className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                      />
                      <span className="text-xs text-muted-foreground truncate">{entry.name}</span>
                      <span className="text-xs font-mono font-medium ml-auto">{entry.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Live feed */}
        <Card className={cn("animate-fade-in-up", entityPieData.length > 0 ? "lg:col-span-2" : "lg:col-span-3")} style={{ animationDelay: "300ms" }}>
          <CardHeader className="flex flex-row items-center gap-2">
            <div className="relative flex items-center justify-center">
              <div
                className={cn(
                  "h-2.5 w-2.5 rounded-full",
                  isConnected ? "bg-emerald-500" : "bg-muted-foreground"
                )}
              />
              {isConnected && (
                <div className="absolute h-2.5 w-2.5 rounded-full bg-emerald-500 animate-ping" />
              )}
            </div>
            <CardTitle>Live Feed</CardTitle>
            {!isConnected && (
              <Badge variant="outline" className="ml-auto text-xs">
                Disconnected
              </Badge>
            )}
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Waiting for masking events…
              </p>
            ) : (
              <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
                {events.map((event, i) => {
                  if (!("endpoint" in event)) return null;
                  return (
                    <div
                      key={i}
                      className="flex items-start gap-3 p-3 rounded-xl border border-border hover:bg-muted/30 transition-colors animate-slide-in-left"
                      style={{ animationDelay: `${i * 30}ms` }}
                    >
                      <div className="rounded-lg bg-indigo-50 dark:bg-indigo-950/30 p-1.5 mt-0.5">
                        <Activity className="h-3.5 w-3.5 text-indigo-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">
                            {event.endpoint}
                          </span>
                          {event.model && (
                            <Badge variant="secondary" className="text-[10px]">
                              {event.model}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          {event.entityKinds.map((k) => (
                            <span
                              key={k}
                              className={cn(
                                "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                                kindColors[k] ?? "bg-secondary text-secondary-foreground"
                              )}
                            >
                              {k}
                            </span>
                          ))}
                          <span className="text-xs text-muted-foreground">
                            {event.transformedCount} masked
                          </span>
                        </div>
                      </div>
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                        {formatRelativeTime(event.timestamp)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top tokens */}
      {stats && stats.topTokens.length > 0 && (
        <Card className="animate-fade-in-up" style={{ animationDelay: "400ms" }}>
          <CardHeader>
            <CardTitle>Top Masked Tokens</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2.5 px-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                      Original
                    </th>
                    <th className="text-left py-2.5 px-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                      Pseudonym
                    </th>
                    <th className="text-left py-2.5 px-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                      Kind
                    </th>
                    <th className="text-right py-2.5 px-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                      Count
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stats.topTokens.slice(0, 10).map((t, i) => (
                    <tr
                      key={i}
                      className="border-b border-border/50 hover:bg-muted/30 transition-colors group"
                    >
                      <td className="py-2.5 px-3 font-mono text-destructive">
                        {t.originalValue}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-emerald-600 dark:text-emerald-400">
                        {t.pseudonym}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                            kindColors[t.kind] ?? "bg-secondary text-secondary-foreground"
                          )}
                        >
                          {t.kind.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden hidden sm:block">
                            <div
                              className="progress-bar h-full"
                              style={{
                                width: `${Math.min(100, (t.occurrences / (stats.topTokens[0]?.occurrences || 1)) * 100)}%`,
                              }}
                            />
                          </div>
                          <span className="font-mono text-muted-foreground tabular-nums">
                            {t.occurrences}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
