import type { ChatCompletionsRequest } from "../../contracts/openai";
import type { MappingKind, MappingStore } from "../mapping-store/mapping-store";
import type { DetectionResult } from "../detection/detection-engine";
import type { AstClassification } from "../ast/ast-classifier";
import type { ExtractedEntity, LlmEntityExtractor } from "../llm-extractor/llm-entity-extractor";
import type { ProjectShield } from "../project-shield/project-shield";
import { NerDetectorV4 } from "../ner-detector/ner-detector-v4";
import { SingleTokenPseudonymGenerator } from "./single-token-pseudonyms";
import { extractTextFromContent, rewriteContentBlocks } from "../../shared/content-utils";
import { detectPii, extractDomains, type PiiMatch } from "../detection/pii-patterns";
import { isGenericWord } from "./generic-words";

export type RewriteResult = {
  rewrittenRequest: ChatCompletionsRequest;
  transformedCount: number;
};

export type GenericRewriteResult = {
  rewrittenPayload: unknown;
  transformedCount: number;
  newEntries?: Array<{ kind: string; originalValue: string; pseudonym: string }>;
};

type RewriteContext = {
  scopeId: string;
};

export type RewriteOptions = {
  dryRun?: boolean;
  excludeOriginals?: Set<string>;
  /** Ollama-generated semantic pseudonyms (e.g. "KOALA" → "PANDA") */
  semanticPseudonyms?: Map<string, string>;
};

/**
 * RewriteEngineV4 — Best of V3 (0 FP) + fixed recall.
 *
 * **Architecture Overview:**
 * - Detection: NER (AST + SQL + heuristics) + PII patterns (names, emails, phones, etc.)
 * - Rewrite: Deterministic pseudonymization with consistent mapping per scope
 * - Reversible: All mappings stored in MappingStore for inverse remap (response → original)
 *
 * **Pseudonym Consistency:**
 * - Same entity → same pseudonym (via originalToPseudo Map)
 * - Prefix-based types: ORG_ZORION, TBL_TOPAZ, PER_LENOX, COL_*, ID_*, SVC_*, URL_*, MAIL_*, TEL_*
 * - Compound splitting: KOALA_VARIABLES → ORG_ZORION_VARIABLES (preserves structure)
 *
 * **Inverse Remap:**
 * - MappingStore.listMappings(scopeId) → original/pseudonym pairs
 * - Response pseudonyms → restore originals via reverse lookup
 * - Ensures round-trip consistency (request → LLM → response → user)
 *
 * Fixes:
 * 1. CREATE TABLE column parsing → catches combat_id, date_combat
 * 2. SQL alias parsing → catches total_victoires
 * 3. Fixed import filtering → catches MembreForce, MissionForce
 * 4. Full INSERT column list parsing
 */
export class RewriteEngineV4 {
  private readonly nerDetector = new NerDetectorV4();
  private projectShield: ProjectShield | null = null;

  constructor(private readonly mappingStore: MappingStore) {}

  setProjectShield(shield: ProjectShield): void {
    this.projectShield = shield;
  }

  /**
   * Pre-generate semantic pseudonyms for compound identifier parts via Ollama.
   * Call this before rewriteRequest/rewriteUnknownPayload and pass the result
   * via RewriteOptions.semanticPseudonyms.
   *
   * Fail-open: returns empty map if Ollama is unavailable or errors.
   */
  async prepareSemanticPseudonyms(
    text: string,
    llmExtractor: LlmEntityExtractor,
    astHints?: Map<string, AstClassification>,
    llmEntities?: ExtractedEntity[]
  ): Promise<Map<string, string>> {
    if (!llmExtractor.enabled) return new Map();

    // Run NER to find entities
    const nerResult = this.nerDetector.detect(text, astHints);

    if (llmEntities) {
      for (const entity of llmEntities) {
        if (!nerResult.entityNames.has(entity.name)) {
          nerResult.entityNames.add(entity.name);
          nerResult.entityKinds.set(entity.name, entity.kind);
        }
      }
    }

    // Collect sensitive parts from compound identifiers
    const sensitiveParts: Array<{ name: string; kind: string }> = [];
    const seen = new Set<string>();

    for (const entityName of nerResult.entityNames) {
      const format = detectFormat(entityName);
      const kind = nerResult.entityKinds.get(entityName) ?? "idn";

      // Only split snake_case/UPPER_SNAKE (matches rewriteCompoundIdentifier behavior)
      if (format === "snake_case" || format === "UPPER_SNAKE") {
        const parts = splitIdentifier(entityName, format);
        for (const part of parts) {
          if (!isGenericWord(part) && !seen.has(part)) {
            seen.add(part);
            sensitiveParts.push({ name: part, kind });
          }
        }
      } else {
        // Simple or camelCase/PascalCase — include the whole identifier
        if (!seen.has(entityName)) {
          seen.add(entityName);
          sensitiveParts.push({ name: entityName, kind });
        }
      }
    }

    if (sensitiveParts.length === 0) return new Map();

    return llmExtractor.generateSemanticPseudonyms(sensitiveParts);
  }

