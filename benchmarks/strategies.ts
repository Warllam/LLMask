/**
 * Masking strategies for benchmark comparison.
 *
 * Each strategy defines what categories of entities get masked vs preserved,
 * simulating different approaches to the privacy-vs-quality tradeoff.
 */

export type MaskCategory =
  | "person_name"
  | "email"
  | "phone"
  | "address"
  | "national_id"
  | "iban"
  | "api_key"
  | "password"
  | "secret_token"
  | "ip_address"
  | "internal_url"
  | "internal_domain"
  | "org_name"
  | "variable_name"
  | "function_name"
  | "class_name"
  | "table_name"
  | "column_name"
  | "string_literal"
  | "numeric_literal"
  | "env_value";

export interface MaskingStrategy {
  id: string;
  name: string;
  description: string;
  /** Categories that WILL be masked */
  masked: Set<MaskCategory>;
  /** Categories that will be preserved (not masked) */
  preserved: Set<MaskCategory>;
  /** If true, apply lighter masking inside detected code blocks */
  codeBlockAware: boolean;
  /** For code-aware: categories masked even inside code blocks */
  codeBlockMasked?: Set<MaskCategory>;
}

const ALL_CATEGORIES: MaskCategory[] = [
  "person_name", "email", "phone", "address", "national_id", "iban",
  "api_key", "password", "secret_token", "ip_address", "internal_url",
  "internal_domain", "org_name", "variable_name", "function_name",
  "class_name", "table_name", "column_name", "string_literal",
  "numeric_literal", "env_value",
];

const PII_CATEGORIES: MaskCategory[] = [
  "person_name", "email", "phone", "address", "national_id", "iban",
];

const SECRET_CATEGORIES: MaskCategory[] = [
  "api_key", "password", "secret_token",
];

const CODE_IDENTIFIER_CATEGORIES: MaskCategory[] = [
  "variable_name", "function_name", "class_name", "table_name", "column_name",
];

const VALUE_CATEGORIES: MaskCategory[] = [
  ...PII_CATEGORIES, ...SECRET_CATEGORIES,
  "ip_address", "internal_url", "internal_domain", "org_name",
  "string_literal", "numeric_literal", "env_value",
  "table_name", "column_name",
];

function setOf<T>(...items: T[]): Set<T> {
  return new Set(items);
}

function complement(masked: MaskCategory[]): MaskCategory[] {
  const s = new Set(masked);
  return ALL_CATEGORIES.filter((c) => !s.has(c));
}

export const STRATEGIES: Record<string, MaskingStrategy> = {
  aggressive: {
    id: "aggressive",
    name: "Aggressive (Current LLMask)",
    description: "Masks everything — identifiers, values, names, IPs. Maximum privacy, minimum context.",
    masked: new Set(ALL_CATEGORIES),
    preserved: new Set<MaskCategory>(),
    codeBlockAware: false,
  },

  "values-only": {
    id: "values-only",
    name: "Values Only",
    description: "Masks data values (strings, IPs, keys, PII) but preserves variable/function/method names.",
    masked: new Set(VALUE_CATEGORIES),
    preserved: new Set(CODE_IDENTIFIER_CATEGORIES),
    codeBlockAware: false,
  },

  "pii-only": {
    id: "pii-only",
    name: "PII & Secrets Only",
    description: "Only masks actual PII and secrets. Leaves all code identifiers and non-sensitive values untouched.",
    masked: setOf<MaskCategory>(...PII_CATEGORIES, ...SECRET_CATEGORIES),
    preserved: new Set(complement([...PII_CATEGORIES, ...SECRET_CATEGORIES])),
    codeBlockAware: false,
  },

  "code-aware": {
    id: "code-aware",
    name: "Code-Aware",
    description: "Detects code blocks and applies lighter masking inside them. Full masking on natural language.",
    masked: new Set(ALL_CATEGORIES),
    preserved: new Set<MaskCategory>(),
    codeBlockAware: true,
    codeBlockMasked: setOf<MaskCategory>(...PII_CATEGORIES, ...SECRET_CATEGORIES, "ip_address", "internal_url", "env_value"),
  },
};

export const STRATEGY_IDS = Object.keys(STRATEGIES);

/**
 * Given a strategy, determine if a specific category should be masked
 * for content that is inside a code block vs natural language.
 */
export function shouldMask(
  strategy: MaskingStrategy,
  category: MaskCategory,
  insideCodeBlock: boolean,
): boolean {
  if (strategy.codeBlockAware && insideCodeBlock) {
    return strategy.codeBlockMasked?.has(category) ?? false;
  }
  return strategy.masked.has(category);
}
