import { useEffect, useState } from "react";
import {
  Shield,
  Activity,
  CheckCircle2,
  Clock,
  Zap,
  Users,
  FileText,
  TrendingUp,
  Server,
  AlertCircle,
  Info,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useSSE } from "@/lib/use-sse";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { DashboardStats, AppSettings } from "@/lib/types";

// Plain-language descriptions for each masking strategy
const strategyInfo: Record<string, { label: string; labelFr: string; description: string; descriptionFr: string; color: string }> = {
  pseudonymization: {
    label: "Pseudonymization",
    labelFr: "Pseudonymisation",
    description: "Sensitive data (names, organisations, etc.) is replaced with realistic but fictitious identifiers. The original data can be recovered if needed.",
    descriptionFr: "Les données sensibles (noms, organisations, etc.) sont remplacées par des identifiants fictifs réalistes. Les données originales peuvent être récupérées si nécessaire.",
    color: "emerald",
  },
  redaction: {
    label: "Redaction",
    labelFr: "Caviardage",
    description: "Sensitive data is completely hidden and replaced with [REDACTED] markers. The original data cannot be recovered.",
    descriptionFr: "Les données sensibles sont complètement masquées et remplacées par des marqueurs [REDACTED]. Les données originales ne peuvent pas être récupérées.",
    color: "red",
  },
  generalization: {
    label: "Generalization",
    labelFr: "Généralisation",
    description: "Specific values are replaced with general categories (e.g. an exact age becomes an age range). Useful for statistical analysis.",
    descriptionFr: "Les valeurs spécifiques sont remplacées par des catégories générales (ex : un âge précis devient une tranche d'âge). Utile pour l'analyse statistique.",
    color: "blue",
  },
  tokenization: {
    label: "Tokenization",
    labelFr: "Tokenisation",
    description: "Sensitive data is replaced with unique random tokens stored in a secure vault. Tokens can be exchanged back for the original data through an authorised process.",
    descriptionFr: "Les données sensibles sont remplacées par des jetons aléatoires uniques stockés dans un coffre sécurisé. Les jetons peuvent être échangés contre les données d'origine via un processus autorisé.",
    color: "purple",
  },
};

const kindLabels: Record<string, { en: string; fr: string }> = {
  org: { en: "Organisations", fr: "Organisations" },
  svc: { en: "Services", fr: "Services" },
  tbl: { en: "Tables / Datasets", fr: "Tables / Jeux de données" },
  col: { en: "Column names", fr: "Noms de colonnes" },
  idn: { en: "Identifiers", fr: "Identifiants" },
};

const kindColors: Record<string, string> = {
  org: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  svc: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  tbl: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  col: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  idn: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400",
};

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function getWeekAgo(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d;
}