  rewriteRequest(
    payload: ChatCompletionsRequest,
    _detection: DetectionResult,
    context: RewriteContext,
    astHints?: Map<string, AstClassification>,
    llmEntities?: ExtractedEntity[],
    options?: RewriteOptions
  ): RewriteResult {
    const rewrittenRequest = structuredClone(payload);

    // Collect original (pre-shield) text for NER + auto-enrichment
    const originalMessageText = rewrittenRequest.messages
      .filter((m) => m.content !== undefined && m.role !== "system" && m.role !== "developer")
      .map((m) => extractTextFromContent(m.content))
      .filter(Boolean)
      .join("\n");

    // Run NER on original text (before shield) so entity detection isn't skewed
    const nerResult = this.nerDetector.detect(originalMessageText, astHints);

    if (llmEntities && llmEntities.length > 0) {
      for (const entity of llmEntities) {
        if (!nerResult.entityNames.has(entity.name)) {
          nerResult.entityNames.add(entity.name);
          nerResult.entityKinds.set(entity.name, entity.kind);
        }
      }
    }

    // Auto-enrich shield BEFORE applying it — so new terms get masked in the same pass
    if (this.projectShield) {
      // Entity prefix cascade FIRST (substring match, no word boundaries)
      // so "Brevo" matches inside "BrevoContactAdapter"
      autoShieldFromEntityPrefixes(nerResult.entityNames, this.projectShield);
      // Then import/package namespace detection (word boundary match)
      autoShieldFromImports(originalMessageText, this.projectShield);
    }

    // Step 0: Apply project shield (mask project/product/client names) on ALL messages
    if (this.projectShield?.enabled) {
      rewrittenRequest.messages = rewrittenRequest.messages.map((message) => {
        if (message.content === undefined || message.content === null) return message;
        const shielded = rewriteContentBlocks(message.content, (text) => this.projectShield!.apply(text));
        return { ...message, content: shielded as typeof message.content };
      });
    }

    const existing = this.mappingStore.listMappings(context.scopeId);
    const originalToPseudo = new Map(existing.map((entry) => [entry.originalValue, entry.pseudonym]));
    const pseudoGen = new SingleTokenPseudonymGenerator();
    pseudoGen.initFromExisting(existing);
    const newEntries: Array<{ kind: MappingKind; originalValue: string; pseudonym: string }> = [];
    let transformedCount = 0;

    // Auto-enrich shield with detected domains (during rewrite)
    let domainCounter = 0;
    const shieldEnrich = this.projectShield
      ? (baseDomain: string, fullDomain: string) => {
          const shield = this.projectShield!;
          if (shield.addReplacement(fullDomain, `internal-${++domainCounter}.local`)) {
            if (baseDomain !== fullDomain) {
              shield.addReplacement(baseDomain, `domain-${domainCounter}.local`);
            }
          }
        }
      : undefined;

    const rewriteState: RewriteState = {
      originalToPseudo,
      pseudoGen,
      newEntries,
      transformedCount: { value: 0 },
      nerResult,
      shieldEnrich,
      semanticPseudonyms: options?.semanticPseudonyms,
    };

    rewrittenRequest.messages = rewrittenRequest.messages.map((message) => {
      if (message.content === undefined || message.content === null) return message;
      if (message.role === "system" || message.role === "developer") return message;

      const rewritten = rewriteContentBlocks(message.content, (text) => rewriteString(text, rewriteState));
      return { ...message, content: rewritten as typeof message.content };
    });
    transformedCount = rewriteState.transformedCount.value;

    if (transformedCount > 0) {
      rewrittenRequest.messages.unshift({
        role: "developer",
        content: ANONYMISATION_HINT
      });
    }

    this.mappingStore.upsertMappings(context.scopeId, newEntries);

    return { rewrittenRequest, transformedCount };
  }

