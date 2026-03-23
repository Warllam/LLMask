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
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/ui/stat-card";
import { SectionHeader } from "@/components/ui/section-header";
import {
  Activity,
  Clock,
  Zap,
  Shield,
  AlertCircle,
  TrendingUp,
  Timer,
  Search,
} from "lucide-react";
import { useSSE } from "@/lib/use-sse";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { LiveMaskingEvent } from "@/lib/types";

const PIE_COLORS = ["#6366f1", "#8b5cf6", "#f59e0b", "#10b981", "#f43f5e", "#06b6d4"];

const kindColors: Record<string, string> = {
  org: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  svc: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  tbl: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  col: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  idn: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400",
};

interface RpmBucket {
  time: string;
  count: number;
}

export function ActivityFeed() {
  const { events, isConnected } = useSSE("/dashboard/api/live");
  const [isPaused, setIsPaused] = useState(false);
  const [frozenEvents, setFrozenEvents] = useState<LiveMaskingEvent[]>([]);
  const [query, setQuery] = useState("");

  const maskingEvents = useMemo(
    () => events.filter((e): e is LiveMaskingEvent => "endpoint" in e),
    [events]
  );

  useEffect(() => {
    if (!isPaused) return;
    setFrozenEvents(maskingEvents);
  }, [isPaused, maskingEvents]);

  const displayEvents = useMemo(() => {
    const source = isPaused ? frozenEvents : maskingEvents;
    if (!query.trim()) return source;
    const q = query.toLowerCase();
    return source.filter((e) =>
      e.endpoint.toLowerCase().includes(q) ||
      (e.model?.toLowerCase().includes(q) ?? false) ||
      e.entityKinds.some((k) => k.toLowerCase().includes(q))
    );
  }, [isPaused, frozenEvents, maskingEvents, query]);

  const rpmData = useMemo((): RpmBucket[] => {
    const now = Date.now();
    const buckets: RpmBucket[] = [];
    for (let i = 9; i >= 0; i--) {
      const bucketStart = now - (i + 1) * 60_000;
      const bucketEnd = now - i * 60_000;
      const count = maskingEvents.filter((e) => {
        const t = new Date(e.timestamp).getTime();
        return t >= bucketStart && t < bucketEnd;
      }).length;
      const d = new Date(bucketEnd);
      buckets.push({
        time: `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`,
        count,
      });
    }
    return buckets;
  }, [maskingEvents]);

  const entityBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of maskingEvents) {
      for (const k of e.entityKinds) {
        counts[k] = (counts[k] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .map(([kind, count]) => ({ kind: kind.toUpperCase(), count }))
      .sort((a, b) => b.count - a.count);
  }, [maskingEvents]);

  const totalMasked = useMemo(
    () => maskingEvents.reduce((s, e) => s + e.transformedCount, 0),
    [maskingEvents]
  );
  const uniqueModels = useMemo(
    () => new Set(maskingEvents.map((e) => e.model)).size,
    [maskingEvents]
  );

  const [initialLoad, setInitialLoad] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setInitialLoad(false), 1500);
    return () => clearTimeout(t);
  }, []);

  if (initialLoad) {
    return (
      <div className="p-4 md:p-6 space-y-6 h-full overflow-y-auto animate-fade-in">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-5"><Skeleton className="h-3 w-20 mb-3" /><Skeleton className="h-8 w-16" /></CardContent></Card>
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 h-full overflow-y-auto">
      <SectionHeader
        icon={Activity}
        title="Activity Feed"
        description="Flux de requêtes LLM et transformations de masquage en direct."
        actions={
          <>
            <div className="flex items-center gap-1.5">
              <div className={cn("h-2.5 w-2.5 rounded-full", isConnected ? "bg-emerald-500" : "bg-red-500")} />
              <span className="text-xs text-muted-foreground">{isConnected ? "Live" : "Disconnected"}</span>
            </div>
            <button
              onClick={() => setIsPaused((p) => !p)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border",
                isPaused
                  ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {isPaused ? "▶ Resume" : "⏸ Pause"}
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 stagger-children">
        <StatCard label="Live Events" value={maskingEvents.length} icon={Activity} color="indigo" delay={0} />
        <StatCard label="Entities Masked" value={totalMasked} icon={Shield} color="emerald" delay={60} />
        <StatCard label="Models Active" value={uniqueModels} icon={Zap} color="amber" delay={120} />
        <StatCard label="Entity Types" value={entityBreakdown.length} icon={Timer} color="blue" delay={180} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 animate-fade-in-up" style={{ animationDelay: "200ms" }}>
          <CardHeader className="flex flex-row items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <CardTitle>Requests / Minute</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={rpmData}>
                <defs>
                  <linearGradient id="rpmGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--border))",
                    borderRadius: "12px",
                    fontSize: "12px",
                  }}
                />
                <Area type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} fill="url(#rpmGrad)" name="Requests" animationDuration={500} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up" style={{ animationDelay: "300ms" }}>
          <CardHeader>
            <CardTitle>Entities Detected</CardTitle>
          </CardHeader>
          <CardContent>
            {entityBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No entities yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={entityBreakdown} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                  <YAxis type="category" dataKey="kind" tick={{ fontSize: 11 }} className="fill-muted-foreground" width={50} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      borderColor: "hsl(var(--border))",
                      borderRadius: "12px",
                      fontSize: "12px",
                    }}
                  />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]} animationDuration={500}>
                    {entityBreakdown.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="animate-fade-in-up" style={{ animationDelay: "350ms" }}>
        <CardHeader className="space-y-3">
          <div className="flex flex-row items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <CardTitle>Recent Requests</CardTitle>
            <Badge variant="outline" className="ml-auto text-xs">
              {displayEvents.length} events
            </Badge>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8 h-9"
              placeholder="Filtrer par endpoint, modèle ou type d'entité..."
            />
          </div>
        </CardHeader>
        <CardContent>
          {displayEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Activity className="h-8 w-8 mb-3 opacity-40" />
              <p className="text-sm">
                {query ? "Aucun événement pour ce filtre." : isPaused ? "Flux figé (pause)." : "Waiting for events…"}
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
              {displayEvents.slice(0, 50).map((event, i) => (
                <div
                  key={`${event.timestamp}-${i}`}
                  className="flex items-start gap-3 p-3 rounded-xl border border-border hover:bg-muted/30 transition-colors animate-slide-in-left"
                  style={{ animationDelay: `${Math.min(i * 20, 200)}ms` }}
                >
                  <div className={cn(
                    "rounded-lg p-1.5 mt-0.5 flex-shrink-0",
                    event.transformedCount > 0
                      ? "bg-indigo-50 dark:bg-indigo-950/30"
                      : "bg-muted"
                  )}>
                    {event.transformedCount > 0 ? (
                      <Shield className="h-3.5 w-3.5 text-indigo-500" />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{event.endpoint}</span>
                      {event.model && (
                        <Badge variant="secondary" className="text-[10px]">{event.model}</Badge>
                      )}
                      <Badge variant="outline" className="text-[10px]">
                        {event.transformedCount} masked
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
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
                    </div>
                  </div>
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap flex-shrink-0">
                    {formatRelativeTime(event.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
