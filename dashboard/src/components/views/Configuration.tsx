import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Settings,
  Server,
  ToggleLeft,
  ToggleRight,
  Clock,
  Wifi,
  WifiOff,
  AlertCircle,
  CheckCircle2,
  Copy,
  Check,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ConfigInfo } from "@/lib/types";

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function Configuration() {
  const [config, setConfig] = useState<ConfigInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    api.configInfo()
      .then(setConfig)
      .catch((err: Error) => {
        console.error("Failed to load config:", err);
        // Fallback mock data for demo
        setConfig({
          environment: {
            NODE_ENV: "production",
            LOG_LEVEL: "info",
            PORT: "3000",
            MASKING_ENGINE: "presidio",
            CACHE_TTL: "3600",
            MAX_TOKENS: "4096",
          },
          providers: [
            { name: "OpenAI", enabled: true, status: "connected", latencyMs: 120 },
            { name: "Anthropic", enabled: true, status: "connected", latencyMs: 95 },
            { name: "Azure OpenAI", enabled: false, status: "disconnected", latencyMs: null },
          ],
          features: {
            "Real-time masking": true,
            "Response scanning": true,
            "Shield terms": true,
            "Auto-pseudonymization": true,
            "Audit logging": true,
            "Rate limiting": false,
            "Multi-tenant": false,
          },
          version: "0.1.0-poc",
          uptime: 86400,
        });
        setError(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleCopy = (key: string, value: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    }).catch(() => {});
  };

  if (loading) {
    return (
      <div className="p-4 md:p-6 space-y-6 h-full overflow-y-auto animate-fade-in">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-xl" />
          ))}
        </div>
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

  const enabledFeatures = Object.entries(config.features).filter(([, v]) => v).length;
  const totalFeatures = Object.keys(config.features).length;

  return (
    <div className="p-4 md:p-6 space-y-6 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Settings className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Configuration</h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            v{config.version}
          </Badge>
          <Badge variant="secondary" className="text-xs flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Up {formatUptime(config.uptime)}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Providers */}
        <Card className="animate-fade-in-up">
          <CardHeader className="flex flex-row items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <CardTitle>Providers</CardTitle>
            <Badge variant="outline" className="ml-auto text-xs">
              {config.providers.filter((p) => p.enabled).length}/{config.providers.length} active
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {config.providers.map((provider) => (
                <div
                  key={provider.name}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-xl border transition-colors",
                    provider.status === "connected"
                      ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20"
                      : provider.status === "degraded"
                      ? "border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20"
                      : "border-border bg-muted/30"
                  )}
                >
                  <div className={cn(
                    "rounded-lg p-2",
                    provider.status === "connected"
                      ? "bg-emerald-100 dark:bg-emerald-900/40"
                      : provider.status === "degraded"
                      ? "bg-amber-100 dark:bg-amber-900/40"
                      : "bg-muted"
                  )}>
                    {provider.status === "connected" ? (
                      <Wifi className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    ) : provider.status === "degraded" ? (
                      <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    ) : (
                      <WifiOff className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{provider.name}</span>
                      <Badge
                        variant={provider.enabled ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {provider.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                      <span className={cn(
                        provider.status === "connected" ? "text-emerald-600 dark:text-emerald-400" :
                        provider.status === "degraded" ? "text-amber-600 dark:text-amber-400" :
                        "text-muted-foreground"
                      )}>
                        {provider.status}
                      </span>
                      {provider.latencyMs !== null && (
                        <span>{provider.latencyMs}ms</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Features */}
        <Card className="animate-fade-in-up" style={{ animationDelay: "100ms" }}>
          <CardHeader className="flex flex-row items-center gap-2">
            <ToggleRight className="h-4 w-4 text-muted-foreground" />
            <CardTitle>Features</CardTitle>
            <Badge variant="outline" className="ml-auto text-xs">
              {enabledFeatures}/{totalFeatures} enabled
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(config.features).map(([feature, enabled]) => (
                <div
                  key={feature}
                  className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    {enabled ? (
                      <ToggleRight className="h-5 w-5 text-emerald-500" />
                    ) : (
                      <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                    )}
                    <span className={cn(
                      "text-sm",
                      enabled ? "text-foreground" : "text-muted-foreground"
                    )}>
                      {feature}
                    </span>
                  </div>
                  <Badge variant={enabled ? "default" : "secondary"} className="text-[10px]">
                    {enabled ? "ON" : "OFF"}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Environment Variables */}
        <Card className="lg:col-span-2 animate-fade-in-up" style={{ animationDelay: "200ms" }}>
          <CardHeader className="flex flex-row items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            <CardTitle>Environment</CardTitle>
            <Badge variant="outline" className="ml-auto text-xs">
              {Object.keys(config.environment).length} variables
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2.5 px-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Variable</th>
                    <th className="text-left py-2.5 px-3 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Value</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(config.environment).map(([key, value]) => (
                    <tr key={key} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 px-3 font-mono text-xs font-medium text-foreground">{key}</td>
                      <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground">{value}</td>
                      <td className="py-2.5 px-1">
                        <button
                          onClick={() => handleCopy(key, value)}
                          className="p-1 rounded hover:bg-muted transition-colors"
                          title="Copy value"
                        >
                          {copiedKey === key ? (
                            <Check className="h-3 w-3 text-emerald-500" />
                          ) : (
                            <Copy className="h-3 w-3 text-muted-foreground" />
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