  rewriteUnknownPayload(
    payload: unknown,
    _detection: DetectionResult,
    context: RewriteContext,
    astHints?: Map<string, AstClassification>,
    llmEntities?: ExtractedEntity[],
    options?: RewriteOptions
  ): GenericRewriteResult {
    // Step 0: Apply project shield on the raw payload
    let shieldedPayload = payload;
    if (this.projectShield?.enabled) {
      shieldedPayload = deepApplyShield(payload, this.projectShield);
    }

    const existing = this.mappingStore.listMappings(context.scopeId);
    const originalToPseudo = new Map(existing.map((entry) => [entry.originalValue, entry.pseudonym]));
    const pseudoGen = new SingleTokenPseudonymGenerator();
    pseudoGen.initFromExisting(existing);
    const newEntries: Array<{ kind: MappingKind; originalValue: string; pseudonym: string }> = [];
    let transformedCount = 0;

    const payloadText = collectPayloadText(shieldedPayload);
    const nerResult = this.nerDetector.detect(payloadText, astHints);

    if (llmEntities && llmEntities.length > 0) {
      for (const entity of llmEntities) {
        if (!nerResult.entityNames.has(entity.name)) {
          nerResult.entityNames.add(entity.name);
          nerResult.entityKinds.set(entity.name, entity.kind);
        }
      }
    }

    // Auto-enrich shield with detected domains
    let domainCounter = 0;
    const shieldEnrich = this.projectShield
      ? (baseDomain: string, fullDomain: string) => {
          const shield = this.projectShield!;
          if (shield.addReplacement(fullDomain, `internal-${++domainCounter}.local`)) {
            // Also mask the base domain if different
            if (baseDomain !== fullDomain) {
              shield.addReplacement(baseDomain, `domain-${domainCounter}.local`);
            }
          }
        }
      : undefined;

    const state: RewriteState = {
      originalToPseudo,
      pseudoGen,
      newEntries,
      transformedCount: { value: 0 },
      nerResult,
      shieldEnrich,
      excludeOriginals: options?.excludeOriginals,
      semanticPseudonyms: options?.semanticPseudonyms,
    };

    const rewrittenPayload = deepRewrite(shieldedPayload, state);
    transformedCount = state.transformedCount.value;

    if (
      transformedCount > 0 &&
      rewrittenPayload &&
      typeof rewrittenPayload === "object" &&
      "input" in rewrittenPayload &&
      Array.isArray((rewrittenPayload as Record<string, unknown>).input)
    ) {
      const rp = rewrittenPayload as Record<string, unknown>;
      const input = rp.input as unknown[];
      input.unshift({
        type: "message",
        role: "developer",
        content: [{
          type: "input_text",
          text: ANONYMISATION_HINT
        }]
      });
    }

    if (!options?.dryRun) {
      this.mappingStore.upsertMappings(context.scopeId, newEntries);
    }

    return { rewrittenPayload, transformedCount, newEntries };
  }
}

// ── Hint ────────────────────────────────────────────────────────────────────

const ANONYMISATION_HINT =
  "CONTEXT — Semantic anonymisation is active.\n" +
  "Identifiers have been replaced with typed pseudonyms: " +
  "ORG_* (organisations), SVC_* (services), TBL_* (tables), COL_* (columns), " +
  "ID_* (identifiers), PER_* (persons), URL_* (URLs), MAIL_* (emails), TEL_* (phones).\n" +
  "Example: ORG_ZORION, TBL_TOPAZ, PER_LENOX.\n\n" +
  "RULES:\n" +
  "1. Treat pseudonyms as the real names — do NOT guess original names.\n" +
  "2. ALWAYS use exact pseudonym tokens in your response.\n" +
  "3. Do NOT comment on or mention the anonymisation.\n" +
  "4. Your response will be post-processed to restore original names.\n" +
  "5. Preserve pseudonym tokens exactly; do NOT rename them.";

// ── Skip keys ───────────────────────────────────────────────────────────────

