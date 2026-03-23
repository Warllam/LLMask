import type { MappingKind } from "../mapping-store/mapping-store";
import type { EntityCache } from "./entity-cache";

export type ExtractedEntity = {
  name: string;
  kind: MappingKind;
  reason: string;
};

export type ExtractionResult = {
  entities: ExtractedEntity[];
  fromCache: boolean;
  durationMs: number;
};

type LlmExtractorConfig = {
  ollamaBaseUrl: string;
  model: string;
  timeoutMs: number;
  enabled: boolean;
};

const EXTRACTION_PROMPT = `List ALL business-specific identifiers in this code/text as JSON.
Return {"entities": [{"name": "...", "kind": "svc|tbl|col|org|idn", "reason": "..."}]}.

Include ALL of these types:
- svc: class/service names specific to the business (PaymentService, ReconciliationEngine, FraudChecker)
- tbl: database table names (merchant_accounts, invoices, user_profiles)
- col: database column names (kyc_status, onboarding_tier, risk_score)
- org: organization/team/project names (AcmeFintech, TeamAlpha, ProjectPhoenix)
- idn: other business-specific identifiers (processInvoice, merchantId, calculateRiskScore)

Be thorough: include class names, method names, property names, and variables that are domain-specific.

Do NOT include: language keywords, imported third-party names (StripeClient from "stripe", Logger from "winston"), generic variables (data, result, value, item, account), SQL keywords, common technical terms.

If no business identifiers, return {"entities": []}.

Text:
`;

const SEMANTIC_PSEUDONYM_PROMPT = `For each identifier below, generate a fictional replacement that:
- Preserves the semantic category (animal → another animal, city → another city, etc.)
- Is a single word, simple, easy to read
- Does NOT reveal or resemble the original
- Must be different from all other replacements

Return a JSON object mapping each original name to its replacement.
Example input: [{"name":"KOALA","kind":"org"},{"name":"Invoice","kind":"svc"}]
Example output: {"KOALA":"PANDA","Invoice":"Receipt"}

Input: `;

export class LlmEntityExtractor {
  private readonly config: LlmExtractorConfig;
  private readonly cache: EntityCache | null;

  constructor(config: LlmExtractorConfig, cache?: EntityCache) {
    this.config = config;
    this.cache = cache ?? null;
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  async extract(text: string): Promise<ExtractionResult> {
    if (!this.config.enabled) {
      return { entities: [], fromCache: false, durationMs: 0 };
    }

    // Check cache first
    if (this.cache) {
      const cached = this.cache.get(text);
      if (cached) {
        return { entities: cached, fromCache: true, durationMs: 0 };
      }
    }

    const start = Date.now();
    try {
      const entities = await this.callOllama(text);
      const durationMs = Date.now() - start;

      // Cache the result
      if (this.cache) {
        this.cache.set(text, entities);
      }

      return { entities, fromCache: false, durationMs };
    } catch (error) {
      const durationMs = Date.now() - start;
      // Fail open: if LLM is unavailable, return empty (regex fallback will still work)
      return { entities: [], fromCache: false, durationMs };
    }
  }

  private async callOllama(text: string): Promise<ExtractedEntity[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.config.ollamaBaseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          prompt: EXTRACTION_PROMPT + text,
          stream: false,
          options: {
            temperature: 0,
            num_predict: 2048
          },
          format: "json"
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}: ${await response.text()}`);
      }

      const result = (await response.json()) as { response: string };
      return this.parseResponse(result.response);
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseResponse(raw: string): ExtractedEntity[] {
    try {
      const parsed = JSON.parse(raw);

      // Handle both { entities: [...] } and direct array formats
      const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.entities) ? parsed.entities : []);

      const validKinds = new Set<MappingKind>(["org", "svc", "tbl", "col", "idn"]);

      return arr
        .filter(
          (e: unknown): e is { name: string; kind: string; reason: string } =>
            typeof e === "object" &&
            e !== null &&
            typeof (e as any).name === "string" &&
            typeof (e as any).kind === "string" &&
            (e as any).name.length >= 2
        )
        .map((e: { name: string; kind: string; reason: string }) => ({
          name: e.name,
          kind: validKinds.has(e.kind as MappingKind) ? (e.kind as MappingKind) : "idn",
          reason: typeof e.reason === "string" ? e.reason : ""
        }));
    } catch {
      return [];
    }
  }

  /**
   * Generate semantic pseudonyms for sensitive identifier parts via Ollama.
   * E.g. "KOALA" → "PANDA", "Invoice" → "Receipt"
   * Returns a Map of original → semantic pseudonym.
   * Fail-open: returns empty map if Ollama is unavailable.
   */
  async generateSemanticPseudonyms(
    entities: Array<{ name: string; kind: string }>
  ): Promise<Map<string, string>> {
    if (!this.config.enabled || entities.length === 0) {
      return new Map();
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        const prompt = SEMANTIC_PSEUDONYM_PROMPT + JSON.stringify(entities);
        const response = await fetch(`${this.config.ollamaBaseUrl}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: this.config.model,
            prompt,
            stream: false,
            options: { temperature: 0.7, num_predict: 1024 },
            format: "json",
          }),
          signal: controller.signal,
        });

        if (!response.ok) return new Map();

        const result = (await response.json()) as { response: string };
        return this.parseSemanticResponse(result.response);
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      return new Map();
    }
  }

  private parseSemanticResponse(raw: string): Map<string, string> {
    try {
      const parsed = JSON.parse(raw);
      const result = new Map<string, string>();

      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === "string" && value.length >= 2 && value !== key) {
            result.set(key, value);
          }
        }
      }

      return result;
    } catch {
      return new Map();
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${this.config.ollamaBaseUrl}/api/tags`, {
        signal: controller.signal
      });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }
}
