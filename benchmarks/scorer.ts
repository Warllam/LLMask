/**
 * Scoring logic for benchmark results.
 *
 * Evaluates each masking strategy across four dimensions:
 *   - Privacy Score (0-100)
 *   - Semantic Preservation (0-100)
 *   - Response Quality (0-100)
 *   - Leakage Risk (0-100, lower = safer)
 */

import type { MaskingStrategy, MaskCategory } from "./strategies";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PromptSpec {
  id: string;
  name: string;
  category: string;
  description: string;
  prompt: string;
  sensitiveElements: string[];
  expectedResponseElements: string[];
  codeBlocks: boolean;
}

export interface MaskingResult {
  maskedPrompt: string;
  maskedCount: number;
  preservedCount: number;
  totalSensitive: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  tokensUsed: number;
  latencyMs: number;
}

export interface BenchmarkScore {
  strategyId: string;
  promptId: string;
  privacy: number;
  semanticPreservation: number;
  responseQuality: number;
  leakageRisk: number;
  details: ScoreDetails;
}

export interface ScoreDetails {
  sensitiveElementsMasked: string[];
  sensitiveElementsLeaked: string[];
  expectedElementsFound: string[];
  expectedElementsMissing: string[];
  codeStructurePreserved: boolean;
  maskingArtifacts: string[];
}

// ─── Privacy Scorer ─────────────────────────────────────────────────────────

/**
 * How much sensitive data is protected in the masked prompt?
 * 100 = all sensitive elements masked, 0 = nothing masked.
 */
export function scorePrivacy(
  spec: PromptSpec,
  maskResult: MaskingResult,
  maskedPrompt: string,
): { score: number; masked: string[]; leaked: string[] } {
  const masked: string[] = [];
  const leaked: string[] = [];

  for (const element of spec.sensitiveElements) {
    // Case-insensitive check: is the original sensitive value still present?
    if (maskedPrompt.toLowerCase().includes(element.toLowerCase())) {
      leaked.push(element);
    } else {
      masked.push(element);
    }
  }

  const total = spec.sensitiveElements.length;
  const score = total > 0 ? Math.round((masked.length / total) * 100) : 100;
  return { score, masked, leaked };
}

// ─── Semantic Preservation Scorer ───────────────────────────────────────────

/**
 * How much meaning/context is preserved for the LLM?
 * Measures:
 *  - Code structure integrity (brackets, keywords, indentation patterns)
 *  - Identifier consistency (same entity → same pseudonym)
 *  - Natural language coherence (sentences still make grammatical sense)
 */