const SKIP_KEY_REWRITE = new Set([
  "model", "role", "id", "type", "name", "status", "object",
  "call_id", "item_id", "event", "phase", "action", "tool",
  "format", "encoding", "method", "param", "code",
  "encrypted_content", "summary", "instructions", "description",
  "previous_response_id", "response_id",
  "tool_choice", "truncation", "include",
  "reasoning_effort", "effort",
]);

// ── Deep rewrite ────────────────────────────────────────────────────────────

type RewriteState = {
  originalToPseudo: Map<string, string>;
  pseudoGen: SingleTokenPseudonymGenerator;
  newEntries: Array<{ kind: MappingKind; originalValue: string; pseudonym: string }>;
  transformedCount: { value: number };
  nerResult: { entityNames: Set<string>; entityKinds: Map<string, MappingKind> };
  shieldEnrich?: (baseDomain: string, fullDomain: string) => void;
  excludeOriginals?: Set<string>;
  /** Ollama-generated semantic pseudonyms (e.g. "KOALA" → "PANDA") */
  semanticPseudonyms?: Map<string, string>;
};

function deepRewrite(value: unknown, state: RewriteState, parentKey?: string): unknown {
  if (typeof value === "string") {
    if (parentKey && (SKIP_KEY_REWRITE.has(parentKey) || parentKey.endsWith("_id") || parentKey.endsWith("_ids"))) {
      return value;
    }
    return rewriteString(value, state);
  }

  if (Array.isArray(value)) {
    return value.map((item) => deepRewrite(item, state));
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;

    if (
      (obj.role === "system" || obj.role === "developer") &&
      (obj.type === "message" || obj.type === undefined || obj.content !== undefined)
    ) {
      return obj;
    }

    if (obj.type === "function_call" || obj.type === "reasoning") return obj;
    if (obj.role === "assistant" && (obj.type === "message" || obj.type === undefined || obj.content !== undefined)) {
      return obj;
    }

    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(obj)) {
      if (key === "tools" || key === "tool_choice" || key === "reasoning") {
        out[key] = child;
      } else {
        out[key] = deepRewrite(child, state, key);
      }
    }
    return out;
  }

  return value;
}

function replacePiiMatches(input: string, state: RewriteState): string {
  const piiMatches = detectPii(input);
  if (piiMatches.length === 0) return input;

  // Auto-enrich project shield with detected domains
  if (state.shieldEnrich) {
    const urls = piiMatches.filter((m) => m.kind === "url").map((m) => m.value);
    if (urls.length > 0) {
      const domains = extractDomains(urls);
      for (const { domain, fullDomain } of domains) {
        state.shieldEnrich(domain, fullDomain);
      }
    }
  }

  // Sort by length descending to replace longest matches first
  const sorted = [...piiMatches].sort((a, b) => b.value.length - a.value.length);
  let result = input;

  for (const match of sorted) {
    if (state.excludeOriginals?.has(match.value)) continue;

    const existing = state.originalToPseudo.get(match.value);
    if (existing) {
      result = result.split(match.value).join(existing);
      state.transformedCount.value += 1;
      continue;
    }

    const pseudonym = state.pseudoGen.generate(match.kind);
    state.originalToPseudo.set(match.value, pseudonym);
    state.newEntries.push({ kind: match.kind, originalValue: match.value, pseudonym });
    result = result.split(match.value).join(pseudonym);
    state.transformedCount.value += 1;
  }

  return result;
}

// ── Compound identifier splitting ────────────────────────────────────────

type IdentifierFormat = "snake_case" | "UPPER_SNAKE" | "camelCase" | "PascalCase" | "single";

function detectFormat(token: string): IdentifierFormat {
  if (token.includes("_")) {
    return token === token.toUpperCase() ? "UPPER_SNAKE" : "snake_case";
  }
  if (/^[a-z]/.test(token) && /[A-Z]/.test(token)) return "camelCase";
  if (/^[A-Z][a-z]/.test(token) && /[A-Z]/.test(token.slice(1))) return "PascalCase";
  return "single";
}

function splitIdentifier(token: string, format: IdentifierFormat): string[] {
  if (format === "snake_case" || format === "UPPER_SNAKE") {
    return token.split("_");
  }
  // camelCase / PascalCase: split on case transitions
  // "getUserById" → ["get", "User", "By", "Id"]
  // "InvoiceService" → ["Invoice", "Service"]
  return token.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/).filter(Boolean);
}

