#!/usr/bin/env node
/**
 * Standalone masking engine for the LLMask MCP server.
 * Self-contained — no imports from the main LLMask project.
 */

export type Strategy = "aggressive" | "code-aware" | "values-only" | "pii-only";

export type MaskedElement = {
  original: string;
  replacement: string;
  category: string;
};

export type MaskResult = {
  masked_text: string;
  scope_id: string;
  elements_masked: number;
  details: MaskedElement[];
};

// ── Regex patterns ────────────────────────────────────────────────────────────

const PATTERNS: Array<{ re: RegExp; category: string; strategies: Strategy[] }> = [
  // Secrets / API keys (all strategies)
  { re: /\b(AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g, category: "api_key.aws", strategies: ["aggressive", "code-aware", "values-only", "pii-only"] },
  { re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, category: "api_key.anthropic", strategies: ["aggressive", "code-aware", "values-only", "pii-only"] },
  { re: /\bsk-[A-Za-z0-9]{20,}\b/g, category: "api_key.openai", strategies: ["aggressive", "code-aware", "values-only", "pii-only"] },
  { re: /\bghp_[A-Za-z0-9]{36,}\b/g, category: "api_key.github", strategies: ["aggressive", "code-aware", "values-only", "pii-only"] },
  { re: /\bgithub_pat_[A-Za-z0-9_]{82,}\b/g, category: "api_key.github", strategies: ["aggressive", "code-aware", "values-only", "pii-only"] },
  { re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g, category: "api_key.gitlab", strategies: ["aggressive", "code-aware", "values-only", "pii-only"] },
  { re: /\b(sk_live|sk_test)_[0-9a-zA-Z]{24,}\b/g, category: "api_key.stripe", strategies: ["aggressive", "code-aware", "values-only", "pii-only"] },
  { re: /\bxoxb-[0-9A-Za-z-]+\b/g, category: "api_key.slack", strategies: ["aggressive", "code-aware", "values-only", "pii-only"] },
  { re: /\bnpm_[A-Za-z0-9]{36}\b/g, category: "api_key.npm", strategies: ["aggressive", "code-aware", "values-only", "pii-only"] },
  { re: /\bhvs\.[A-Za-z0-9_-]{24,}\b/g, category: "api_key.vault", strategies: ["aggressive", "code-aware", "values-only", "pii-only"] },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/g, category: "api_key.gcp", strategies: ["aggressive", "code-aware", "values-only", "pii-only"] },
  { re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g, category: "api_key.sendgrid", strategies: ["aggressive", "code-aware", "values-only", "pii-only"] },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\b/g, category: "auth.jwt", strategies: ["aggressive", "code-aware", "values-only", "pii-only"] },
  { re: /-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+|PGP\s+)?PRIVATE KEY(?:\s+BLOCK)?-----/g, category: "crypto.private_key", strategies: ["aggressive", "code-aware", "values-only", "pii-only"] },
  { re: /(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mariadb|redis|amqp):\/\/[^\s"'`]+:[^\s"'`]+@[^\s"'`]+/g, category: "secret.db_url", strategies: ["aggressive", "code-aware", "values-only", "pii-only"] },

  // PII (all strategies)
  { re: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, category: "pii.email", strategies: ["aggressive", "code-aware", "values-only", "pii-only"] },
  { re: /(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, category: "pii.phone", strategies: ["aggressive", "code-aware", "values-only", "pii-only"] },
  { re: /\b\d{3}-\d{2}-\d{4}\b/g, category: "pii.ssn", strategies: ["aggressive", "code-aware", "values-only", "pii-only"] },
  { re: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|6(?:011|5[0-9]{2})[0-9]{12})\b/g, category: "pii.credit_card", strategies: ["aggressive", "code-aware", "values-only", "pii-only"] },

  // IPs (aggressive + code-aware, not pii-only)
  { re: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g, category: "network.ip", strategies: ["aggressive", "code-aware"] },

  // Passwords in assignment context (aggressive + values-only)
  { re: /(?:password|passwd|secret|token|key|pwd)\s*[:=]\s*["']([^"']{6,})["']/gi, category: "secret.password", strategies: ["aggressive", "values-only"] },

  // Names: "First LAST" style (aggressive only)
  { re: /\b([A-Z][a-z]+(?:-[A-Z][a-z]+)?)\s+([A-Z]{2,})\b/g, category: "pii.name", strategies: ["aggressive"] },
];

// ── Shannon entropy for secret detection ─────────────────────────────────────

function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1);
  let e = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    e -= p * Math.log2(p);
  }
  return e;
}

// High-entropy string detection (catches generic secrets not matched by patterns)
const HIGH_ENTROPY_RE = /(?<=[A-Za-z_-]{2,}\s*[:=]\s*["']?)([A-Za-z0-9+/=_\-]{20,})(?=["']?)/g;

function detectHighEntropy(text: string): Array<{ value: string; index: number }> {
  const results: Array<{ value: string; index: number }> = [];
  for (const m of text.matchAll(HIGH_ENTROPY_RE)) {
    const val = m[1];
    if (shannonEntropy(val) > 4.5 && /[A-Z]/.test(val) && /[a-z]/.test(val) && /[0-9]/.test(val)) {
      results.push({ value: val, index: m.index! + (m[0].length - val.length) });
    }
  }
  return results;
}

// ── Pseudonym generation ──────────────────────────────────────────────────────

const ADJECTIVES = ["amber", "azure", "brisk", "coral", "crisp", "dusty", "ebon", "fern", "gilt", "hazy", "jade", "keen", "lush", "mild", "navy", "opal", "pine", "rose", "sage", "teal"];
const NOUNS = ["apple", "brook", "cedar", "delta", "ember", "fjord", "grove", "haven", "inlet", "jetty", "knoll", "ledge", "maple", "nexus", "orbit", "prism", "quill", "ridge", "stone", "trail"];

function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

function pseudonymFor(value: string, category: string, seenMap: Map<string, string>): string {
  const key = `${category}:${value}`;
  if (seenMap.has(key)) return seenMap.get(key)!;

  const h = hashStr(value);
  let pseudo: string;

  if (category === "pii.email") {
    const adj = ADJECTIVES[h % ADJECTIVES.length];
    const noun = NOUNS[(h >>> 4) % NOUNS.length];
    pseudo = `${adj}.${noun}@masked.example`;
  } else if (category === "pii.phone") {
    pseudo = `+1-555-${String((h % 9000) + 1000).slice(0, 4)}`;
  } else if (category === "pii.ssn") {
    pseudo = `XXX-XX-${String((h % 9000) + 1000).slice(0, 4)}`;
  } else if (category === "pii.credit_card") {
    pseudo = `[CARD-XXXX-${String((h % 9000) + 1000)}]`;
  } else if (category === "network.ip") {
    pseudo = `10.0.${h % 256}.${(h >>> 8) % 256}`;
  } else if (category === "pii.name") {
    const adj = ADJECTIVES[h % ADJECTIVES.length];
    const noun = NOUNS[(h >>> 4) % NOUNS.length];
    pseudo = `${adj.charAt(0).toUpperCase() + adj.slice(1)} ${noun.toUpperCase()}`;
  } else if (category.startsWith("api_key") || category.startsWith("secret") || category.startsWith("auth") || category.startsWith("crypto")) {
    const tag = category.split(".").pop()!.toUpperCase().slice(0, 8);
    pseudo = `[${tag}-REDACTED-${(h % 0xffff).toString(16).padStart(4, "0")}]`;
  } else {
    pseudo = `[MASKED-${(h % 0xffff).toString(16).padStart(4, "0")}]`;
  }

  seenMap.set(key, pseudo);
  return pseudo;
}

// ── Scope store ───────────────────────────────────────────────────────────────

type ScopeEntry = { original: string; replacement: string };
const scopeStore = new Map<string, ScopeEntry[]>();

function newScopeId(): string {
  return `scope_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Core mask function ────────────────────────────────────────────────────────

export function maskText(text: string, strategy: Strategy = "aggressive"): MaskResult {
  const scopeId = newScopeId();
  const pseudoMap = new Map<string, string>(); // category:value → pseudo
  const details: MaskedElement[] = [];
  const seen = new Set<string>();

  // Collect all matches
  const matches: Array<{ value: string; index: number; category: string; length: number }> = [];

  for (const { re, category, strategies } of PATTERNS) {
    if (!strategies.includes(strategy)) continue;
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const raw = m[0];
      // For password pattern, the captured group is the value
      const value = m[1] && category === "secret.password" ? m[1] : raw;
      if (!seen.has(`${category}:${value}`)) {
        seen.add(`${category}:${value}`);
        matches.push({ value, index: m.index! + (raw.length - value.length), category, length: value.length });
      }
    }
  }

  // High-entropy detection (aggressive + code-aware)
  if (strategy === "aggressive" || strategy === "code-aware") {
    for (const { value, index } of detectHighEntropy(text)) {
      const k = `secret.entropy:${value}`;
      if (!seen.has(k)) {
        seen.add(k);
        matches.push({ value, index, category: "secret.entropy", length: value.length });
      }
    }
  }

  // Sort by position descending so we can splice without offset issues
  matches.sort((a, b) => b.index - a.index);

  let result = text;
  for (const { value, index, category, length } of matches) {
    const pseudo = pseudonymFor(value, category, pseudoMap);
    details.push({ original: value, replacement: pseudo, category });
    result = result.slice(0, index) + pseudo + result.slice(index + length);
  }

  // Store mappings for unmask
  const entries: ScopeEntry[] = details.map(d => ({ original: d.original, replacement: d.replacement }));
  scopeStore.set(scopeId, entries);

  return {
    masked_text: result,
    scope_id: scopeId,
    elements_masked: details.length,
    details,
  };
}

// ── Unmask function ───────────────────────────────────────────────────────────

export function unmaskText(maskedText: string, scopeId: string): { unmasked_text: string; replacements: number } {
  const entries = scopeStore.get(scopeId);
  if (!entries || entries.length === 0) {
    return { unmasked_text: maskedText, replacements: 0 };
  }

  let result = maskedText;
  let count = 0;
  // Longest replacement first to avoid partial matches
  const sorted = [...entries].sort((a, b) => b.replacement.length - a.replacement.length);
  for (const { original, replacement } of sorted) {
    const escaped = replacement.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "g");
    const before = result;
    result = result.replace(re, original);
    if (result !== before) count++;
  }
  return { unmasked_text: result, replacements: count };
}
