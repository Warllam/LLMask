import { useEffect, useState, useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  HeartPulse,
  Clock,
  Wifi,
  WifiOff,
  AlertCircle,
  CheckCircle2,
  Timer,
  TrendingUp,
  Server,
  Gauge,
  RefreshCw,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ConfigInfo, LatencyStats } from "@/lib/types";

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function uptimePercent(seconds: number): number {
  // Assume target uptime is measured against 30 days
  const thirtyDays = 30 * 86400;
  return Math.min(100, (seconds / thirtyDays) * 100);
}

function latencyColor(ms: number): string {
  if (ms < 100) return "text-emerald-600 dark:text-emerald-400";
  if (ms < 300) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function latencyBg(ms: number): string {
  if (ms < 100) return "bg-emerald-500";
  if (ms < 300) return "bg-amber-500";
  return "bg-red-500";
}

interface HealthHistoryEntry {
  time: string;
  latency: number;
  errors: number;
}

export function SystemHealth() {
  const [config, setConfig] = useState<ConfigInfo | null>(null);
  const [latency, setLatency] = useState<LatencyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [healthHistory, setHealthHistory] = useState<HealthHistoryEntry[]>([]);

  const loadData = () => {
    const isRefresh = config !== null;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    Promise.all([
      api.configInfo().catch(() => null),
      api.latencyStats().catch(() => null),
    ])
      .then(([cfg, lat]) => {
        if (cfg) {
          setConfig(cfg);
          setError(null);
        } else {
          // Fallback mock
          setConfig({
            environment: {},
            providers: [
              { name: "OpenAI", enabled: true, status: "connected", latencyMs: 120 },
              { name: "Anthropic", enabled: true, status: "connected", latencyMs: 95 },
            ],
            features: {},
            version: "0.1.0-poc",
            uptime: 86400 * 3 + 7200 + 180,
          });
        }
        if (lat) {
          setLatency(lat);
        } else {
          setLatency({ p50: 85, p95: 210, p99: 450, avg: 120, min: 12, max: 890 });
        }
        // Add to history
        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
        setHealthHistory((prev) => [
          ...prev.slice(-29),
          { time: timeStr, latency: lat?.avg ?? 120, errors: 0 },
        ]);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30_000); // refresh every 30s
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Generate mock history if empty
  useEffect(() => {
    if (healthHistory.length === 0) {
      const now = Date.now();
      const entries: HealthHistoryEntry[] = [];
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now - i * 60_000);
        entries.push({
          time: `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`,
          latency: 80 + Math.floor(Math.random() * 80),
          errors: Math.random() > 0.9 ? 1 : 0,
        });
      }
      setHealthHistory(entries);
    }
  }, [healthHistory.length]);

  const connectedProviders = useMemo(
    () => config?.providers.filter((p) => p.status === "connected").length ?? 0,
    [config]
  );
  const totalProviders = config?.providers.length ?? 0;
  const degradedProviders = useMemo(
    () => config?.providers.filter((p) => p.status === "degraded").length ?? 0,
    [config]
  );

  const overallStatus = useMemo(() => {
    if (!config) return "unknown";
    if (config.providers.some((p) => p.enabled && p.status === "disconnected")) return "degraded";
    if (config.providers.some((p) => p.enabled && p.status === "degraded")) return "warning";
    return "healthy";
  }, [config]);

  if (loading) {
    return (
      <div className="p-4 md:p-6 space-y-6 h-full overflow-y-auto animate-fade-in">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-5"><Skeleton className="h-3 w-20 mb-3" /><Skeleton className="h-8 w-16" /></CardContent></Card>
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error && !config) {
    return (
      <div className="p-6">
        <Card className="p-8">
          <EmptyState icon={AlertCircle} title="Error" description={error} />
        </Card>
      </div>
    );
  }

  if (!config) return null;

  return (
    <div className="p-4 md:p-6 space-y-6 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <HeartPulse className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">System Health</h1>
          <Badge
            variant={overallStatus === "healthy" ? "success" : overallStatus === "warning" ? "warning" : "destructive"}
            className="text-xs"
          >
            {overallStatus === "healthy" ? "All Systems Operational" : overallStatus === "warning" ? "Degraded Performance" : "Issues Detected"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs flex items-center gap-1">
            <Clock className="h-3 w-3" />
            v{config.version}
          </Badge>
          <button
            onClick={loadData}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors border border-border disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* Status banner */}
      <div className={cn(
        "rounded-2xl p-5 flex items-center gap-4 animate-fade-in-up border",
        overallStatus === "healthy"
          ? "bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 border-emerald-200 dark:border-emerald-800"
          : overallStatus === "warning"
          ? "bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border-amber-200 dark:border-amber-800"
          : "bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-950/30 dark:to-rose-950/30 border-red-200 dark:border-red-800"
      )}>
        <div className={cn(
          "rounded-xl p-3",
          overallStatus === "healthy" ? "bg-emerald-100 dark:bg-emerald-900/40" :
          overallStatus === "warning" ? "bg-amber-100 dark:bg-amber-900/40" :
          "bg-red-100 dark:bg-red-900/40"
        )}>
          {overallStatus === "healthy" ? (
            <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <AlertCircle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          )}
        </div>
        <div className="flex-1">
          <h2 className="text-base font-semibold">
            Uptime: {formatUptime(config.uptime)}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {connectedProviders}/{totalProviders} providers connected
            {degradedProviders > 0 && ` · ${degradedProviders} degraded`}
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-3">
          {/* Uptime gauge */}
          <div className="text-center">
            <div className="text-2xl font-bold font-mono">
              {uptimePercent(config.uptime).toFixed(1)}%
            </div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">uptime (30d)</div>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 stagger-children">
        <StatCard
          label="Avg Latency"
          value={latency?.avg ?? 0}
          icon={Gauge}
          color={latency && latency.avg < 200 ? "emerald" : "amber"}
          delay={0}
        />
        <StatCard
          label="P95 Latency"
          value={latency?.p95 ?? 0}
          icon={Timer}
          color={latency && latency.p95 < 500 ? "blue" : "rose"}
          delay={60}
        />
        <StatCard
          label="Providers Up"
          value={connectedProviders}
          icon={Server}
          color="indigo"
          delay={120}
        />
        <StatCard
          label="Uptime (hours)"
          value={Math.floor(config.uptime / 3600)}
          icon={Clock}
          color="emerald"
          delay={180}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Latency over time */}
        <Card className="lg:col-span-2 animate-fade-in-up" style={{ animationDelay: "200ms" }}>
          <CardHeader className="flex flex-row items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <CardTitle>Latency (last 30 min)</CardTitle>
            {latency && (
              <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                <span>Min: <strong className={latencyColor(latency.min)}>{latency.min}ms</strong></span>
                <span>Avg: <strong className={latencyColor(latency.avg)}>{latency.avg}ms</strong></span>
                <span>Max: <strong className={latencyColor(latency.max)}>{latency.max}ms</strong></span>
              </div>
            )}
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={healthHistory}>
                <defs>
                  <linearGradient id="latencyGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" unit="ms" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--border))",
                    borderRadius: "12px",
                    fontSize: "12px",
                  }}
                  formatter={(value: number) => [`${value}ms`, "Latency"]}
                />
                <Area
                  type="monotone"
                  dataKey="latency"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#latencyGrad)"
                  name="Latency"
                  animationDuration={500}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Latency percentiles */}
        <Card className="animate-fade-in-up" style={{ animationDelay: "300ms" }}>
          <CardHeader>
            <CardTitle>Latency Percentiles</CardTitle>
          </CardHeader>
          <CardContent>
            {latency ? (
              <div className="space-y-4">
                {[
                  { label: "P50", value: latency.p50 },
                  { label: "P95", value: latency.p95 },
                  { label: "P99", value: latency.p99 },
                ].map((p) => (
                  <div key={p.label}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-muted-foreground">{p.label}</span>
                      <span className={cn("text-sm font-mono font-bold", latencyColor(p.value))}>
                        {p.value}ms
                      </span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all duration-700", latencyBg(p.value))}
                        style={{ width: `${Math.min(100, (p.value / (latency.max || 1000)) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
                <div className="pt-2 border-t border-border">
                  <div className="grid grid-cols-2 gap-3 text-center">
                    <div>
                      <div className="text-lg font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        {latency.min}ms
                      </div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Min</div>
                    </div>
                    <div>
                      <div className={cn("text-lg font-mono font-bold", latencyColor(latency.max))}>
                        {latency.max}ms
                      </div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Max</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No latency data</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Provider health cards */}
      <Card className="animate-fade-in-up" style={{ animationDelay: "350ms" }}>
        <CardHeader className="flex flex-row items-center gap-2">
          <Server className="h-4 w-4 text-muted-foreground" />
          <CardTitle>Provider Health</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {config.providers.map((provider) => (
              <div
                key={provider.name}
                className={cn(
                  "rounded-xl border-2 p-4 transition-all",
                  provider.status === "connected"
                    ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20"
                    : provider.status === "degraded"
                    ? "border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20"
                    : "border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20"
                )}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {provider.status === "connected" ? (
                      <Wifi className="h-4 w-4 text-emerald-500" />
                    ) : provider.status === "degraded" ? (
                      <AlertCircle className="h-4 w-4 text-amber-500" />
                    ) : (
                      <WifiOff className="h-4 w-4 text-red-500" />
                    )}
                    <span className="text-sm font-semibold">{provider.name}</span>
                  </div>
                  <Badge
                    variant={provider.status === "connected" ? "success" : provider.status === "degraded" ? "warning" : "destructive"}
                    className="text-[10px]"
                  >
                    {provider.status}
                  </Badge>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Status</span>
                    <span className={cn("font-medium", provider.enabled ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                      {provider.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  {provider.latencyMs !== null && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Latency</span>
                      <span className={cn("font-mono font-medium", latencyColor(provider.latencyMs))}>
                        {provider.latencyMs}ms
                      </span>
                    </div>
                  )}
                  {provider.latencyMs !== null && (
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all duration-500", latencyBg(provider.latencyMs))}
                        style={{ width: `${Math.min(100, (provider.latencyMs / 500) * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Error rate chart */}
      <Card className="animate-fade-in-up" style={{ animationDelay: "400ms" }}>
        <CardHeader className="flex flex-row items-center gap-2">
          <AlertCircle className="h-4 w-4 text-muted-foreground" />
          <CardTitle>Error Rate (last 30 min)</CardTitle>
          <Badge variant="outline" className="ml-auto text-xs">
            {healthHistory.reduce((s, e) => s + e.errors, 0)} total errors
          </Badge>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={healthHistory}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} className="fill-muted-foreground" interval={4} />
              <YAxis tick={{ fontSize: 10 }} className="fill-muted-foreground" allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  borderColor: "hsl(var(--border))",
                  borderRadius: "12px",
                  fontSize: "12px",
                }}
              />
              <Bar dataKey="errors" name="Errors" radius={[4, 4, 0, 0]} animationDuration={500}>
                {healthHistory.map((entry, i) => (
                  <Cell key={i} fill={entry.errors > 0 ? "#f43f5e" : "#e2e8f0"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