function reconstructIdentifier(parts: string[], format: IdentifierFormat, originalParts: string[]): string {
  if (format === "UPPER_SNAKE") {
    return parts.map((p) => p.toUpperCase()).join("_");
  }
  if (format === "snake_case") {
    return parts.map((p, i) => {
      // Preserve original casing pattern for each part
      const orig = originalParts[i];
      if (orig && orig === orig.toLowerCase()) return p.toLowerCase();
      if (orig && orig === orig.toUpperCase()) return p.toUpperCase();
      return p;
    }).join("_");
  }
  if (format === "camelCase") {
    return parts.map((p, i) => {
      if (i === 0) {
        // First part stays lowercase
        return p.charAt(0).toLowerCase() + p.slice(1);
      }
      return p.charAt(0).toUpperCase() + p.slice(1);
    }).join("");
  }
  // PascalCase
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
}

/**
 * Pseudonymize a single sensitive part of a compound identifier.
 * 
 * **Consistency Guarantee:**
 * - Reuses existing mappings: "KOALA" → same pseudonym everywhere in the scope
 * - Case-insensitive matching: KOALA, Koala, koala all map to same pseudonym
 * - Stores mappings in MappingStore for inverse remap (response → original)
 * 
 * **Precedence:**
 * 1. Existing mapping (from MappingStore or earlier in this session)
 * 2. Semantic pseudonyms (Ollama-generated, e.g. "KOALA" → "PANDA")
 * 3. Generated typed pseudonym (ORG_ZORION, TBL_TOPAZ, etc.)
 * 
 * @param part - The identifier part to pseudonymize (e.g. "KOALA" from "KOALA_VARIABLES")
 * @param state - Rewrite state containing mappings and pseudonym generator
 * @returns Pseudonym for this part (consistent across all occurrences)
 */
function pseudonymizePart(part: string, state: RewriteState): string {
  // Normalize: use the original casing for lookup (KOALA, Koala, koala all map to same)
  const normalized = part.toUpperCase();

  // Check if we already have a mapping for this part (any casing)
  const existing = state.originalToPseudo.get(part) ?? state.originalToPseudo.get(normalized);
  if (existing) {
    state.transformedCount.value += 1;
    return existing;
  }

  // Check semantic pseudonyms (Ollama-generated)
  if (state.semanticPseudonyms) {
    const semantic = state.semanticPseudonyms.get(part) ?? state.semanticPseudonyms.get(normalized);
    if (semantic) {
      // Store this mapping for reuse and for remap
      state.originalToPseudo.set(part, semantic);
      const kind = state.nerResult.entityKinds.get(part) ?? guessPartKind(part, state);
      state.newEntries.push({ kind, originalValue: part, pseudonym: semantic });
      state.transformedCount.value += 1;
      return semantic;
    }
  }

  // Generate a typed pseudonym
  const kind = state.nerResult.entityKinds.get(part) ?? guessPartKind(part, state);
  const pseudonym = state.pseudoGen.generate(kind);
  state.originalToPseudo.set(part, pseudonym);
  state.newEntries.push({ kind, originalValue: part, pseudonym });
  state.transformedCount.value += 1;
  return pseudonym;
}

/**
 * Guess the kind of a part based on the whole token's kind.
 */
function guessPartKind(part: string, state: RewriteState): MappingKind {
  // Look up the parent token's kind from NER results
  for (const [token, kind] of state.nerResult.entityKinds) {
    if (token.toUpperCase().includes(part.toUpperCase())) return kind;
  }
  return "idn";
}

/**
 * Try compound splitting on a token detected by NER.
 * Returns the rewritten token with only sensitive parts pseudonymized,
 * or null if the token is single-word / all-generic / all-sensitive.
 *
 * Only applies to snake_case / UPPER_SNAKE identifiers (e.g. KOALA_VARIABLES).
 * CamelCase/PascalCase identifiers fall back to whole-token replacement because
 * prefixed pseudonyms (ORG_ZORION) don't compose well without separators.
 */
