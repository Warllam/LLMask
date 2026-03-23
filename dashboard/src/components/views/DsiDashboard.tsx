import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { FilterPanel } from "@/components/ui/filter-panel";
import { ExportButton } from "@/components/ui/export-button";
import { Timeline, type TimelineEvent } from "@/components/ui/timeline";
import { Activity, Hash, Shield, Users, CheckCircle2, AlertTriangle, TrendingUp, Clock } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { downloadJSON, downloadCSV } from "@/lib/export";
import type { FilterState } from "@/lib/filters";
import { defaultFilters } from "@/lib/filters";
import type { DsiStats, LeakReport } from "@/lib/types";

const kindColors: Record<string, string> = {
  org: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  svc: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  tbl: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  col: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  idn: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400",
};

const PIE_COLORS = ["#6366f1", "#8b5cf6", "#f59e0b", "#10b981", "#f43f5e", "#06b6d4"];
const statColors = ["indigo", "emerald", "amber", "blue"] as const;

function totalLeakCount(report: LeakReport): number {
  return report.requestLeaks + report.responseLeaks + report.shieldLeaks;
}

export function DsiDashboard() {
  const [stats, setStats] = useState<DsiStats | null>(null);
  const [leaks, setLeaks] = useState<LeakReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [activeTab, setActiveTab] = useState<"overview" | "timeline">("overview");

  useEffect(() => {
    Promise.all([api.dsiStats(), api.dsiLeaks()])
      .then(([s, l]) => {
        setStats(s);
        setLeaks(l);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Derive available filter options from stats
  const availableModels = useMemo(
    () => (stats ? Object.keys(stats.requestsByModel) : []),
    [stats]
  );
  const availablePiiTypes = useMemo(
    () => (stats ? Object.keys(stats.entitiesByKind) : []),
    [stats]
  );

  // Filter requestsByDay by date range
  const filteredDayData = useMemo(() => {
    if (!stats) return [];
    return stats.requestsByDay.filter((d) => {
      if (filters.dateFrom && d.date < filters.dateFrom) return false;
      if (filters.dateTo && d.date > filters.dateTo) return false;
      return true;
    });
  }, [stats, filters.dateFrom, filters.dateTo]);

  // Build timeline events from leak details
  const timelineEvents = useMemo((): TimelineEvent[] => {
    const events: TimelineEvent[] = [];
    if (leaks) {
      for (const detail of leaks.leakDetails) {
        const allLeaks = [
          ...detail.leakedOriginals.map((l) => ({ ...l, type: "original" as const })),
          ...detail.leakedPseudonyms.map((l) => ({ ...l, type: "pseudonym" as const })),
          ...detail.leakedShieldTerms.map((l) => ({ ...l, type: "shield" as const })),
        ];
        events.push({
          id: detail.requestId,
          timestamp: detail.createdAt,
          title: `Leak detected — ${detail.endpoint}`,
          description: `${allLeaks.length} leaked value(s): ${allLeaks.slice(0, 3).map((l) => l.value).join(", ")}`,
          type: "alert",
          severity: detail.leakedOriginals.length > 0 ? "critical" : "warning",
          metadata: {
            request: detail.requestId.slice(0, 8),
            originals: detail.leakedOriginals.length,
            pseudonyms: detail.leakedPseudonyms.length,
          },
        });
      }
    }
    if (stats) {
      for (const day of stats.requestsByDay) {
        events.push({
          id: `day-${day.date}`,
          timestamp: `${day.date}T12:00:00Z`,
          title: `${day.count} requests processed`,
          type: "session",
          metadata: { date: day.date },
        });
      }
    }
    return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [stats, leaks]);

  // Export handlers
  const handleExportJSON = () => {
    downloadJSON({ stats, leaks, exportedAt: new Date().toISOString() }, "dsi-report.json");
  };
  const handleExportCSV = () => {
    if (!stats) return;
    const rows = stats.requestsByDay.map((d) => ({ date: d.date, requests: d.count }));
    downloadCSV(rows, "dsi-requests.csv");
  };

  if (loading) {
    return (
      <div className="p-4 md:p-6 space-y-6 animate-fade-in" role="status" aria-label="Loading dashboard">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <Skeleton className="h-3 w-20 mb-3" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-48 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!stats) return null;

  const metricCards = [
    { label: "Total Requests", value: stats.totalRequests, icon: Activity, color: statColors[0] },
    { label: "Entities Detected", value: stats.totalEntities, icon: Shield, color: statColors[1] },
    { label: "Transforms", value: stats.totalTransforms, icon: Hash, color: statColors[2] },
    { label: "Sessions", value: stats.sessions, icon: Users, color: statColors[3] },
  ];

  const entityData = Object.entries(stats.entitiesByKind)
    .filter(([ kind ]) => filters.piiTypes.length === 0 || filters.piiTypes.includes(kind))
    .map(([kind, count]) => ({ kind: kind.toUpperCase(), count }));

  const modelData = Object.entries(stats.requestsByModel)
    .filter(([model]) => filters.providers.length === 0 || filters.providers.includes(model))
    .map(([model, count]) => ({ name: model, value: count }));

  const leakCount = leaks ? totalLeakCount(leaks) : 0;
  const isSecure = leakCount === 0;

  return (
    <div className="p-4 md:p-6 space-y-6 h-full overflow-y-auto" role="main" aria-label="Security Dashboard">
      {/* Top bar: tabs + filters + export */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="Dashboard views">
          <button
            role="tab"
            aria-selected={activeTab === "overview"}
            onClick={() => setActiveTab("overview")}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
              activeTab === "overview" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Overview
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "timeline"}
            onClick={() => setActiveTab("timeline")}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5",
              activeTab === "timeline" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            Timeline
          </button>
        </div>
        <div className="flex items-center gap-2">
          <FilterPanel
            filters={filters}
            onChange={setFilters}
            availableProviders={availableModels}
            availablePiiTypes={availablePiiTypes}
          />
          <ExportButton onExportJSON={handleExportJSON} onExportCSV={handleExportCSV} />
        </div>
      </div>

      {/* Timeline tab */}
      {activeTab === "timeline" && (
        <Card className="animate-fade-in">
          <CardHeader className="flex flex-row items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <CardTitle>Event Timeline</CardTitle>
            <Badge variant="outline" className="ml-auto text-xs">
              {timelineEvents.length} events
            </Badge>
          </CardHeader>
          <CardContent>
            {timelineEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No events yet</p>
            ) : (
              <Timeline events={timelineEvents} maxItems={100} />
            )}
          </CardContent>
        </Card>
      )}

      {/* Overview tab */}
      {activeTab === "overview" && (
        <>
          {/* Security status banner */}
          <div
            className={cn(
              "rounded-2xl p-4 md:p-5 flex items-center gap-4 animate-fade-in-up",
              isSecure
                ? "bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 border border-emerald-200 dark:border-emerald-800"
                : "bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border border-amber-200 dark:border-amber-800"
            )}
            role="alert"
            aria-live="polite"
          >
            <div className={cn(
              "rounded-xl p-3",
              isSecure ? "bg-emerald-100 dark:bg-emerald-900/40" : "bg-amber-100 dark:bg-amber-900/40"
            )}>
              {isSecure ? (
                <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              ) : (
                <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              )}
            </div>
            <div>
              <h2 className={cn(
                "text-base font-semibold",
                isSecure ? "text-emerald-800 dark:text-emerald-300" : "text-amber-800 dark:text-amber-300"
              )}>
                {isSecure ? "All Systems Secure" : `${leakCount} Leak${leakCount !== 1 ? "s" : ""} Detected`}
              </h2>
              <p className={cn(
                "text-xs mt-0.5",
                isSecure ? "text-emerald-600/80 dark:text-emerald-400/60" : "text-amber-600/80 dark:text-amber-400/60"
              )}>
                {isSecure
                  ? `${leaks?.totalRequestsScanned ?? 0} requests scanned — all sensitive data properly masked`
                  : `Review the leak details below. ${leaks?.totalRequestsScanned ?? 0} requests scanned.`
                }
              </p>
            </div>
            <div className="ml-auto hidden sm:flex items-center gap-1.5">
              <Badge variant="outline" className="text-xs">
                Avg {stats.avgTransformsPerRequest.toFixed(1)} transforms/req
              </Badge>
            </div>
          </div>

          {/* Metric cards */}
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 stagger-children">
            {metricCards.map((m, i) => (
              <StatCard
                key={m.label}
                label={m.label}
                value={m.value}
                icon={m.icon}
                color={m.color}
                delay={i * 60}
              />
            ))}
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2 animate-fade-in-up" style={{ animationDelay: "200ms" }}>
              <CardHeader>
                <CardTitle>Entities by Kind</CardTitle>
              </CardHeader>
              <CardContent>
                {entityData.length === 0 ? (
                  <EmptyState
                    icon={Shield}
                    title="No data for current filters"
                    description="Try widening provider/type/date filters to visualize entity distribution."
                  />
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={entityData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="kind" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                      <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          borderColor: "hsl(var(--border))",
                          borderRadius: "12px",
                          fontSize: "12px",
                          boxShadow: "0 4px 12px rgb(0 0 0 / 0.1)",
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: "11px" }} />
                      <Bar dataKey="count" radius={[6, 6, 0, 0]} name="Detections" animationDuration={800} animationEasing="ease-out">
                        {entityData.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="animate-fade-in-up" style={{ animationDelay: "300ms" }}>
              <CardHeader>
                <CardTitle>By Model</CardTitle>
              </CardHeader>
              <CardContent>
                {modelData.length === 0 ? (
                  <EmptyState
                    icon={Users}
                    title="No model data"
                    description="No requests match the current provider/date filters."
                  />
                ) : (
                  <div className="flex flex-col items-center">
                    <ResponsiveContainer width="100%" height={160}>
                      <PieChart>
                        <Pie
                          data={modelData}
                          innerRadius={35}
                          outerRadius={65}
                          paddingAngle={3}
                          dataKey="value"
                          strokeWidth={0}
                        >
                          {modelData.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            borderColor: "hsl(var(--border))",
                            borderRadius: "12px",
                            fontSize: "11px",
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-1 w-full mt-2">
                      {modelData.map((m, i) => (
                        <div key={m.name} className="flex items-center gap-2 text-xs">
                          <div
                            className="h-2 w-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                            aria-hidden="true"
                          />
                          <span className="text-muted-foreground truncate flex-1">{m.name}</span>
                          <span className="font-mono font-medium">{m.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Trend chart: Requests + Transforms over time */}
          <Card className="animate-fade-in-up" style={{ animationDelay: "350ms" }}>
            <CardHeader className="flex flex-row items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <CardTitle>Request Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {filteredDayData.length === 0 ? (
                <EmptyState
                  icon={Activity}
                  title="No activity in selected range"
                  description="Adjust the date range to display request trends."
                />
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={filteredDayData}>
                    <defs>
                      <linearGradient id="colorReqs" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                    <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        borderColor: "hsl(var(--border))",
                        borderRadius: "12px",
                        fontSize: "12px",
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="#6366f1"
                      strokeWidth={2}
                      fill="url(#colorReqs)"
                      name="Requests"
                      animationDuration={800}
                      animationEasing="ease-out"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Leaks detail */}
          {leaks && leakCount > 0 && (
            <Card className="animate-fade-in-up border-amber-200 dark:border-amber-800" style={{ animationDelay: "400ms" }}>
              <CardHeader className="flex flex-row items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden="true" />
                <CardTitle>Leak Details</CardTitle>
                <div className="flex gap-3 ml-auto text-sm">
                  {leaks.requestLeaks > 0 && (
                    <span className="text-destructive font-medium">{leaks.requestLeaks} in requests</span>
                  )}
                  {leaks.responseLeaks > 0 && (
                    <span className="text-amber-600 dark:text-amber-400 font-medium">{leaks.responseLeaks} in responses</span>
                  )}
                  {leaks.shieldLeaks > 0 && (
                    <span className="text-purple-600 dark:text-purple-400 font-medium">{leaks.shieldLeaks} shield</span>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto" role="table" aria-label="Leak details">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th scope="col" className="text-left py-2.5 px-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Request</th>
                        <th scope="col" className="text-left py-2.5 px-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Endpoint</th>
                        <th scope="col" className="text-left py-2.5 px-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Leaked Values</th>
                        <th scope="col" className="text-left py-2.5 px-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaks.leakDetails.map((detail, i) => {
                        const allLeaks = [
                          ...detail.leakedOriginals.map((l) => ({ ...l, type: "original" as const })),
                          ...detail.leakedPseudonyms.map((l) => ({ ...l, type: "pseudonym" as const })),
                          ...detail.leakedShieldTerms.map((l) => ({ ...l, type: "shield" as const })),
                        ];
                        return (
                          <tr key={i} className="border-b border-border/50 hover:bg-muted/30 transition-colors align-top">
                            <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground">{detail.requestId.slice(0, 8)}</td>
                            <td className="py-2.5 px-3 text-xs">{detail.endpoint}</td>
                            <td className="py-2.5 px-3 font-mono text-xs">
                              <div className="flex flex-wrap gap-1">
                                {allLeaks.slice(0, 5).map((l, j) => (
                                  <span key={j} className="text-destructive bg-destructive/5 rounded px-1">{l.value}</span>
                                ))}
                                {allLeaks.length > 5 && (
                                  <span className="text-muted-foreground">+{allLeaks.length - 5}</span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-3">
                              <Badge variant={
                                detail.leakedOriginals.length > 0 ? "destructive" :
                                detail.leakedShieldTerms.length > 0 ? "warning" : "secondary"
                              }>
                                {detail.leakedOriginals.length > 0 ? "original" :
                                 detail.leakedShieldTerms.length > 0 ? "shield" : "pseudo"}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Sample mappings */}
          {stats.sampleMappings.length > 0 && (
            <Card className="animate-fade-in-up" style={{ animationDelay: "450ms" }}>
              <CardHeader>
                <CardTitle>Sample Mappings</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {stats.sampleMappings.map((m, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 rounded-xl border border-border p-3 hover:bg-muted/30 transition-colors"
                    >
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium flex-shrink-0",
                          kindColors[m.kind] ?? "bg-secondary text-secondary-foreground"
                        )}
                      >
                        {m.kind.toUpperCase()}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-xs text-destructive truncate">{m.original}</div>
                        <div className="font-mono text-xs text-emerald-600 dark:text-emerald-400 truncate">→ {m.pseudonym}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