export function scoreSemanticPreservation(
  spec: PromptSpec,
  originalPrompt: string,
  maskedPrompt: string,
): number {
  let score = 100;

  // 1. Code structure preservation (40 points)
  if (spec.codeBlocks) {
    const structureScore = scoreCodeStructure(originalPrompt, maskedPrompt);
    score -= (40 - structureScore * 0.4);
  }

  // 2. Identifier consistency (30 points)
  // Check that pseudonyms are used consistently (same fake name appears the same number of times)
  const consistencyScore = scoreIdentifierConsistency(maskedPrompt);
  score -= (30 - consistencyScore * 0.3);

  // 3. Overall information density (30 points)
  // Heavily masked text becomes repetitive pseudonyms — measure token diversity
  const diversityScore = scoreTokenDiversity(originalPrompt, maskedPrompt);
  score -= (30 - diversityScore * 0.3);

  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreCodeStructure(original: string, masked: string): number {
  let score = 100;

  // Check code fence preservation
  const origFences = (original.match(/```/g) || []).length;
  const maskedFences = (masked.match(/```/g) || []).length;
  if (origFences !== maskedFences) score -= 30;

  // Check bracket/brace balance preservation
  for (const ch of ["{", "}", "(", ")", "[", "]"]) {
    const origCount = (original.match(new RegExp(`\\${ch}`, "g")) || []).length;
    const maskedCount = (masked.match(new RegExp(`\\${ch}`, "g")) || []).length;
    if (origCount !== maskedCount) score -= 5;
  }

  // Check keyword preservation (language keywords shouldn't be masked)
  const keywords = [
    "function", "class", "const", "let", "var", "import", "export", "return",
    "if", "else", "for", "while", "def", "self", "async", "await",
    "SELECT", "FROM", "WHERE", "JOIN", "CREATE", "TABLE", "INSERT",
    "#set", "#if", "#end", "#foreach",
  ];
  for (const kw of keywords) {
    const origHas = original.includes(kw);
    const maskedHas = masked.includes(kw);
    if (origHas && !maskedHas) score -= 3;
  }

  return Math.max(0, score);
}

function scoreIdentifierConsistency(masked: string): number {
  // Look for pseudonym patterns (e.g., ORG_ALPHA, TBL_BRAVO, PER_CHARLIE)
  const pseudoPattern = /\b(?:ORG|TBL|PER|COL|SVC|URL|MAIL|TEL|ID|FN|CLS)_[A-Z]+\b/g;
  const matches = masked.match(pseudoPattern) || [];
  if (matches.length === 0) return 100; // No pseudonyms = either no masking or different format

  // Check that each unique pseudonym appears consistently
  const counts = new Map<string, number>();
  for (const m of matches) counts.set(m, (counts.get(m) || 0) + 1);

  // Good: pseudonyms used multiple times (consistency). Bad: all unique (random)
  const multiUse = [...counts.values()].filter((c) => c > 1).length;
  const total = counts.size;
  return total > 0 ? Math.round((multiUse / total) * 100) : 100;
}

function scoreTokenDiversity(original: string, masked: string): number {
  const origTokens = new Set(original.split(/\s+/));
  const maskedTokens = new Set(masked.split(/\s+/));

  // If masking reduced vocabulary significantly, semantic content was lost
  const ratio = maskedTokens.size / Math.max(origTokens.size, 1);
  return Math.round(Math.min(ratio, 1.0) * 100);
}

// ─── Response Quality Scorer ────────────────────────────────────────────────

/**
 * Compare LLM response quality between masked and unmasked.
 * Uses expected response elements as ground truth.
 */
export function scoreResponseQuality(
  spec: PromptSpec,
  response: string,
): { score: number; found: string[]; missing: string[] } {
  const found: string[] = [];
  const missing: string[] = [];
  const responseLower = response.toLowerCase();

  for (const element of spec.expectedResponseElements) {
    if (responseLower.includes(element.toLowerCase())) {
      found.push(element);
    } else {
      missing.push(element);
    }
  }

  const total = spec.expectedResponseElements.length;
  const score = total > 0 ? Math.round((found.length / total) * 100) : 100;
  return { score, found, missing };
}

// ─── Leakage Risk Scorer ────────────────────────────────────────────────────

/**
 * What sensitive info could leak in the LLM response?
 * Check if the LLM response contains any of the original sensitive elements.
 * Lower score = safer (less leakage).
 */
export function scoreLeakageRisk(
  spec: PromptSpec,
  maskedPrompt: string,
  llmResponse: string,
): number {
  // Things that leaked through masking AND appeared in response
  let leakedInResponse = 0;

  for (const element of spec.sensitiveElements) {
    const inMasked = maskedPrompt.toLowerCase().includes(element.toLowerCase());
    const inResponse = llmResponse.toLowerCase().includes(element.toLowerCase());

    // If it wasn't masked and the LLM echoed it back, that's leakage
    if (inMasked && inResponse) leakedInResponse++;
    // If it was masked but somehow appeared in response (hallucination of real data), also bad
    // This shouldn't happen with good masking, but check anyway
    if (!inMasked && inResponse) leakedInResponse += 2; // Extra penalty for magical leakage
  }

  const total = spec.sensitiveElements.length;
  return total > 0 ? Math.min(100, Math.round((leakedInResponse / total) * 100)) : 0;
}

// ─── Combined Scorer ────────────────────────────────────────────────────────

export function computeFullScore(
  spec: PromptSpec,
  maskedPrompt: string,
  maskResult: MaskingResult,
  llmResponse: string,
): BenchmarkScore {
  const privacy = scorePrivacy(spec, maskResult, maskedPrompt);
  const semantic = scoreSemanticPreservation(spec, spec.prompt, maskedPrompt);
  const quality = scoreResponseQuality(spec, llmResponse);
  const leakage = scoreLeakageRisk(spec, maskedPrompt, llmResponse);

  // Detect masking artifacts in response (pseudonyms that leaked into output)
  const artifactPattern = /\b(?:ORG|TBL|PER|COL|SVC|URL|MAIL|TEL|ID|FN|CLS)_[A-Z]+\b/g;
  const artifacts = llmResponse.match(artifactPattern) || [];

  return {
    strategyId: "", // filled by runner
    promptId: spec.id,
    privacy: privacy.score,
    semanticPreservation: semantic,
    responseQuality: quality.score,
    leakageRisk: leakage,
    details: {
      sensitiveElementsMasked: privacy.masked,
      sensitiveElementsLeaked: privacy.leaked,
      expectedElementsFound: quality.found,
      expectedElementsMissing: quality.missing,
      codeStructurePreserved: spec.codeBlocks
        ? scoreCodeStructure(spec.prompt, maskedPrompt) > 70
        : true,
      maskingArtifacts: [...new Set(artifacts)],
    },
  };
}

// ─── Baseline Score (no masking) ────────────────────────────────────────────

export function computeBaselineScore(
  spec: PromptSpec,
  llmResponse: string,
): BenchmarkScore {
  const quality = scoreResponseQuality(spec, llmResponse);
  return {
    strategyId: "baseline",
    promptId: spec.id,
    privacy: 0,
    semanticPreservation: 100,
    responseQuality: quality.score,
    leakageRisk: 100, // Everything leaks with no masking
    details: {
      sensitiveElementsMasked: [],
      sensitiveElementsLeaked: spec.sensitiveElements,
      expectedElementsFound: quality.found,
      expectedElementsMissing: quality.missing,
      codeStructurePreserved: true,
      maskingArtifacts: [],
    },
  };
}
