import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useSSE } from "@/lib/use-sse";
import { cn } from "@/lib/utils";
import type { AlertEvent, AlertRuleConfig, LiveAlertEvent } from "@/lib/types";
import { AlertRuleForm } from "@/components/ui/alert-rule-form";
import { SectionHeader } from "@/components/ui/section-header";
import { Bell, AlertTriangle, AlertCircle, CheckCircle2, Clock, Shield, ToggleLeft, ToggleRight, CheckCheck, Plus, Search } from "lucide-react";

type SeverityFilter = "all" | "critical" | "warning" | "info";
type StatusFilter = "all" | "firing" | "resolved";

export function Alerts() {
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [rules, setRules] = useState<AlertRuleConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"events" | "rules">("events");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");

  // Load recent alerts and rules
  useEffect(() => {
    Promise.all([
      api.get<AlertEvent[]>("/alerts/events?limit=20"),
      api.alertRules().catch(() => [] as AlertRuleConfig[]),
    ])
      .then(([evts, rls]) => {
        setEvents(evts);
        setRules(rls);
      })
      .catch((err: Error) => {
        console.error("Failed to load alerts:", err);
        setError("Échec du chargement des alertes");
      })
      .finally(() => setLoading(false));
  }, []);

  // Listen for new alerts via SSE
  const { events: liveEvents } = useSSE("/dashboard/api/live");

  useEffect(() => {
    const latestEvent = liveEvents[0];
    if (!latestEvent) return;

    const event = latestEvent;
    if ("eventType" in event && event.eventType === "alert") {
      const alertEvent = event as LiveAlertEvent;

      if (alertEvent.type === "firing") {
        setEvents((prev) => [
          {
            id: alertEvent.id,
            ruleId: alertEvent.ruleId,
            ruleName: alertEvent.ruleName,
            severity: alertEvent.severity,
            status: "firing",
            message: alertEvent.message,
            value: alertEvent.value,
            threshold: alertEvent.threshold,
            firedAt: alertEvent.firedAt,
            resolvedAt: null,
          },
          ...prev.slice(0, 19),
        ]);
      } else if (alertEvent.type === "resolved") {
        setEvents((prev) =>
          prev.map((e) =>
            e.ruleId === alertEvent.ruleId && e.status === "firing"
              ? { ...e, status: "resolved", resolvedAt: alertEvent.resolvedAt ?? new Date().toISOString() }
              : e
          )
        );
      }
    }
  }, [liveEvents]);

  const firingCount = events.filter((e) => e.status === "firing").length;
  const filteredEvents = events.filter((event) => {
    if (severityFilter !== "all" && event.severity !== severityFilter) return false;
    if (statusFilter !== "all" && event.status !== statusFilter) return false;

    if (query.trim()) {
      const q = query.trim().toLowerCase();
      return (
        event.ruleName.toLowerCase().includes(q) ||
        event.message.toLowerCase().includes(q) ||
        event.ruleId.toLowerCase().includes(q)
      );
    }

    return true;
  });

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-6 w-24" />
        </div>
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card className="p-8">
          <EmptyState
            icon={AlertCircle}
            title="Erreur"
            description={error}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="p-6 space-y-6">
        <SectionHeader
          icon={Bell}
          title="Alertes système"
          description="Suivi temps réel des alertes et gestion des règles."
          actions={
            <>
              {firingCount > 0 && (
                <Badge variant="destructive" className="px-3 py-1">
                  {firingCount} active{firingCount > 1 ? "s" : ""}
                </Badge>
              )}
              <div className="flex items-center gap-1 rounded-lg bg-muted p-1" role="tablist">
                <button
                  role="tab"
                  aria-selected={activeTab === "events"}
                  onClick={() => setActiveTab("events")}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                    activeTab === "events" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Events
                </button>
                <button
                  role="tab"
                  aria-selected={activeTab === "rules"}
                  onClick={() => setActiveTab("rules")}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5",
                    activeTab === "rules" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Shield className="h-3.5 w-3.5" />
                  Rules ({rules.length})
                </button>
              </div>
            </>
          }
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 dark:bg-red-900/20 rounded-lg">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Alertes actives</p>
                <p className="text-2xl font-bold">{firingCount}</p>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 dark:bg-green-900/20 rounded-lg">
                <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Résolues (24h)</p>
                <p className="text-2xl font-bold">
                  {events.filter((e) => e.status === "resolved").length}
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/20 rounded-lg">
                <Clock className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total (récentes)</p>
                <p className="text-2xl font-bold">{events.length}</p>
              </div>
            </div>
          </Card>
        </div>

        {activeTab === "events" && (
          <>
            <Card className="p-4 space-y-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filtrer par nom, message ou ID de règle..."
                  className="pl-8 h-9"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">Sévérité:</span>
                {(["all", "critical", "warning", "info"] as const).map((level) => (
                  <button
                    key={level}
                    onClick={() => setSeverityFilter(level)}
                    className={cn(
                      "px-2 py-1 rounded-md border transition-colors",
                      severityFilter === level ? "bg-primary/10 border-primary/40 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {level === "all" ? "Toutes" : level}
                  </button>
                ))}
                <span className="ml-2 text-muted-foreground">Statut:</span>
                {(["all", "firing", "resolved"] as const).map((status) => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    className={cn(
                      "px-2 py-1 rounded-md border transition-colors",
                      statusFilter === status ? "bg-primary/10 border-primary/40 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {status === "all" ? "Tous" : status}
                  </button>
                ))}
                {(query || severityFilter !== "all" || statusFilter !== "all") && (
                  <button
                    onClick={() => {
                      setQuery("");
                      setSeverityFilter("all");
                      setStatusFilter("all");
                    }}
                    className="ml-auto px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground"
                  >
                    Réinitialiser
                  </button>
                )}
              </div>
            </Card>

            {filteredEvents.length === 0 ? (
              <Card className="p-8">
                <EmptyState
                  icon={CheckCircle2}
                  title={events.length === 0 ? "Aucune alerte" : "Aucun résultat"}
                  description={events.length === 0
                    ? "Aucune alerte récente. Tout fonctionne correctement."
                    : "Aucune alerte ne correspond aux filtres actuels."
                  }
                />
              </Card>
            ) : (
              <div className="space-y-3">
                {filteredEvents.map((event) => (
                  <AlertCard key={event.id} event={event} />
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === "rules" && (
          <AlertRulesPanel rules={rules} onRulesChange={setRules} />
        )}
      </div>
    </div>
  );
}

interface AlertCardProps {
  event: AlertEvent;
}

function AlertCard({ event }: AlertCardProps) {
  const isFiring = event.status === "firing";

  const severityConfig = {
    critical: {
      bg: "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900",
      icon: <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />,
      badge: "destructive",
      label: "CRITIQUE",
    },
    warning: {
      bg: "bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900",
      icon: <AlertTriangle className="w-5 h-5 text-orange-600 dark:text-orange-400" />,
      badge: "default",
      label: "ATTENTION",
    },
    info: {
      bg: "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900",
      icon: <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400" />,
      badge: "secondary",
      label: "INFO",
    },
  } as const;

  const config = severityConfig[event.severity];

  return (
    <Card className={`p-4 border-2 transition-all ${isFiring ? config.bg : "opacity-60"}`}>
      <div className="flex items-start gap-4">
        <div className={`p-2 rounded-lg ${isFiring ? "animate-pulse" : ""}`}>
          {config.icon}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold truncate">{event.ruleName}</h3>
            <Badge variant={config.badge as any} className="shrink-0">
              {config.label}
            </Badge>
            {isFiring ? (
              <Badge variant="destructive" className="shrink-0">ACTIVE</Badge>
            ) : (
              <Badge variant="outline" className="shrink-0 text-green-600 dark:text-green-400">
                RÉSOLUE
              </Badge>
            )}
          </div>

          <p className="text-sm text-foreground mb-2">{event.message}</p>

          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>
              Valeur: <strong className="text-foreground">{event.value}</strong>
            </span>
            <span>
              Seuil: <strong className="text-foreground">{event.threshold}</strong>
            </span>
            <span>
              ID: <code className="text-foreground">{event.ruleId}</code>
            </span>
          </div>

          <div className="flex items-center gap-4 text-xs text-muted-foreground mt-2">
            <span title={event.firedAt}>
              Déclenchée: {formatRelativeTime(event.firedAt)}
            </span>
            {event.resolvedAt && (
              <span title={event.resolvedAt} className="text-green-600 dark:text-green-400">
                Résolue: {formatRelativeTime(event.resolvedAt)}
              </span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

interface AlertRulesPanelProps {
  rules: AlertRuleConfig[];
  onRulesChange: (rules: AlertRuleConfig[]) => void;
}

function AlertRulesPanel({ rules, onRulesChange }: AlertRulesPanelProps) {
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [ackingId, setAckingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const handleCreateRule = (data: { name: string; kind: string; severity: "info" | "warning" | "critical"; threshold: number; windowMinutes: number; cooldownMinutes: number; channels: string[]; enabled: boolean }) => {
    const newRule: AlertRuleConfig = {
      id: `rule-${Date.now()}`,
      name: data.name,
      kind: data.kind,
      enabled: data.enabled,
      severity: data.severity,
      threshold: data.threshold,
      windowMinutes: data.windowMinutes,
      channels: data.channels,
      cooldownMinutes: data.cooldownMinutes,
      lastFiredAt: null,
      acknowledged: false,
      acknowledgedAt: null,
      acknowledgedBy: null,
    };
    onRulesChange([...rules, newRule]);
    setShowForm(false);
  };

  const handleToggle = (rule: AlertRuleConfig) => {
    setTogglingId(rule.id);
    api.toggleAlertRule(rule.id, !rule.enabled)
      .then(() => {
        onRulesChange(rules.map((r) => r.id === rule.id ? { ...r, enabled: !r.enabled } : r));
      })
      .catch(console.error)
      .finally(() => setTogglingId(null));
  };

  const handleAcknowledge = (rule: AlertRuleConfig) => {
    setAckingId(rule.id);
    api.acknowledgeAlert(rule.id)
      .then(() => {
        onRulesChange(rules.map((r) =>
          r.id === rule.id ? { ...r, acknowledged: true, acknowledgedAt: new Date().toISOString() } : r
        ));
      })
      .catch(console.error)
      .finally(() => setAckingId(null));
  };

  if (showForm) {
    return (
      <Card className="p-6">
        <AlertRuleForm
          onSave={handleCreateRule}
          onCancel={() => setShowForm(false)}
        />
      </Card>
    );
  }

  const severityOrder = { critical: 0, warning: 1, info: 2 };
  const sorted = [...rules].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return (
    <div className="space-y-3">
      <button
        onClick={() => setShowForm(true)}
        className="flex items-center gap-2 w-full px-4 py-3 rounded-xl border-2 border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/5 transition-colors"
      >
        <Plus className="h-4 w-4" />
        Create New Rule
      </button>
      {rules.length === 0 && (
        <Card className="p-8">
          <EmptyState
            icon={Shield}
            title="No alert rules"
            description="No alert rules configured yet. Create your first rule above."
          />
        </Card>
      )}
      {sorted.map((rule) => {
        const sevColors = {
          critical: "border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/10",
          warning: "border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/10",
          info: "border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/10",
        };
        const sevBadge = {
          critical: "destructive" as const,
          warning: "default" as const,
          info: "secondary" as const,
        };

        return (
          <Card key={rule.id} className={cn("p-4 border-2 transition-all", rule.enabled ? sevColors[rule.severity] : "opacity-50")}>
            <div className="flex items-start gap-4">
              <button
                onClick={() => handleToggle(rule)}
                disabled={togglingId === rule.id}
                className="mt-1 transition-colors"
                title={rule.enabled ? "Disable rule" : "Enable rule"}
              >
                {rule.enabled ? (
                  <ToggleRight className="h-6 w-6 text-emerald-500" />
                ) : (
                  <ToggleLeft className="h-6 w-6 text-muted-foreground" />
                )}
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h3 className="font-semibold">{rule.name}</h3>
                  <Badge variant={sevBadge[rule.severity]} className="text-[10px]">
                    {rule.severity.toUpperCase()}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">{rule.kind}</Badge>
                </div>

                <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                  <span>Threshold: <strong className="text-foreground">{rule.threshold}</strong></span>
                  <span>Window: <strong className="text-foreground">{rule.windowMinutes}m</strong></span>
                  <span>Cooldown: <strong className="text-foreground">{rule.cooldownMinutes}m</strong></span>
                  {rule.channels.length > 0 && (
                    <span>Channels: {rule.channels.join(", ")}</span>
                  )}
                </div>

                {rule.lastFiredAt && (
                  <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>Last fired: {formatRelativeTime(rule.lastFiredAt)}</span>
                    {rule.acknowledged && rule.acknowledgedAt && (
                      <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <CheckCheck className="h-3 w-3" />
                        Acknowledged {formatRelativeTime(rule.acknowledgedAt)}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {rule.lastFiredAt && !rule.acknowledged && (
                <button
                  onClick={() => handleAcknowledge(rule)}
                  disabled={ackingId === rule.id}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition-colors flex items-center gap-1.5 flex-shrink-0"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  {ackingId === rule.id ? "..." : "Ack"}
                </button>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "à l'instant";
  if (diffMins < 60) return `il y a ${diffMins} min`;
  if (diffHours < 24) return `il y a ${diffHours}h`;
  if (diffDays < 7) return `il y a ${diffDays}j`;
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