function rewriteCompoundIdentifier(token: string, state: RewriteState): string | null {
  const format = detectFormat(token);
  // Only split snake_case / UPPER_SNAKE — prefix-based pseudonyms break camelCase/PascalCase
  if (format !== "snake_case" && format !== "UPPER_SNAKE") return null;

  const parts = splitIdentifier(token, format);
  if (parts.length <= 1) return null; // Nothing to split

  // Classify each part
  const rewritten: string[] = [];
  let anyChanged = false;
  let allGeneric = true;

  for (const part of parts) {
    if (state.excludeOriginals?.has(part)) {
      rewritten.push(part);
      continue;
    }

    if (isGenericWord(part)) {
      rewritten.push(part);
    } else {
      allGeneric = false;
      const pseudo = pseudonymizePart(part, state);
      rewritten.push(pseudo);
      anyChanged = true;
    }
  }

  if (!anyChanged) return null; // All parts were generic — no pseudonymization needed
  if (allGeneric) return null;

  return reconstructIdentifier(rewritten, format, parts);
}

function rewriteString(input: string, state: RewriteState): string {
  // Phase 1: Replace PII (names, emails, URLs, phones) — multi-word/special chars
  let text = replacePiiMatches(input, state);

  // Phase 2: Replace code identifiers (single-token, word-boundary)
  const identifierRegex = /\b[A-Za-z_][A-Za-z0-9_]{3,}\b/g;

  text = text.replace(identifierRegex, (token) => {
    if (!state.nerResult.entityNames.has(token)) return token;
    if (state.excludeOriginals?.has(token)) return token;

    // Try compound splitting first (e.g. KOALA_VARIABLES → ORG_ZORION_VARIABLES)
    const compound = rewriteCompoundIdentifier(token, state);
    if (compound) return compound;

    // Fallback: whole-token replacement (for simple identifiers)
    const existingPseudonym = state.originalToPseudo.get(token);
    if (existingPseudonym) {
      state.transformedCount.value += 1;
      return existingPseudonym;
    }

    const kind = state.nerResult.entityKinds.get(token) ?? "idn";
    const pseudonym = state.pseudoGen.generate(kind);

    state.originalToPseudo.set(token, pseudonym);
    state.newEntries.push({ kind, originalValue: token, pseudonym });
    state.transformedCount.value += 1;
    return pseudonym;
  });

  return text;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function deepApplyShield(value: unknown, shield: ProjectShield): unknown {
  if (typeof value === "string") return shield.apply(value);
  if (Array.isArray(value)) return value.map((item) => deepApplyShield(item, shield));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepApplyShield(v, shield);
    }
    return out;
  }
  return value;
}

function collectPayloadText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(collectPayloadText).join("\n");
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).map(collectPayloadText).join("\n");
  }
  return "";
}

// ---------------------------------------------------------------------------
// Auto-shield: extract company namespaces from import/package statements
// ---------------------------------------------------------------------------

/** Well-known standard/public Java root packages to ignore (includes country TLDs used as package roots) */
const JAVA_STD_ROOTS = new Set([
  "java", "javax", "jakarta", "org", "com", "net", "io", "lombok",
  "sun", "jdk", "android", "kotlin", "scala", "groovy", "clojure",
  // Country TLDs used as Java package roots (fr.company.*, de.company.*, etc.)
  "fr", "de", "uk", "nl", "be", "ch", "it", "es", "pt", "pl", "at", "se",
  "no", "dk", "fi", "cz", "hu", "ro", "bg", "hr", "sk", "si", "lt", "lv",
  "ee", "ie", "lu", "gr", "cy", "mt", "us", "ca", "br", "ar", "mx", "cl",
  "co", "pe", "au", "nz", "jp", "cn", "kr", "in", "sg", "hk", "tw", "za",
  "ru", "ua", "tr",
]);

/** Well-known public Java org-level packages to ignore */
const JAVA_PUBLIC_ORGS = new Set([
  "apache", "springframework", "spring", "google", "fasterxml", "jackson",
  "junit", "mockito", "slf4j", "log4j", "jooq", "hibernate", "jboss",
  "eclipse", "jetbrains", "intellij", "gradle", "maven", "aws", "azure",
  "github", "gitlab", "openai", "anthropic", "reactivestreams", "reactor",
]);

/** Well-known JS/TS public package scopes & prefixes to ignore */
const JS_PUBLIC_SCOPES = new Set([
  "react", "vue", "angular", "next", "nuxt", "svelte", "express", "fastify",
  "node", "types", "babel", "eslint", "prettier", "vitest", "jest", "webpack",
  "vite", "rollup", "typescript", "lodash", "axios", "zod", "prisma",
]);

