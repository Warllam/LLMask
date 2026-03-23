import { useState } from "react";
import { X, Save, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface AlertRuleFormData {
  name: string;
  kind: string;
  severity: "info" | "warning" | "critical";
  threshold: number;
  windowMinutes: number;
  cooldownMinutes: number;
  channels: string[];
  enabled: boolean;
}

interface AlertRuleFormProps {
  initial?: Partial<AlertRuleFormData>;
  onSave: (data: AlertRuleFormData) => void;
  onCancel: () => void;
  isEdit?: boolean;
}

const RULE_KINDS = [
  { value: "high_pii_rate", label: "High PII Detection Rate", desc: "Alert when PII detections exceed threshold" },
  { value: "leak_detected", label: "Data Leak Detected", desc: "Alert on any data leak in responses" },
  { value: "provider_latency", label: "Provider Latency", desc: "Alert when provider latency is too high" },
  { value: "error_rate", label: "Error Rate", desc: "Alert when error rate exceeds threshold" },
  { value: "session_volume", label: "Session Volume", desc: "Alert on unusual session activity" },
  { value: "transform_failure", label: "Transform Failure", desc: "Alert when masking transforms fail" },
];

const CHANNELS = [
  { value: "dashboard", label: "Dashboard" },
  { value: "email", label: "Email" },
  { value: "slack", label: "Slack" },
  { value: "webhook", label: "Webhook" },
];

export function AlertRuleForm({ initial, onSave, onCancel, isEdit }: AlertRuleFormProps) {
  const [form, setForm] = useState<AlertRuleFormData>({
    name: initial?.name ?? "",
    kind: initial?.kind ?? "high_pii_rate",
    severity: initial?.severity ?? "warning",
    threshold: initial?.threshold ?? 100,
    windowMinutes: initial?.windowMinutes ?? 5,
    cooldownMinutes: initial?.cooldownMinutes ?? 15,
    channels: initial?.channels ?? ["dashboard"],
    enabled: initial?.enabled ?? true,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Name is required";
    if (form.threshold <= 0) errs.threshold = "Must be > 0";
    if (form.windowMinutes <= 0) errs.windowMinutes = "Must be > 0";
    if (form.channels.length === 0) errs.channels = "Select at least one channel";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) onSave(form);
  };

  const toggleChannel = (ch: string) => {
    setForm((f) => ({
      ...f,
      channels: f.channels.includes(ch)
        ? f.channels.filter((c) => c !== ch)
        : [...f.channels, ch],
    }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">
          {isEdit ? "Edit Alert Rule" : "Create Alert Rule"}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Name */}
      <div>
        <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium block mb-1.5">
          Rule Name
        </label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="e.g., High PII rate alert"
          className={cn(
            "flex h-9 w-full rounded-lg border bg-transparent px-3 py-1 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            errors.name ? "border-red-500" : "border-input"
          )}
        />
        {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
      </div>

      {/* Rule kind */}
      <div>
        <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium block mb-1.5">
          Rule Type
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {RULE_KINDS.map((kind) => (
            <button
              key={kind.value}
              type="button"
              onClick={() => setForm((f) => ({ ...f, kind: kind.value }))}
              className={cn(
                "text-left p-3 rounded-xl border-2 transition-all",
                form.kind === kind.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/30 hover:bg-muted/30"
              )}
            >
              <div className="text-sm font-medium">{kind.label}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{kind.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Severity */}
      <div>
        <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium block mb-1.5">
          Severity
        </label>
        <div className="flex gap-2">
          {(["info", "warning", "critical"] as const).map((sev) => (
            <button
              key={sev}
              type="button"
              onClick={() => setForm((f) => ({ ...f, severity: sev }))}
              className={cn(
                "flex-1 px-3 py-2 rounded-lg text-sm font-medium border-2 transition-all",
                form.severity === sev
                  ? sev === "critical"
                    ? "border-red-500 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400"
                    : sev === "warning"
                    ? "border-amber-500 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400"
                    : "border-blue-500 bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400"
                  : "border-border text-muted-foreground hover:border-primary/30"
              )}
            >
              {sev.charAt(0).toUpperCase() + sev.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Threshold + Window + Cooldown */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium block mb-1.5">
            Threshold
          </label>
          <input
            type="number"
            value={form.threshold}
            onChange={(e) => setForm((f) => ({ ...f, threshold: Number(e.target.value) }))}
            className={cn(
              "flex h-9 w-full rounded-lg border bg-transparent px-3 py-1 text-sm font-mono transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              errors.threshold ? "border-red-500" : "border-input"
            )}
          />
          {errors.threshold && <p className="text-xs text-red-500 mt-1">{errors.threshold}</p>}
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium block mb-1.5">
            Window (min)
          </label>
          <input
            type="number"
            value={form.windowMinutes}
            onChange={(e) => setForm((f) => ({ ...f, windowMinutes: Number(e.target.value) }))}
            className={cn(
              "flex h-9 w-full rounded-lg border bg-transparent px-3 py-1 text-sm font-mono transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              errors.windowMinutes ? "border-red-500" : "border-input"
            )}
          />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium block mb-1.5">
            Cooldown (min)
          </label>
          <input
            type="number"
            value={form.cooldownMinutes}
            onChange={(e) => setForm((f) => ({ ...f, cooldownMinutes: Number(e.target.value) }))}
            className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm font-mono transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      {/* Channels */}
      <div>
        <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium block mb-1.5">
          Notification Channels
        </label>
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map((ch) => (
            <button
              key={ch.value}
              type="button"
              onClick={() => toggleChannel(ch.value)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                form.channels.includes(ch.value)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
              )}
            >
              {ch.label}
            </button>
          ))}
        </div>
        {errors.channels && <p className="text-xs text-red-500 mt-1">{errors.channels}</p>}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {isEdit ? <Save className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {isEdit ? "Save Changes" : "Create Rule"}
        </button>
      </div>
    </form>
  );
}
