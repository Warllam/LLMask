/**
 * Simulated masking engine for benchmarking purposes.
 *
 * Applies different masking strategies to prompts by replacing sensitive elements
 * with pseudonyms. This simulates what LLMask's rewrite engine does, but with
 * configurable strategies.
 *
 * For real benchmarks against the actual LLMask engine, use --live-proxy mode.
 */

import type { MaskingStrategy, MaskCategory } from "./strategies";
import { shouldMask } from "./strategies";
import type { PromptSpec, MaskingResult } from "./scorer";

// ─── Entity Classification ──────────────────────────────────────────────────

interface DetectedEntity {
  value: string;
  category: MaskCategory;
  index: number;
}

// Patterns for detecting different categories of sensitive data
const PATTERNS: Array<{ category: MaskCategory; pattern: RegExp; priority: number }> = [
  // PII
  { category: "email", pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, priority: 10 },
  { category: "phone", pattern: /(?:\+\d{1,3}[\s.-]?)?\(?\d{1,4}\)?[\s.-]?\d{2,4}[\s.-]?\d{2,4}[\s.-]?\d{2,4}\b/g, priority: 9 },
  { category: "iban", pattern: /\b[A-Z]{2}\d{2}[\s]?(?:\d{4}[\s]?){2,7}\d{1,4}\b/g, priority: 10 },
  { category: "national_id", pattern: /\b[12][\s]?\d{2}[\s]?\d{2}[\s]?\d{2}[\s]?\d{3}[\s]?\d{3}[\s]?\d{2}\b/g, priority: 10 },
  { category: "ip_address", pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, priority: 7 },

  // Secrets
  { category: "api_key", pattern: /\b(?:sk|pk|strtm|AKIA)[_-]?[A-Za-z0-9_\-]{16,}\b/g, priority: 10 },
  { category: "secret_token", pattern: /\b(?:hvs\.|ghp_|gho_|Bearer\s+)[A-Za-z0-9_\-.]+\b/g, priority: 10 },
  { category: "password", pattern: /(?:password|passwd|secret)[\s]*[:=][\s]*["']([^"']+)["']/gi, priority: 10 },

  // URLs / domains
  { category: "internal_url", pattern: /https?:\/\/[a-z0-9\-]+\.(?:internal|local|corp)[^\s"')}\]]+/gi, priority: 8 },
  { category: "internal_domain", pattern: /\b[a-z0-9\-]+\.(?:internal|local|corp)(?::\d+)?\b/gi, priority: 7 },
];

// Common programming keywords that should NEVER be masked
const LANGUAGE_KEYWORDS = new Set([
  // JS/TS
  "function", "class", "const", "let", "var", "import", "export", "return",
  "if", "else", "for", "while", "do", "switch", "case", "break", "continue",
  "new", "this", "async", "await", "try", "catch", "finally", "throw",
  "interface", "type", "enum", "extends", "implements", "abstract",
  "public", "private", "protected", "static", "readonly", "void",
  "true", "false", "null", "undefined", "string", "number", "boolean",
  // Python
  "def", "self", "cls", "None", "True", "False", "with", "as", "from",
  "yield", "lambda", "pass", "raise", "except", "global", "nonlocal",
  // SQL
  "SELECT", "FROM", "WHERE", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER",
  "ON", "AND", "OR", "NOT", "IN", "BETWEEN", "LIKE", "ORDER", "BY",
  "GROUP", "HAVING", "LIMIT", "OFFSET", "INSERT", "INTO", "VALUES",
  "UPDATE", "SET", "DELETE", "CREATE", "TABLE", "INDEX", "ALTER", "DROP",
  "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "UNIQUE", "DEFAULT",
  "VARCHAR", "INT", "BIGINT", "TEXT", "BOOLEAN", "TIMESTAMP", "DATE",
  "UUID", "JSONB", "JSON", "ENUM", "AUTO_INCREMENT", "NOT", "NULL",
  // Go
  "func", "struct", "map", "chan", "go", "defer", "range", "select",
  "package", "main",
  // Velocity
  "#set", "#if", "#else", "#end", "#foreach", "#macro",
  // Generic
  "true", "false", "nil", "null",
]);

// ─── Pseudonym Generation ───────────────────────────────────────────────────

const PSEUDONYM_PREFIXES: Partial<Record<MaskCategory, string>> = {
  person_name: "PER",
  email: "MAIL",
  phone: "TEL",
  address: "ADDR",
  national_id: "NATID",
  iban: "IBAN",
  api_key: "KEY",
  password: "PASS",
  secret_token: "TOKEN",
  ip_address: "IP",
  internal_url: "URL",
  internal_domain: "HOST",
  org_name: "ORG",
  variable_name: "VAR",
  function_name: "FN",
  class_name: "CLS",
  table_name: "TBL",
  column_name: "COL",
  string_literal: "STR",
  numeric_literal: "NUM",
  env_value: "ENV",
};

const PHONETIC = [
  "ALPHA", "BRAVO", "CHARLIE", "DELTA", "ECHO", "FOXTROT", "GOLF",
  "HOTEL", "INDIA", "JULIET", "KILO", "LIMA", "MIKE", "NOVEMBER",
  "OSCAR", "PAPA", "QUEBEC", "ROMEO", "SIERRA", "TANGO", "UNIFORM",
  "VICTOR", "WHISKEY", "XRAY", "YANKEE", "ZULU",
];

class PseudonymMap {
  private map = new Map<string, string>();
  private counters = new Map<string, number>();

  get(value: string, category: MaskCategory): string {
    const key = `${category}::${value.toLowerCase()}`;
    if (this.map.has(key)) return this.map.get(key)!;

    const prefix = PSEUDONYM_PREFIXES[category] || "ENT";
    const idx = this.counters.get(prefix) ?? 0;
    this.counters.set(prefix, idx + 1);
    const name = PHONETIC[idx % PHONETIC.length];
    const pseudonym = `${prefix}_${name}`;
    this.map.set(key, pseudonym);
    return pseudonym;
  }
}

// ─── Code Block Detection ───────────────────────────────────────────────────

interface TextSegment {
  text: string;
  isCode: boolean;
  start: number;
  end: number;
}

function segmentText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const fencePattern = /```[\w]*\n?/g;
  let lastEnd = 0;
  let inCode = false;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(text)) !== null) {
    if (match.index > lastEnd) {
      segments.push({
        text: text.slice(lastEnd, match.index),
        isCode: inCode,
        start: lastEnd,
        end: match.index,
      });
    }
    // The fence itself
    segments.push({
      text: match[0],
      isCode: false, // fences are structural, never mask
      start: match.index,
      end: match.index + match[0].length,
    });
    lastEnd = match.index + match[0].length;
    inCode = !inCode;
  }

  if (lastEnd < text.length) {
    segments.push({
      text: text.slice(lastEnd),
      isCode: inCode,
      start: lastEnd,
      end: text.length,
    });
  }

  return segments;
}

// ─── Main Masking Function ──────────────────────────────────────────────────

export function applyMasking(
  spec: PromptSpec,
  strategy: MaskingStrategy,
): MaskingResult {
  const pseudonyms = new PseudonymMap();
  let maskedPrompt = spec.prompt;
  let maskedCount = 0;
  let preservedCount = 0;

  // Detect entities from sensitiveElements list (ground truth for benchmarking)
  // In real LLMask, detection is automatic; here we use the spec's declared sensitive elements
  const segments = strategy.codeBlockAware ? segmentText(maskedPrompt) : null;

  // Helper: check if a position is inside a code block
  function isInsideCode(position: number): boolean {
    if (!segments) return false;
    for (const seg of segments) {
      if (position >= seg.start && position < seg.end) return seg.isCode;
    }
    return false;
  }

  // Classify each sensitive element
  function classifyElement(element: string): MaskCategory {
    if (/@/.test(element) && /\./.test(element)) return "email";
    if (/^\+?\d[\d\s.-]{8,}$/.test(element)) return "phone";
    if (/^[A-Z]{2}\d{2}/.test(element) && element.length > 15) return "iban";
    if (/^[12]\s?\d{2}\s?\d{2}\s?\d{2}\s?\d{3}\s?\d{3}\s?\d{2}$/.test(element)) return "national_id";
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(element)) return "ip_address";
    if (/https?:\/\/.*\.(?:internal|local|corp)/.test(element)) return "internal_url";
    if (/\.(?:internal|local|corp)/.test(element)) return "internal_domain";
    if (/(?:sk_|pk_|strtm_|AKIA|hvs\.|api[_-]?key)/i.test(element)) return "api_key";
    if (/(?:secret|password|token)/i.test(element) && element.length > 10) return "secret_token";
    if (/\b\d+\.\d+\.\d+\b/.test(element)) return "ip_address";

    // Check if it's an address
    if (/\d+.*(?:rue|avenue|street|road|blvd)/i.test(element)) return "address";

    // Check if it looks like a person name (multi-word capitalized names)
    if (/^[A-ZÀ-Ü][a-zà-ÿ]+(?:\s+[A-ZÀ-Ü][A-Za-zà-ÿ]+)+$/.test(element)) return "person_name";
    if (/^[A-ZÀ-Ü][a-zà-ÿ]+-[A-ZÀ-Ü][a-zà-ÿ]+\s+[A-ZÀ-Ü]+$/.test(element)) return "person_name";

    // Check if it's an org name (contains capital letters and common org suffixes)
    if (/(?:Technologies|Labs|Group|Systems|Analytics|Financial)/i.test(element)) return "org_name";

    // Named entities starting with capital are more likely org/person names than code identifiers
    if (/^[A-Z]/.test(element)) return "org_name";

    // Check if it looks like a code identifier (camelCase, snake_case, PascalCase)
    if (/^[a-z][a-zA-Z0-9]*$/.test(element)) return "variable_name";
    if (/^[A-Z][a-zA-Z0-9]*(?:[A-Z][a-z]+)+$/.test(element)) return "class_name";
    if (/^[a-z_]+(?:_[a-z]+)+$/.test(element)) return "column_name";
    if (/^[a-z_]+(?:_[a-z]+)*\(?\)?$/.test(element)) return "function_name";

    // Check for table-like names (prefixed with schema indicators)
    if (/^[a-z]{2,4}_[a-z_]+$/.test(element)) return "table_name";

    return "string_literal";
  }

  // Sort sensitive elements by length (longest first) to avoid partial replacements
  const sortedElements = [...spec.sensitiveElements].sort((a, b) => b.length - a.length);

  for (const element of sortedElements) {
    const category = classifyElement(element);

    // Find all occurrences
    let searchFrom = 0;
    while (true) {
      const idx = maskedPrompt.toLowerCase().indexOf(element.toLowerCase(), searchFrom);
      if (idx === -1) break;

      const inCode = isInsideCode(idx);
      if (shouldMask(strategy, category, inCode)) {
        const pseudonym = pseudonyms.get(element, category);
        maskedPrompt =
          maskedPrompt.slice(0, idx) +
          pseudonym +
          maskedPrompt.slice(idx + element.length);
        maskedCount++;
        // Adjust search position for the replacement
        searchFrom = idx + pseudonym.length;
      } else {
        preservedCount++;
        searchFrom = idx + element.length;
      }
    }
  }

  // For aggressive strategy, also mask detected patterns not in sensitiveElements
  if (strategy.id === "aggressive") {
    for (const { category, pattern } of PATTERNS) {
      pattern.lastIndex = 0;
      const matches: Array<{ value: string; index: number }> = [];
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(maskedPrompt)) !== null) {
        // Don't re-mask already-pseudonymized content
        if (!m[0].includes("_ALPHA") && !m[0].includes("_BRAVO")) {
          matches.push({ value: m[0], index: m.index });
        }
      }
      // Replace in reverse order to preserve indices
      for (const match of matches.reverse()) {
        if (!spec.sensitiveElements.some((e) => e.toLowerCase() === match.value.toLowerCase())) {
          const inCode = isInsideCode(match.index);
          if (shouldMask(strategy, category, inCode)) {
            const pseudonym = pseudonyms.get(match.value, category);
            maskedPrompt =
              maskedPrompt.slice(0, match.index) +
              pseudonym +
              maskedPrompt.slice(match.index + match.value.length);
            maskedCount++;
          }
        }
      }
    }
  }

  return {
    maskedPrompt,
    maskedCount,
    preservedCount,
    totalSensitive: spec.sensitiveElements.length,
  };
}