let shieldNameCounter = 0;

function autoShieldFromImports(text: string, shield: ProjectShield): void {
  // Java: import fr.irun.j8.core.domain.model.Foo;
  // → extract "irun" (2nd segment after country code like fr/com/de/uk/...)
  const javaImportRe = /import\s+(?:static\s+)?([\w.]+)\s*;/g;
  const javaPackageRe = /package\s+([\w.]+)\s*;/g;

  const seen = new Set<string>();

  for (const re of [javaImportRe, javaPackageRe]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const parts = m[1].split(".");
      if (parts.length < 3) continue;

      if (JAVA_STD_ROOTS.has(parts[0])) {
        // For "org.jooq.*", "com.google.*" etc — check 2nd part is public
        if (JAVA_PUBLIC_ORGS.has(parts[1])) continue;

        // For "fr.irun.*", "com.mycompany.*" — TLD/country prefix, company is parts[1]
        const candidate = parts[1];
        if (candidate.length >= 3 && !JAVA_PUBLIC_ORGS.has(candidate) && !seen.has(candidate)) {
          seen.add(candidate);
          const code = `corp${++shieldNameCounter}`;
          shield.addReplacement(candidate, code);
          const pascal = candidate.charAt(0).toUpperCase() + candidate.slice(1);
          shield.addReplacement(pascal, code.charAt(0).toUpperCase() + code.slice(1));
        }
      } else {
        // Unknown root package (e.g. "brevo.ApiClient") — likely a private/vendor library
        const candidate = parts[0];
        if (candidate.length >= 3 && !JAVA_PUBLIC_ORGS.has(candidate) && !seen.has(candidate)) {
          seen.add(candidate);
          const code = `vendor${++shieldNameCounter}`;
          shield.addReplacement(candidate, code);
          const pascal = candidate.charAt(0).toUpperCase() + candidate.slice(1);
          shield.addReplacement(pascal, code.charAt(0).toUpperCase() + code.slice(1));
        }
      }
    }
  }

  // JS/TS: import { Foo } from '@mycompany/bar' or from 'mycompany-sdk'
  const jsImportRe = /from\s+['"](@?[\w\-./]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = jsImportRe.exec(text)) !== null) {
    const source = m[1];
    if (source.startsWith(".") || source.startsWith("/")) continue; // relative

    if (source.startsWith("@")) {
      const scope = source.slice(1).split("/")[0];
      if (scope.length >= 3 && !JS_PUBLIC_SCOPES.has(scope) && !seen.has(scope)) {
        seen.add(scope);
        shield.addReplacement(scope, `pkgscope${++shieldNameCounter}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Auto-shield: detect common prefixes in NER-detected entity names
// ---------------------------------------------------------------------------

/** Minimum entities sharing a prefix to trigger auto-shielding */
const MIN_PREFIX_COUNT = 2;
/** Minimum prefix length */
const MIN_PREFIX_LEN = 4;

function autoShieldFromEntityPrefixes(entityNames: Set<string>, shield: ProjectShield): void {
  // Extract PascalCase prefixes: BrevoContactPort, BrevoApiPort → "Brevo"
  const prefixCounts = new Map<string, number>();

  for (const name of entityNames) {
    // Split PascalCase: BrevoContactPort → ["Brevo", "Contact", "Port"]
    const camelParts = name.match(/[A-Z][a-z]+/g);
    if (!camelParts || camelParts.length < 2) continue;

    const prefix = camelParts[0];
    if (prefix.length < MIN_PREFIX_LEN) continue;
    if (isGenericWord(prefix.toLowerCase())) continue;

    prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
  }

  for (const [prefix, count] of prefixCounts) {
    if (count >= MIN_PREFIX_COUNT) {
      const code = `Xsvc${++shieldNameCounter}`;
      // Use substring replacement so "Brevo" matches inside "BrevoContactAdapter"
      shield.addSubstringReplacement(prefix, code);
      shield.addSubstringReplacement(prefix.toLowerCase(), code.toLowerCase());
      shield.addSubstringReplacement(prefix.toUpperCase(), code.toUpperCase());
    }
  }
}
