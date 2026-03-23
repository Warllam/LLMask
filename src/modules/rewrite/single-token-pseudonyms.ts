import type { MappingKind } from "../mapping-store/mapping-store";

/**
 * Single-token pseudonym generator.
 *
 * Instead of `svc_01`, `tbl_02`, etc. (which BPE tokenizers split into
 * multiple tokens like "svc", "_", "01"), this generator uses real English
 * words that are guaranteed to be single tokens in both GPT and Claude
 * tokenizers.
 *
 * Benefits:
 * - LLM treats them as atomic units → never splits/alters them
 * - Streaming deanonymization is trivial (no cross-event splits)
 * - More readable for debugging
 *
 * Format: `XALPHA`, `XBRAVO`, `XCEDAR` (X prefix prevents collision with
 * real code identifiers)
 */

// Words chosen to be:
// 1. Single BPE tokens in tiktoken (cl100k_base) and Claude's tokenizer
// 2. Uncommon enough to never appear in real code
// 3. Easy to distinguish visually
const WORD_POOLS: Record<MappingKind, string[]> = {
  org: [
    "ZORION", "KALVEN", "PYREX", "VOXEL", "QUASAR",
    "NEXARA", "THALON", "XYPHOS", "MORPHEX", "ZERION",
    "KRATON", "PHELIX", "JAXON", "DYNEX", "VOLTEX",
    "PRAXON", "ZYPHER", "KORVAN", "THERON", "XANTHE",
  ],
  svc: [
    "ZEPHYR", "KRAKEN", "PHENIX", "VORTEX", "NEBULA",
    "SPHINX", "FALCON", "RAPTOR", "ZENITH", "CIPHER",
    "PRIMAL", "ONYX", "COBALT", "TEMPEST", "VERTEX",
    "ARGON", "HELIX", "ORBIT", "MANTLE", "PRISM",
  ],
  tbl: [
    "TOPAZ", "BERYL", "JASPER", "GARNET", "BASALT",
    "PYRITE", "COBALT", "QUARTZ", "MARBLE", "OBSIDIAN",
    "FLINT", "CORAL", "AMBER", "BRONZE", "COPPER",
    "SILVER", "OPAL", "ONYX", "JADE", "PEARL",
  ],
  col: [
    "RUNE", "GLYPH", "SIGIL", "CREST", "TOKEN",
    "BADGE", "MARK", "SEAL", "STAMP", "BRAND",
    "LABEL", "KNOT", "FLAIR", "CHARM", "AURA",
    "SPARK", "GLEAM", "BLAZE", "FROST", "SHADE",
  ],
  idn: [
    "ALPHA", "BRAVO", "CEDAR", "DELTA", "EMBER",
    "FOLIO", "GAMMA", "HAVEN", "IVORY", "JEWEL",
    "KNOLL", "LUMEN", "MACRO", "NEXUS", "OPTIC",
    "PIXEL", "QUOTA", "RAVEN", "SOLAR", "TIDAL",
    "UMBRA", "VALVE", "WRATH", "XENON", "YIELD",
    "ZONAL", "BLOOM", "CRISP", "DRIFT", "EPOCH",
  ],
  per: [
    "LENOX", "CABOT", "THANE", "REEVE", "CARIS",
    "ALDRIC", "RONAN", "KELVIN", "VAUGHN", "CORBIN",
    "FINLEY", "ASHTON", "DARION", "MERCER", "SELWYN",
    "HADLEY", "BRYSON", "COLTON", "AVERY", "DALTON",
  ],
  url: [
    "PORTAL", "GATEWAY", "BRIDGE", "TUNNEL", "BEACON",
    "HARBOR", "ANCHOR", "CONVOY", "RELAY", "CONDUIT",
    "CIRCUIT", "TRANSIT", "VECTOR", "SIGNAL", "RADIUS",
    "SUMMIT", "OUTPOST", "DEPOT", "WAYPOINT", "PATROL",
  ],
  email: [
    "ATLAS", "CARGO", "DATUM", "ENVOY", "FORTE",
    "GUILD", "HERALD", "INTRO", "KARMA", "LANCE",
    "MOTTO", "NAVAL", "OMEN", "PLUME", "QUEST",
    "REALM", "SCOPE", "TRIAD", "VIGOR", "WARDEN",
  ],
  phone: [
    "DIAL", "RING", "PULSE", "TONE", "CHIME",
    "BUZZ", "WAVE", "HORN", "BELL", "GONG",
    "SIREN", "SONAR", "PING", "CHIRP", "CLICK",
    "HAIL", "DRUM", "LYRE", "FIFE", "REED",
  ],
};

// Kind-specific prefixes for readable, semantic pseudonyms
const KIND_PREFIXES: Record<MappingKind, string> = {
  org: "ORG_",
  svc: "SVC_",
  tbl: "TBL_",
  col: "COL_",
  idn: "ID_",
  per: "PER_",
  url: "URL_",
  email: "MAIL_",
  phone: "TEL_",
};

// Legacy prefix for backwards compatibility
const LEGACY_PREFIX = "X";

