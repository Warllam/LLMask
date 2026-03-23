import fs from "node:fs";

type ShieldConfig = {
  replacements: Record<string, string>;
};

/**
 * ProjectShield — static string replacement to mask project/product/client identity.
 *
 * Loads a dictionary of explicit replacements from a JSON file and applies them
 * to request bodies (before NER) and reverses them in responses (after pseudonym remap).
 *
 * No DB storage — the dictionary is deterministic and loaded at startup.
 */
export class ProjectShield {
  private regex: RegExp | null;
  private reverseRegex: RegExp | null;
  private readonly replacements: Map<string, string>;     // original → masked
  private readonly reverseMap: Map<string, string>;        // masked → original
  private readonly lowerReplacements: Map<string, string>; // lower(original) → masked (fallback)
  private readonly lowerReverseMap: Map<string, string>;   // lower(masked) → original (fallback)
  private readonly substringKeys: Set<string> = new Set(); // keys that match inside compound words

  private constructor(replacements: Map<string, string>) {
    this.replacements = replacements;
    this.reverseMap = new Map<string, string>();
    this.lowerReplacements = new Map<string, string>();
    this.lowerReverseMap = new Map<string, string>();

    for (const [original, masked] of replacements) {
      this.reverseMap.set(masked, original);
      // Case-insensitive fallback: keep first entry per lowercase key
      const lowerOrig = original.toLowerCase();
      if (!this.lowerReplacements.has(lowerOrig)) {
        this.lowerReplacements.set(lowerOrig, masked);
      }
      const lowerMasked = masked.toLowerCase();
      if (!this.lowerReverseMap.has(lowerMasked)) {
        this.lowerReverseMap.set(lowerMasked, original);
      }
    }

    if (replacements.size === 0) {
      this.regex = null;
      this.reverseRegex = null;
      return;
    }

    // Sort keys by length descending so longer matches take priority
    // e.g. "mouvements-de-stock-i-run" matches before "i-run"
    const originals = [...replacements.keys()].sort((a, b) => b.length - a.length);
    const masked = [...this.reverseMap.keys()].sort((a, b) => b.length - a.length);

    this.regex = buildAlternationRegex(originals, this.substringKeys);
    this.reverseRegex = buildAlternationRegex(masked);
  }

  /** Load shield config from a JSON file. */
  static fromFile(filePath: string): ProjectShield {
    const raw = fs.readFileSync(filePath, "utf-8");
    const config: ShieldConfig = JSON.parse(raw);

    if (!config.replacements || typeof config.replacements !== "object") {
      return ProjectShield.empty();
    }

    const map = new Map<string, string>();
    for (const [original, masked] of Object.entries(config.replacements)) {
      if (typeof masked === "string" && original.length > 0 && masked.length > 0) {
        map.set(original, masked);
      }
    }

    return new ProjectShield(map);
  }

  /** No-op shield when disabled. */
  static empty(): ProjectShield {
    return new ProjectShield(new Map());
  }

  /** Whether this shield has any replacements configured. */
  get enabled(): boolean {
    return this.replacements.size > 0;
  }

  /** Number of replacement rules. */
  get ruleCount(): number {
    return this.replacements.size;
  }

  /** Original project-identifying strings (for leak detection). */
  get originalTerms(): string[] {
    return [...this.replacements.keys()];
  }

  /** Dynamically add a replacement at runtime (e.g. auto-discovered domains). */
  addReplacement(original: string, masked: string): boolean {
    if (this.replacements.has(original)) return false;
    if (original.length === 0 || masked.length === 0) return false;

    this.replacements.set(original, masked);
    this.reverseMap.set(masked, original);

    const lowerOrig = original.toLowerCase();
    if (!this.lowerReplacements.has(lowerOrig)) {
      this.lowerReplacements.set(lowerOrig, masked);
    }
    const lowerMasked = masked.toLowerCase();
    if (!this.lowerReverseMap.has(lowerMasked)) {
      this.lowerReverseMap.set(lowerMasked, original);
    }

    this.rebuildRegexes();
    return true;
  }

  /**
   * Add a substring replacement — matches INSIDE compound words (no word boundaries).
   * Use for entity prefixes like "Brevo" that appear in "BrevoContactAdapter".
   */
  addSubstringReplacement(original: string, masked: string): boolean {
    if (this.replacements.has(original)) return false;
    if (original.length === 0 || masked.length === 0) return false;

    this.substringKeys.add(original);
    this.replacements.set(original, masked);
    this.reverseMap.set(masked, original);

    const lowerOrig = original.toLowerCase();
    if (!this.lowerReplacements.has(lowerOrig)) {
      this.lowerReplacements.set(lowerOrig, masked);
      this.substringKeys.add(lowerOrig);
    }
    const lowerMasked = masked.toLowerCase();
    if (!this.lowerReverseMap.has(lowerMasked)) {
      this.lowerReverseMap.set(lowerMasked, original);
    }

    this.rebuildRegexes();
    return true;
  }

  private rebuildRegexes(): void {
    const originals = [...this.replacements.keys()].sort((a, b) => b.length - a.length);
    const maskedKeys = [...this.reverseMap.keys()].sort((a, b) => b.length - a.length);
    this.regex = buildAlternationRegex(originals, this.substringKeys);
    this.reverseRegex = buildAlternationRegex(maskedKeys);
  }

  /** Mask project identity strings in text (request direction). */
  apply(text: string): string {
    if (!this.regex) return text;
    this.regex.lastIndex = 0;
    return text.replace(this.regex, (match) =>
      this.replacements.get(match)
        ?? this.lowerReplacements.get(match.toLowerCase())
        ?? match
    );
  }

  /** Restore original project strings in text (response direction). */
  reverse(text: string): string {
    if (!this.reverseRegex) return text;
    this.reverseRegex.lastIndex = 0;
    return text.replace(this.reverseRegex, (match) =>
      this.reverseMap.get(match)
        ?? this.lowerReverseMap.get(match.toLowerCase())
        ?? match
    );
  }
}

/**
 * Build a regex that matches any of the given strings.
 * Uses custom boundaries (lookbehind/lookahead) that treat _ as a separator,
 * unlike \b which considers _ a word char. This ensures project names match
 * in snake_case compounds (e.g. llmask_token, LLMASK_MODE).
 */
function buildAlternationRegex(strings: string[], substringKeys?: Set<string>): RegExp {
  const escaped = strings.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  // Deduplicate patterns that are identical case-insensitively (since we use `i` flag)
  const seen = new Set<string>();
  const patterns: string[] = [];

  for (let i = 0; i < escaped.length; i++) {
    const lower = escaped[i].toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);

    const original = strings[i];

    // Substring replacements have no word boundaries (match inside compound words)
    if (substringKeys?.has(original)) {
      patterns.push(escaped[i]);
    } else {
      // Custom boundary: only letters and digits count as word chars (not _).
      // This makes llmask match in llmask_token, LLMASK_MODE, etc.
      const prefix = /[a-zA-Z0-9]/.test(original[0]) ? "(?<![a-zA-Z0-9])" : "";
      const suffix = /[a-zA-Z0-9]/.test(original[original.length - 1]) ? "(?![a-zA-Z0-9])" : "";
      patterns.push(prefix + escaped[i] + suffix);
    }
  }

  return new RegExp(patterns.join("|"), "gi");
}
