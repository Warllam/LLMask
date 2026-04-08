import { useEffect, useState, useCallback } from "react";
import {
  Filter,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  CheckCircle2,
  XCircle,
  PlayCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { CustomRule } from "@/lib/types";

const CATEGORY_OPTIONS = ["PII", "Secret", "Credential", "Internal", "Custom"];

function RegexValidityIcon({ pattern }: { pattern: string }) {
  if (!pattern) return null;
  let valid = false;
  try {
    new RegExp(pattern);
    valid = true;
  } catch {
    valid = false;
  }
  return valid ? (
    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" aria-label="Valid regex" />
  ) : (
    <XCircle className="h-4 w-4 text-destructive shrink-0" aria-label="Invalid regex" />
  );
}

type RuleFormState = {
  name: string;
  pattern: string;
  replacementPrefix: string;
  category: string;
};

const EMPTY_FORM: RuleFormState = {
  name: "",
  pattern: "",
  replacementPrefix: "CUSTOM",
  category: "Custom",
};

export function CustomRules() {
  const [rules, setRules] = useState<CustomRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<RuleFormState>(EMPTY_FORM);
  const [addError, setAddError] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<RuleFormState>(EMPTY_FORM);
  const [editError, setEditError] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(false);

  // Test rule state
  const [testRuleId, setTestRuleId] = useState<number | null>(null);
  const [testPattern, setTestPattern] = useState("");
  const [testText, setTestText] = useState("");
  const [testResult, setTestResult] = useState<{ valid: boolean; matches: string[]; preview: string; error?: string } | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.customRules()
      .then(setRules)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function isPatternValid(pattern: string): boolean {
    if (!pattern) return false;
    try { new RegExp(pattern); return true; } catch { return false; }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addForm.name.trim() || !addForm.pattern.trim()) {
      setAddError("Name and pattern are required.");
      return;
    }
    if (!isPatternValid(addForm.pattern)) {
      setAddError("Pattern is not a valid regular expression.");
      return;
    }
    setAddError(null);
    setAddLoading(true);
    try {
      const created = await api.createCustomRule({
        name: addForm.name.trim(),
        pattern: addForm.pattern.trim(),
        replacementPrefix: addForm.replacementPrefix.trim() || "CUSTOM",
        category: addForm.category.trim() || "Custom",
      });
      setRules((prev) => [...prev, created]);
      setAddForm(EMPTY_FORM);
      setShowAddForm(false);
    } catch (e) {
      setAddError((e as Error).message);
    } finally {
      setAddLoading(false);
    }
  }

  function startEdit(rule: CustomRule) {
    setEditingId(rule.id);
    setEditForm({
      name: rule.name,
      pattern: rule.pattern,
      replacementPrefix: rule.replacementPrefix,
      category: rule.category,
    });
    setEditError(null);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (editingId === null) return;
    if (!editForm.name.trim() || !editForm.pattern.trim()) {
      setEditError("Name and pattern are required.");
      return;
    }
    if (!isPatternValid(editForm.pattern)) {
      setEditError("Pattern is not a valid regular expression.");
      return;
    }
    setEditError(null);
    setEditLoading(true);
    try {
      const updated = await api.updateCustomRule(editingId, {
        name: editForm.name.trim(),
        pattern: editForm.pattern.trim(),
        replacementPrefix: editForm.replacementPrefix.trim() || "CUSTOM",
        category: editForm.category.trim() || "Custom",
      });
      setRules((prev) => prev.map((r) => (r.id === editingId ? updated : r)));
      setEditingId(null);
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      setEditLoading(false);
    }
  }

  async function handleToggleEnabled(rule: CustomRule) {
    try {
      const updated = await api.updateCustomRule(rule.id, { enabled: !rule.enabled });
      setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
    } catch { /* ignore */ }
  }

  async function handleDelete(id: number) {
    try {
      await api.deleteCustomRule(id);
      setRules((prev) => prev.filter((r) => r.id !== id));
      if (testRuleId === id) setTestRuleId(null);
    } catch { /* ignore */ }
  }

  async function handleTest(e: React.FormEvent) {
    e.preventDefault();
    if (!testPattern) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const result = await api.testCustomRule(testPattern, testText);
      setTestResult(result);
    } catch (e) {
      setTestResult({ valid: false, matches: [], preview: testText, error: (e as Error).message });
    } finally {
      setTestLoading(false);
    }
  }

  function openTest(rule: CustomRule) {
    setTestRuleId(testRuleId === rule.id ? null : rule.id);
    setTestPattern(rule.pattern);
    setTestText("");
    setTestResult(null);
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 p-2">
            <Filter className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Custom Rules</h1>
            <p className="text-sm text-muted-foreground">Define regex patterns to mask additional sensitive data</p>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => { setShowAddForm((v) => !v); setAddError(null); setAddForm(EMPTY_FORM); }}
          className="gap-1.5"
        >
          {showAddForm ? <ChevronUp className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showAddForm ? "Cancel" : "Add Rule"}
        </Button>
      </div>

      {/* Add Rule Form */}
      {showAddForm && (
        <Card className="border-primary/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">New Custom Rule</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Name</label>
                  <Input
                    placeholder="e.g. Internal project code"
                    value={addForm.name}
                    onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Category</label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    value={addForm.category}
                    onChange={(e) => setAddForm((f) => ({ ...f, category: e.target.value }))}
                  >
                    {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Regex Pattern</label>
                <div className="relative">
                  <Input
                    placeholder="e.g. \b[A-Z]{3}-\d{4}\b"
                    value={addForm.pattern}
                    onChange={(e) => setAddForm((f) => ({ ...f, pattern: e.target.value }))}
                    className="h-9 text-sm font-mono pr-9"
                  />
                  <div className="absolute right-2.5 top-2.5">
                    <RegexValidityIcon pattern={addForm.pattern} />
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Replacement Prefix</label>
                <Input
                  placeholder="e.g. PROJ (becomes PROJ_C...)"
                  value={addForm.replacementPrefix}
                  onChange={(e) => setAddForm((f) => ({ ...f, replacementPrefix: e.target.value.toUpperCase() }))}
                  className="h-9 text-sm font-mono"
                />
                <p className="text-xs text-muted-foreground">Matches will be replaced with e.g. <code className="bg-muted px-1 rounded">{addForm.replacementPrefix || "CUSTOM"}_C1A2B3C4</code></p>
              </div>
              {addError && (
                <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                  <XCircle className="h-4 w-4 shrink-0" />
                  {addError}
                </div>
              )}
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={addLoading || !isPatternValid(addForm.pattern)}>
                  {addLoading ? "Creating…" : "Create Rule"}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowAddForm(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Rules Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center justify-between">
            <span>Rules ({rules.length})</span>
            {rules.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                {rules.filter((r) => r.enabled).length} active
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : error ? (
            <div className="p-6 text-center text-sm text-destructive">{error}</div>
          ) : rules.length === 0 ? (
            <div className="p-10 text-center">
              <Filter className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground font-medium">No custom rules yet</p>
              <p className="text-xs text-muted-foreground mt-1">Add a rule to mask additional patterns beyond the built-in detectors.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {rules.map((rule) => (
                <div key={rule.id}>
                  {editingId === rule.id ? (
                    /* Edit inline */
                    <form onSubmit={handleSaveEdit} className="p-4 space-y-3 bg-muted/30">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Name</label>
                          <Input
                            value={editForm.name}
                            onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                            className="h-8 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Category</label>
                          <select
                            className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                            value={editForm.category}
                            onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                          >
                            {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Pattern</label>
                        <div className="relative">
                          <Input
                            value={editForm.pattern}
                            onChange={(e) => setEditForm((f) => ({ ...f, pattern: e.target.value }))}
                            className="h-8 text-sm font-mono pr-9"
                          />
                          <div className="absolute right-2.5 top-2">
                            <RegexValidityIcon pattern={editForm.pattern} />
                          </div>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Replacement Prefix</label>
                        <Input
                          value={editForm.replacementPrefix}
                          onChange={(e) => setEditForm((f) => ({ ...f, replacementPrefix: e.target.value.toUpperCase() }))}
                          className="h-8 text-sm font-mono"
                        />
                      </div>
                      {editError && (
                        <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 rounded px-2 py-1.5">
                          <XCircle className="h-3.5 w-3.5 shrink-0" />
                          {editError}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <Button type="submit" size="sm" className="h-7 text-xs" disabled={editLoading || !isPatternValid(editForm.pattern)}>
                          <Check className="h-3 w-3 mr-1" />
                          {editLoading ? "Saving…" : "Save"}
                        </Button>
                        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditingId(null)}>
                          <X className="h-3 w-3 mr-1" />
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : (
                    /* Read-only row */
                    <div className="px-4 py-3 flex items-start gap-3">
                      {/* Enable toggle */}
                      <button
                        type="button"
                        onClick={() => handleToggleEnabled(rule)}
                        className={cn(
                          "mt-0.5 w-8 h-4.5 rounded-full shrink-0 transition-colors relative",
                          rule.enabled ? "bg-primary" : "bg-muted-foreground/30"
                        )}
                        aria-label={rule.enabled ? "Disable rule" : "Enable rule"}
                        title={rule.enabled ? "Enabled — click to disable" : "Disabled — click to enable"}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
                            rule.enabled ? "translate-x-4" : "translate-x-0.5"
                          )}
                        />
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">{rule.name}</span>
                          <Badge variant="secondary" className="text-[10px] py-0 px-1.5 shrink-0">
                            {rule.category}
                          </Badge>
                          {!rule.enabled && (
                            <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-muted-foreground shrink-0">
                              Disabled
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono truncate max-w-[280px]">
                            {rule.pattern}
                          </code>
                          <RegexValidityIcon pattern={rule.pattern} />
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Prefix: <code className="font-mono">{rule.replacementPrefix}</code>
                        </p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => openTest(rule)}
                          title="Test this rule"
                        >
                          {testRuleId === rule.id
                            ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                            : <PlayCircle className="h-3.5 w-3.5 text-muted-foreground" />
                          }
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => startEdit(rule)}
                          title="Edit rule"
                        >
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleDelete(rule.id)}
                          title="Delete rule"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Test panel */}
                  {testRuleId === rule.id && editingId !== rule.id && (
                    <div className="border-t border-border bg-muted/20 px-4 pb-4 pt-3">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Test Rule</p>
                      <form onSubmit={handleTest} className="space-y-3">
                        <div className="space-y-1.5">
                          <label className="text-xs text-muted-foreground">Pattern</label>
                          <div className="relative">
                            <Input
                              value={testPattern}
                              onChange={(e) => { setTestPattern(e.target.value); setTestResult(null); }}
                              className="h-8 text-sm font-mono pr-9"
                              placeholder="Regex pattern to test"
                            />
                            <div className="absolute right-2.5 top-2">
                              <RegexValidityIcon pattern={testPattern} />
                            </div>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs text-muted-foreground">Sample Text</label>
                          <textarea
                            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                            value={testText}
                            onChange={(e) => { setTestText(e.target.value); setTestResult(null); }}
                            placeholder="Paste sample text here to test what the rule would match…"
                          />
                        </div>
                        <Button
                          type="submit"
                          size="sm"
                          variant="secondary"
                          className="h-7 text-xs gap-1.5"
                          disabled={testLoading || !testPattern}
                        >
                          <PlayCircle className="h-3.5 w-3.5" />
                          {testLoading ? "Testing…" : "Run Test"}
                        </Button>
                      </form>

                      {testResult && (
                        <div className="mt-4 space-y-3">
                          {!testResult.valid ? (
                            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                              <XCircle className="h-4 w-4 shrink-0" />
                              {testResult.error || "Invalid regex"}
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2">
                                {testResult.matches.length > 0 ? (
                                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                                ) : (
                                  <XCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                                )}
                                <span className="text-sm font-medium">
                                  {testResult.matches.length} match{testResult.matches.length !== 1 ? "es" : ""}
                                </span>
                              </div>

                              {testResult.matches.length > 0 && (
                                <div className="space-y-1.5">
                                  <p className="text-xs text-muted-foreground font-medium">Matched values:</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {testResult.matches.slice(0, 20).map((m, i) => (
                                      <code key={i} className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 px-1.5 py-0.5 rounded font-mono">
                                        {m}
                                      </code>
                                    ))}
                                    {testResult.matches.length > 20 && (
                                      <span className="text-xs text-muted-foreground">+{testResult.matches.length - 20} more</span>
                                    )}
                                  </div>
                                </div>
                              )}

                              {testResult.preview && testText && (
                                <div className="space-y-1.5">
                                  <p className="text-xs text-muted-foreground font-medium">Preview (matches highlighted):</p>
                                  <pre className="text-xs bg-muted rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words font-mono max-h-40">
                                    {testResult.preview.split(/(\[MASKED:[^\]]+\])/g).map((part, i) =>
                                      part.startsWith("[MASKED:") ? (
                                        <mark key={i} className="bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100 rounded px-0.5">
                                          {part}
                                        </mark>
                                      ) : part
                                    )}
                                  </pre>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info card */}
      <Card className="border-muted">
        <CardContent className="py-4 px-5">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong className="text-foreground">How custom rules work:</strong> Enabled rules are applied after LLMask's
            built-in detectors (NER, PII patterns). Each match is replaced with a deterministic pseudonym using the rule's
            prefix (e.g., <code className="bg-muted px-1 rounded font-mono">PROJ_C1A2B3C4</code>). Mappings are stored
            per-session and reversed in LLM responses, just like built-in entities.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