export function Welcome() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const { events, isConnected } = useSSE("/dashboard/api/live");

  useEffect(() => {
    Promise.all([
      api.stats().catch(() => null),
      api.getSettings().catch(() => null),
    ]).then(([s, cfg]) => {
      setStats(s);
      setSettings(cfg);
    }).finally(() => setLoading(false));
  }, []);

  // Compute today vs week activity counts from recentActivity array
  const todayStr = getToday();
  const weekAgo = getWeekAgo();
  const todayRequests = stats?.recentActivity.find((d) => d.date === todayStr)?.count ?? 0;
  const weekRequests = stats?.recentActivity
    .filter((d) => new Date(d.date) >= weekAgo)
    .reduce((sum, d) => sum + d.count, 0) ?? 0;

  const strategy = settings?.maskingStrategy ?? "pseudonymization";
  const strategyDetail = strategyInfo[strategy] ?? strategyInfo.pseudonymization;

  // Last event timestamp
  const lastEvent = events.find((e) => "endpoint" in e);
  const lastEventTime = lastEvent && "timestamp" in lastEvent ? (lastEvent as { timestamp: string }).timestamp : null;

  return (
    <div className="p-4 md:p-6 space-y-6 h-full overflow-y-auto">
      {/* Hero banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700 p-6 md:p-8 text-white shadow-lg">
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(ellipse_at_top_right,_rgba(255,255,255,0.3)_0%,_transparent_60%)]" />
        <div className="relative flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="h-5 w-5 opacity-90" />
              <span className="text-sm font-semibold tracking-wide uppercase opacity-90">LLMask</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold mb-1">
              Protection des données IA
            </h1>
            <p className="text-sm opacity-80 max-w-lg">
              Toutes les données sensibles sont masquées avant d'être transmises aux fournisseurs d'IA.
              <span className="block mt-0.5 opacity-70">All sensitive data is masked before reaching AI providers.</span>
            </p>
          </div>
          {/* Status pill */}
          <div className="flex items-center gap-3 bg-white/15 rounded-xl px-4 py-3 self-start md:self-center">
            <div className="relative">
              <div className={cn("h-3 w-3 rounded-full", isConnected ? "bg-emerald-400" : "bg-white/40")} />
              {isConnected && <div className="absolute inset-0 h-3 w-3 rounded-full bg-emerald-400 animate-ping" />}
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">
                {isConnected ? "Proxy actif" : "Proxy inactif"}
              </div>
              <div className="text-xs opacity-70">
                {lastEventTime
                  ? `Dernière requête : ${formatRelativeTime(lastEventTime)}`
                  : "En attente de requêtes…"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stat cards row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <Skeleton className="h-3 w-24 mb-3" />
                <Skeleton className="h-8 w-16 mb-2" />
                <Skeleton className="h-3 w-20" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <StatInfoCard
              icon={Activity}
              iconColor="text-indigo-500"
              iconBg="bg-indigo-50 dark:bg-indigo-950/30"
              title="Aujourd'hui / Today"
              value={todayRequests}
              subtitle="requêtes traitées"
            />
            <StatInfoCard
              icon={TrendingUp}
              iconColor="text-violet-500"
              iconBg="bg-violet-50 dark:bg-violet-950/30"
              title="Cette semaine / This week"
              value={weekRequests}
              subtitle="requêtes traitées"
            />
            <StatInfoCard
              icon={Shield}
              iconColor="text-emerald-500"
              iconBg="bg-emerald-50 dark:bg-emerald-950/30"
              title="Total masqué / All time"
              value={stats?.totalTransforms ?? 0}
              subtitle="éléments masqués"
            />
            <StatInfoCard
              icon={Users}
              iconColor="text-amber-500"
              iconBg="bg-amber-50 dark:bg-amber-950/30"
              title="Entités protégées / Entities"
              value={stats?.totalMappings ?? 0}
              subtitle="identifiants uniques"
            />
          </>
        )}
      </div>

      {/* Strategy card + data types row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Active strategy */}
        <Card className="lg:col-span-2 animate-fade-in-up border-l-4 border-l-indigo-500">
          <CardHeader className="flex flex-row items-start gap-3 pb-2">
            <div className="rounded-lg bg-indigo-50 dark:bg-indigo-950/30 p-2 mt-0.5">
              <Shield className="h-4 w-4 text-indigo-500" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-base">Stratégie de masquage active</CardTitle>
                <Badge variant="secondary" className={cn(
                  "text-[11px]",
                  strategyDetail.color === "emerald" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
                  strategyDetail.color === "red" && "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
                  strategyDetail.color === "blue" && "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
                  strategyDetail.color === "purple" && "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
                )}>
                  {strategyDetail.labelFr}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="rounded-xl bg-muted/40 p-4 space-y-2">
              <p className="text-sm text-foreground leading-relaxed">{strategyDetail.descriptionFr}</p>
              <p className="text-xs text-muted-foreground leading-relaxed italic">{strategyDetail.description}</p>
            </div>
            <div className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5" />
              <span>Modifiable dans <strong>Réglages / Settings</strong></span>
            </div>
          </CardContent>
        </Card>

        {/* Data types protected */}
        <Card className="animate-fade-in-up" style={{ animationDelay: "100ms" }}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              Types de données protégées
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full rounded-lg" />)}
              </div>
            ) : stats && Object.keys(stats.mappingsByKind).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(stats.mappingsByKind)
                  .sort(([, a], [, b]) => b - a)
                  .map(([kind, count]) => {
                    const max = Math.max(...Object.values(stats.mappingsByKind));
                    const pct = Math.round((count / max) * 100);
                    const label = kindLabels[kind];
                    return (
                      <div key={kind} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                            kindColors[kind] ?? "bg-secondary text-secondary-foreground"
                          )}>
                            {label?.fr ?? kind.toUpperCase()}
                          </span>
                          <span className="text-muted-foreground font-mono tabular-nums">{count}</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-400 dark:bg-indigo-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">Aucune donnée pour l'instant</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Live feed + provider row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Live feed */}
        <Card className="lg:col-span-2 animate-fade-in-up" style={{ animationDelay: "200ms" }}>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <div className="relative">
              <div className={cn("h-2.5 w-2.5 rounded-full", isConnected ? "bg-emerald-500" : "bg-muted-foreground")} />
              {isConnected && <div className="absolute inset-0 h-2.5 w-2.5 rounded-full bg-emerald-500 animate-ping" />}
            </div>
            <CardTitle className="text-base">Flux en direct / Live feed</CardTitle>
            {!isConnected && <Badge variant="outline" className="ml-auto text-xs">Déconnecté</Badge>}
          </CardHeader>
          <CardContent>
            {events.filter((e) => "endpoint" in e).length === 0 ? (
              <div className="flex flex-col items-center py-8 gap-2 text-muted-foreground">
                <Activity className="h-8 w-8 opacity-30" />
                <p className="text-sm">En attente de requêtes…</p>
                <p className="text-xs opacity-70">Waiting for requests through the proxy</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {events
                  .filter((e) => "endpoint" in e)
                  .slice(0, 20)
                  .map((event, i) => {
                    const e = event as { endpoint: string; model?: string; entityKinds: string[]; transformedCount: number; timestamp: string };
                    return (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-xl border border-border hover:bg-muted/30 transition-colors">
                        <div className="rounded-lg bg-indigo-50 dark:bg-indigo-950/30 p-1.5 mt-0.5">
                          <Zap className="h-3.5 w-3.5 text-indigo-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium truncate">{e.endpoint}</span>
                            {e.model && <Badge variant="secondary" className="text-[10px]">{e.model}</Badge>}
                          </div>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            {e.entityKinds.map((k) => (
                              <span key={k} className={cn(
                                "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                                kindColors[k] ?? "bg-secondary text-secondary-foreground"
                              )}>
                                {kindLabels[k]?.fr ?? k}
                              </span>
                            ))}
                            <span className="text-xs text-muted-foreground">
                              {e.transformedCount} élément{e.transformedCount > 1 ? "s" : ""} masqué{e.transformedCount > 1 ? "s" : ""}
                            </span>
                          </div>
                        </div>
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">{formatRelativeTime(e.timestamp)}</span>
                      </div>
                    );
                  })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick status */}
        <Card className="animate-fade-in-up" style={{ animationDelay: "300ms" }}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />
              État du système
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <StatusRow
              icon={CheckCircle2}
              iconClass="text-emerald-500"
              label="Proxy de masquage"
              sublabel="Masking proxy"
              status={isConnected ? "Actif" : "Inactif"}
              statusClass={isConnected ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}
            />
            <StatusRow
              icon={Shield}
              iconClass="text-indigo-500"
              label="Moteur de détection"
              sublabel="Detection engine"
              status="Opérationnel"
              statusClass="text-emerald-600 dark:text-emerald-400"
            />
            <StatusRow
              icon={Clock}
              iconClass="text-amber-500"
              label="Dernière requête"
              sublabel="Last request"
              status={lastEventTime ? formatRelativeTime(lastEventTime) : "—"}
              statusClass="text-muted-foreground"
            />
            <StatusRow
              icon={Activity}
              iconClass="text-violet-500"
              label="Total toutes périodes"
              sublabel="All time requests"
              status={(stats?.totalRequests ?? 0).toLocaleString()}
              statusClass="text-foreground font-medium"
            />
            {settings?.provider && (
              <StatusRow
                icon={AlertCircle}
                iconClass="text-blue-500"
                label="Fournisseur IA actif"
                sublabel="Active AI provider"
                status={settings.provider}
                statusClass="text-foreground font-medium capitalize"
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small reusable sub-components
// ---------------------------------------------------------------------------

function StatInfoCard({
  icon: Icon,
  iconColor,
  iconBg,
  title,
  value,
  subtitle,
}: {
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  title: string;
  value: number;
  subtitle: string;
}) {
  return (
    <Card className="animate-fade-in-up">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className={cn("rounded-xl p-2.5", iconBg)}>
            <Icon className={cn("h-5 w-5", iconColor)} />
          </div>
        </div>
        <div className="text-2xl font-bold tabular-nums">{value.toLocaleString()}</div>
        <div className="text-xs text-muted-foreground mt-1 leading-tight">
          <span className="font-medium text-foreground/70">{title}</span>
          <br />
          {subtitle}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusRow({
  icon: Icon,
  iconClass,
  label,
  sublabel,
  status,
  statusClass,
}: {
  icon: React.ElementType;
  iconClass: string;
  label: string;
  sublabel: string;
  status: string;
  statusClass: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
      <Icon className={cn("h-4 w-4 flex-shrink-0", iconClass)} />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{label}</div>
        <div className="text-[10px] text-muted-foreground truncate">{sublabel}</div>
      </div>
      <span className={cn("text-xs text-right", statusClass)}>{status}</span>
    </div>
  );
}