export type PseudonymStrategy = "counter" | "single-token";

export class SingleTokenPseudonymGenerator {
  private counters = new Map<MappingKind, number>();

  /**
   * Reset counters (for new scope/session).
   */
  reset(): void {
    this.counters.clear();
  }

  /**
   * Initialize counters from existing mappings.
   */
  initFromExisting(existing: Array<{ kind: MappingKind; pseudonym: string }>): void {
    for (const entry of existing) {
      // Parse both formats: "XALPHA" style and "svc_01" style
      const kind = this.detectKind(entry.pseudonym);
      if (!kind) continue;
      const current = this.counters.get(entry.kind) ?? 0;
      const idx = this.getIndex(entry.pseudonym, entry.kind);
      if (idx > current) {
        this.counters.set(entry.kind, idx);
      }
    }
  }

  /**
   * Generate the next pseudonym for a given kind.
   */
  generate(kind: MappingKind): string {
    const next = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, next);

    const prefix = KIND_PREFIXES[kind];
    const pool = WORD_POOLS[kind];
    if (next <= pool.length) {
      return prefix + pool[next - 1];
    }

    // Overflow: combine word + number
    const wordIdx = ((next - 1) % pool.length);
    const cycle = Math.floor((next - 1) / pool.length) + 1;
    return prefix + pool[wordIdx] + cycle;
  }

  /**
   * Get current counter value for a kind.
   */
  getCounter(kind: MappingKind): number {
    return this.counters.get(kind) ?? 0;
  }

  private detectKind(pseudonym: string): MappingKind | null {
    // Check new kind-prefixed format: ORG_ZORION, SVC_ZEPHYR, etc.
    for (const [kind, prefix] of Object.entries(KIND_PREFIXES)) {
      if (pseudonym.startsWith(prefix)) {
        const word = pseudonym.slice(prefix.length).replace(/\d+$/, "");
        if (WORD_POOLS[kind as MappingKind].includes(word)) return kind as MappingKind;
      }
    }

    // Check legacy counter format: svc_01
    const counterMatch = pseudonym.match(/^(org|svc|tbl|col|idn|per|url|email|phone)_\d+$/);
    if (counterMatch) return counterMatch[1] as MappingKind;

    // Check legacy single-token format: XALPHA
    if (pseudonym.startsWith(LEGACY_PREFIX)) {
      const word = pseudonym.slice(LEGACY_PREFIX.length).replace(/\d+$/, "");
      for (const [kind, pool] of Object.entries(WORD_POOLS)) {
        if (pool.includes(word)) return kind as MappingKind;
      }
    }
    return null;
  }

  private getIndex(pseudonym: string, kind: MappingKind): number {
    // New kind-prefixed format: ORG_ZORION → 1
    const prefix = KIND_PREFIXES[kind];
    if (pseudonym.startsWith(prefix)) {
      const word = pseudonym.slice(prefix.length).replace(/\d+$/, "");
      const suffix = pseudonym.slice(prefix.length + word.length);
      const cycle = suffix ? parseInt(suffix, 10) : 1;
      const pool = WORD_POOLS[kind];
      const wordIdx = pool.indexOf(word);
      if (wordIdx >= 0) {
        return wordIdx + 1 + (cycle - 1) * pool.length;
      }
    }

    // Legacy counter format: svc_01 → 1
    const counterMatch = pseudonym.match(/^(?:org|svc|tbl|col|idn|per|url|email|phone)_(\d+)$/);
    if (counterMatch) return parseInt(counterMatch[1], 10);

    // Legacy single-token format: XBRAVO → 2
    if (pseudonym.startsWith(LEGACY_PREFIX)) {
      const word = pseudonym.slice(LEGACY_PREFIX.length).replace(/\d+$/, "");
      const suffix = pseudonym.slice(LEGACY_PREFIX.length + word.length);
      const cycle = suffix ? parseInt(suffix, 10) : 1;
      const pool = WORD_POOLS[kind];
      const wordIdx = pool.indexOf(word);
      if (wordIdx >= 0) {
        return wordIdx + 1 + (cycle - 1) * pool.length;
      }
    }
    return 0;
  }
}

/**
 * Build a regex that matches any single-token pseudonym.
 * Used for deanonymization.
 */
export function buildSingleTokenPseudonymRegex(): RegExp {
  const allPatterns: string[] = [];
  for (const [kind, pool] of Object.entries(WORD_POOLS)) {
    const prefix = KIND_PREFIXES[kind as MappingKind];
    for (const word of pool) {
      // New format: ORG_ZORION, TBL_TOPAZ2, etc.
      allPatterns.push(prefix + word + "(?:\\d+)?");
      // Legacy format: XZORION, XTOPAZ2, etc.
      allPatterns.push(LEGACY_PREFIX + word + "(?:\\d+)?");
    }
  }
  // Sort by length DESC so longer matches take priority
  allPatterns.sort((a, b) => b.length - a.length);
  return new RegExp(`\\b(${allPatterns.join("|")})\\b`, "g");
}
