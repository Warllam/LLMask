import { useEffect, useState } from "react";
import {
  SlidersHorizontal,
  Shield,
  Clock,
  Server,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { AppSettings, MaskingStrategy } from "@/lib/types";

// ---------------------------------------------------------------------------
// Strategy catalogue
// ---------------------------------------------------------------------------

const strategies: Array<{
  id: MaskingStrategy;
  label: string;
  labelFr: string;
  description: string;
  descriptionFr: string;
  compliance: string[];
  color: string;
}> = [
  {
    id: "pseudonymization",
    label: "Pseudonymization",
    labelFr: "Pseudonymisation",
    description: "Sensitive data is replaced with realistic but fictitious identifiers. The original data can be recovered if needed.",
    descriptionFr: "Les données sensibles sont remplacées par des identifiants fictifs réalistes. Les données originales peuvent être récupérées si nécessaire.",
    compliance: ["RGPD Art. 4(5)", "HIPAA Safe Harbor"],
    color: "emerald",
  },
  {
    id: "redaction",
    label: "Redaction",
    labelFr: "Caviardage",
    description: "Sensitive data is completely hidden and replaced with [REDACTED] markers. The original data cannot be recovered.",
    descriptionFr: "Les données sensibles sont complètement masquées par des marqueurs [REDACTED]. Les données originales ne peuvent pas être récupérées.",
    compliance: ["RGPD Art. 17", "PCI DSS"],
    color: "red",
  },
  {
    id: "generalization",
    label: "Generalization",
    labelFr: "Généralisation",
    description: "Specific values are replaced with general categories. Useful for statistical analysis while preserving data utility.",
    descriptionFr: "Les valeurs spécifiques sont remplacées par des catégories générales. Utile pour l'analyse statistique tout en préservant l'utilité des données.",
    compliance: ["RGPD Art. 89", "k-anonymity"],
    color: "blue",
  },
  {
    id: "tokenization",
    label: "Tokenization",
    labelFr: "Tokenisation",
    description: "Sensitive data is replaced with unique random tokens stored in a secure vault. Tokens can be exchanged back through an authorised process.",
    descriptionFr: "Les données sensibles sont remplacées par des jetons uniques stockés dans un coffre sécurisé. Les jetons peuvent être échangés via un processus autorisé.",
    compliance: ["PCI DSS 3.4", "FIPS 140-2"],
    color: "purple",
  },
];

const providers = [
  { id: "anthropic", label: "Anthropic (Claude)", description: "Modèles Claude — Haiku, Sonnet, Opus" },
  { id: "openai", label: "OpenAI (GPT)", description: "Modèles GPT-4o, o3, o4-mini" },
  { id: "gemini", label: "Google Gemini", description: "Modèles Gemini 2.5 Pro / Flash" },
  { id: "mistral", label: "Mistral AI", description: "Modèles Mistral Large" },
  { id: "litellm", label: "LiteLLM (proxy)", description: "Proxy unifié multi-fournisseurs" },
];

const retentionOptions = [
  { value: 7, label: "7 jours / 7 days" },
  { value: 14, label: "14 jours / 14 days" },
  { value: 30, label: "30 jours / 30 days" },
  { value: 60, label: "60 jours / 60 days" },
  { value: 90, label: "90 jours / 90 days" },
  { value: 365, label: "1 an / 1 year" },
];

// ---------------------------------------------------------------------------

export function Settings() {
  const { addToast } = useToast();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSettings()
      .then((s) => {
        setSettings(s);
        setDraft(s);
      })
      .catch(() => {
        // Fallback defaults if backend not yet updated
        const defaults: AppSettings = { maskingStrategy: "pseudonymization", retentionDays: 30, provider: "anthropic" };
        setSettings(defaults);
        setDraft(defaults);
      })
      .finally(() => setLoading(false));
  }, []);

  const isDirty = draft && settings && (
    draft.maskingStrategy !== settings.maskingStrategy ||
    draft.retentionDays !== settings.retentionDays ||
    draft.provider !== settings.provider
  );

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await api.updateSettings(draft);
      setSettings(res.settings);
      setDraft(res.settings);
      addToast("Réglages sauvegardés / Settings saved", "success");
    } catch {
      addToast("Erreur lors de la sauvegarde / Save failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (settings) setDraft({ ...settings });
  };

  if (loading) {
    return (
      <div className="p-4 md:p-6 space-y-6 h-full overflow-y-auto animate-fade-in">
        <Skeleton className="h-8 w-48" />
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!draft) return null;

  return (
    <div className="p-4 md:p-6 space-y-6 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <SlidersHorizontal className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold">Réglages</h1>
            <span className="text-muted-foreground text-sm font-normal">/ Settings</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Configurez le comportement du proxy de protection des données.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <Button variant="outline" size="sm" onClick={handleReset} disabled={saving}>
              Annuler
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="min-w-[120px]"
          >
            {saving ? (
              <span className="flex items-center gap-1.5">
                <span className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
                Saving…
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Sauvegarder
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* Masking strategy */}
      <Card className="animate-fade-in-up">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Stratégie de masquage</CardTitle>
            <span className="text-xs text-muted-foreground font-normal">/ Masking strategy</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Choisissez comment les données sensibles sont traitées avant d'être envoyées au fournisseur IA.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {strategies.map((s) => {
              const selected = draft.maskingStrategy === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setDraft((d) => d ? { ...d, maskingStrategy: s.id } : d)}
                  className={cn(
                    "text-left p-4 rounded-xl border-2 transition-all",
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/30 hover:bg-muted/30"
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <div className="font-semibold text-sm">{s.labelFr}</div>
                      <div className="text-[11px] text-muted-foreground">{s.label}</div>
                    </div>
                    <div className={cn(
                      "h-4 w-4 rounded-full border-2 flex-shrink-0 mt-0.5",
                      selected ? "border-primary bg-primary" : "border-muted-foreground"
                    )} />
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-2">{s.descriptionFr}</p>
                  <div className="flex flex-wrap gap-1">
                    {s.compliance.map((c) => (
                      <span key={c} className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {c}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Provider */}
      <Card className="animate-fade-in-up" style={{ animationDelay: "100ms" }}>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Fournisseur IA</CardTitle>
            <span className="text-xs text-muted-foreground font-normal">/ AI provider</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Sélectionnez le fournisseur d'intelligence artificielle utilisé pour les requêtes.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {providers.map((p) => {
              const selected = draft.provider === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setDraft((d) => d ? { ...d, provider: p.id } : d)}
                  className={cn(
                    "text-left p-3.5 rounded-xl border-2 transition-all",
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/30 hover:bg-muted/30"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-sm">{p.label}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{p.description}</div>
                    </div>
                    <div className={cn(
                      "h-4 w-4 rounded-full border-2 flex-shrink-0 mt-0.5",
                      selected ? "border-primary bg-primary" : "border-muted-foreground"
                    )} />
                  </div>
                </button>
              );
            })}
          </div>
          <div className="flex items-start gap-2 mt-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
            <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 dark:text-amber-300">
              Modifier le fournisseur nécessite un redémarrage du proxy pour prendre effet.
              <span className="block opacity-70 mt-0.5">Changing the provider requires a proxy restart to take effect.</span>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Retention */}
      <Card className="animate-fade-in-up" style={{ animationDelay: "200ms" }}>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Rétention des données</CardTitle>
            <span className="text-xs text-muted-foreground font-normal">/ Data retention</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Durée de conservation des journaux de requêtes et des mappings d'entités.
          </p>
        </CardHeader>
        <CardContent>
          <div className="relative max-w-xs">
            <select
              value={draft.retentionDays}
              onChange={(e) => setDraft((d) => d ? { ...d, retentionDays: Number(e.target.value) } : d)}
              className="w-full appearance-none rounded-xl border border-input bg-background px-4 py-3 pr-10 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {retentionOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-3.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
          <div className="flex items-start gap-2 mt-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
            <CheckCircle2 className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-blue-800 dark:text-blue-300">
              RGPD Art. 5(1)(e) — Les données ne doivent pas être conservées plus longtemps que nécessaire.
              <span className="block opacity-70 mt-0.5">GDPR Art. 5(1)(e) — Data should not be kept longer than necessary.</span>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Bottom save bar (sticky on mobile) */}
      {isDirty && (
        <div className="sticky bottom-0 -mx-4 md:-mx-6 px-4 md:px-6 py-3 bg-background/90 backdrop-blur border-t border-border flex items-center justify-between gap-3 animate-fade-in">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            Modifications non sauvegardées / Unsaved changes
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleReset}>Annuler</Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Sauvegarder"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
