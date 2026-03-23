import { Transform } from "node:stream";
import type { FastifyBaseLogger } from "fastify";
import type { MappingStore } from "../mapping-store/mapping-store";
import type { ProjectShield } from "../project-shield/project-shield";
import { recordRemap } from "../../shared/metrics";

export type CapturingTransform = Transform & { getCapturedText(): string };

export class ResponseRemapEngine {
  private logger: FastifyBaseLogger | null = null;
  private projectShield: ProjectShield | null = null;

  constructor(private readonly mappingStore: MappingStore) {}

  setLogger(logger: FastifyBaseLogger): void {
    this.logger = logger;
  }

  setProjectShield(shield: ProjectShield): void {
    this.projectShield = shield;
  }

  remapJsonResponse(payload: unknown, scopeId: string, preloadedMappings?: import("../mapping-store/mapping-store").MappingEntry[]): unknown {
    const mappings = preloadedMappings ?? this.mappingStore.listMappings(scopeId);
    const reversePairs = mappings
      .map((entry) => [entry.pseudonym, entry.originalValue] as const)
      .sort((a, b) => b[0].length - a[0].length);

    this.logger?.info({ scopeId, pairCount: reversePairs.length }, "remap JSON response");

    if (reversePairs.length === 0 && !this.projectShield?.enabled) {
      return payload;
    }

    let result = reversePairs.length > 0 ? deepRemap(payload, reversePairs) : payload;

    // Apply project shield reverse (restore project identity strings) as last step
    if (this.projectShield?.enabled) {
      result = deepApplyShieldReverse(result, this.projectShield);
    }

    // Record remap operation
    if (reversePairs.length > 0) {
      recordRemap();
    }

    return result;
  }

  createSseTransform(scopeId: string): Transform {
    const reversePairs = this.mappingStore
      .listMappings(scopeId)
      .map((entry) => [entry.pseudonym, entry.originalValue] as const)
      .sort((a, b) => b[0].length - a[0].length);
    let carry = "";
    const shield = this.projectShield;

    return new Transform({
      transform(chunk, _encoding, callback) {
        if (reversePairs.length === 0 && !shield?.enabled) {
          callback(null, chunk);
          return;
        }

        const incoming = carry + chunk.toString("utf8");
        const safeLength = Math.max(0, incoming.length - 16);
        const safePart = incoming.slice(0, safeLength);
        carry = incoming.slice(safeLength);
        let remapped = applyReplacements(safePart, reversePairs);
        if (shield?.enabled) remapped = shield.reverse(remapped);
        callback(null, remapped);
      },
      flush(callback) {
        let remapped = applyReplacements(carry, reversePairs);
        if (shield?.enabled) remapped = shield.reverse(remapped);
        callback(null, remapped);
      }
    });
  }

  /**
   * Event-level SSE remap with content-level buffering.
   *
   * The LLM's BPE tokenizer splits pseudonyms across SSE delta events
   * (e.g. "idn" in event 1, "_08" in event 2).  Simple per-event replacement
   * misses these.  We solve this by buffering delta.content text and applying
   * the replacement regex on the accumulated buffer, keeping a carry of
   * maxPseudonymLength chars to catch pseudonyms that straddle chunk boundaries.
   *
   * Non-content events (tool calls, role, finish) are deepRemapped immediately.
   */
  createEventLevelSseTransform(scopeId: string, preloadedMappings?: import("../mapping-store/mapping-store").MappingEntry[]): CapturingTransform {
    const mappings = preloadedMappings ?? this.mappingStore.listMappings(scopeId);
    const reversePairs = mappings
      .map((entry) => [entry.pseudonym, entry.originalValue] as const)
      .sort((a, b) => b[0].length - a[0].length);

    let sseBuffer = "";           // Incomplete SSE line buffer
    let contentCarry = "";        // Delta content carry for cross-event pseudonyms
    const capturedChunks: string[] = [];

    // Max pseudonym length determines carry size
    const maxPseudoLen = reversePairs.length > 0
      ? Math.max(...reversePairs.map(([p]) => p.length))
      : 0;

    const shield = this.projectShield;
    const logger = this.logger;
    logger?.info({ scopeId, pairCount: reversePairs.length, maxPseudoLen }, "remap SSE transform created");

    // Store last event shape so we can emit carry-flush as a valid event
    let lastEventTemplate: Record<string, unknown> | null = null;
    let debugEventCount = 0;

    // Helper: apply pseudonym remap + shield reverse to text
    const remapAndShield = (text: string): string => {
      let result = applyReplacements(text, reversePairs);
      if (shield?.enabled) result = shield.reverse(result);
      return result;
    };
    // Helper: apply deepRemap + shield reverse to objects
    const deepRemapAndShield = (value: unknown): unknown => {
      let result = deepRemap(value, reversePairs);
      if (shield?.enabled) result = deepApplyShieldReverse(result, shield);
      return result;
    };

    const transform = new Transform({
      transform(chunk, _encoding, callback) {
        if (reversePairs.length === 0 && !shield?.enabled) {
          callback(null, chunk);
          return;
        }

        sseBuffer += chunk.toString("utf8");
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() ?? "";

        let output = "";
        for (const rawLine of lines) {
          // Strip \r from \r\n line endings
          const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

          if (line.startsWith("data: [DONE]")) {
            // Flush remaining content carry before DONE
            if (contentCarry) {
              logger?.info({ carryLen: contentCarry.length, carry: contentCarry.slice(0, 100) }, "flushing content carry before DONE");
              const remapped = remapAndShield(contentCarry);
              capturedChunks.push(remapped);
              logger?.info({ remapped: remapped.slice(0, 100) }, "carry flushed and remapped");
              if (lastEventTemplate) {
                setDeltaContent(lastEventTemplate, remapped);
                // Emit as a full SSE event with double-newline separator
                output += "data: " + JSON.stringify(lastEventTemplate) + "\n\n";
              }
              contentCarry = "";
            }
            output += line + "\n";
          } else if (line.startsWith("data: ") && line.length > 6) {
            try {
              const parsed = JSON.parse(line.slice(6));
              const deltaText = extractDeltaContent(parsed);

              debugEventCount++;
              if (typeof deltaText === "string") {
                // --- Content delta: buffer + carry-based remap ---
                contentCarry += deltaText;
                lastEventTemplate = parsed;

                // Find a safe split point: never split in the middle of a word,
                // otherwise pseudonyms like XZORION get cut ("XZORI" | "ON")
                // and neither half matches the replacement regex.
                let safeEnd = Math.max(0, contentCarry.length - maxPseudoLen);
                // Walk backward to a non-word character so we split at a \b boundary
                while (safeEnd > 0 && /\w/.test(contentCarry[safeEnd])) {
                  safeEnd--;
                }
                if (safeEnd > 0) {
                  const safePart = contentCarry.slice(0, safeEnd);
                  contentCarry = contentCarry.slice(safeEnd);
                  const remapped = remapAndShield(safePart);
                  capturedChunks.push(remapped);
                  setDeltaContent(parsed, remapped);
                  output += "data: " + JSON.stringify(parsed) + "\n";
                  // Debug: check if pseudonyms survived in remapped text
                  if (debugEventCount <= 200) {
                    for (const [p] of reversePairs) {
                      if (remapped.includes(p)) {
                        logger?.warn({ pseudonym: p, remappedSnippet: remapped.slice(0, 100), safeEnd, carryLen: contentCarry.length }, "PSEUDONYM SURVIVED in remapped safe part");
                      }
                    }
                  }
                }
                // If safeEnd == 0, not enough data yet — hold in carry
              } else {
                // --- Non-content event (role, tool_calls, finish): immediate deepRemap ---
                const remapped = deepRemapAndShield(parsed);
                output += "data: " + JSON.stringify(remapped) + "\n";
              }
            } catch {
              output += line + "\n";
            }
          } else {
            output += line + "\n";
          }
        }
        callback(null, output || undefined);
      },
      flush(callback) {
        let final = "";
        // Flush remaining content carry
        if (contentCarry) {
          const remapped = remapAndShield(contentCarry);
          capturedChunks.push(remapped);
          if (lastEventTemplate) {
            setDeltaContent(lastEventTemplate, remapped);
            final += "data: " + JSON.stringify(lastEventTemplate) + "\n";
          }
          contentCarry = "";
        }
        // Process remaining SSE buffer
        if (sseBuffer.trim()) {
          if (sseBuffer.startsWith("data: ") && !sseBuffer.startsWith("data: [DONE]")) {
            try {
              const parsed = JSON.parse(sseBuffer.slice(6));
              const remapped = deepRemapAndShield(parsed);
              final += "data: " + JSON.stringify(remapped) + "\n";
            } catch {
              final += sseBuffer;
            }
          } else {
            final += sseBuffer;
          }
        }
        callback(null, final || undefined);
      }
    }) as CapturingTransform;

    transform.getCapturedText = () => capturedChunks.join("");
    return transform;
  }
}

/** Recursively apply shield.reverse() to all strings in a value. */
function deepApplyShieldReverse(value: unknown, shield: ProjectShield): unknown {
  if (typeof value === "string") return shield.reverse(value);
  if (Array.isArray(value)) return value.map((item) => deepApplyShieldReverse(item, shield));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = deepApplyShieldReverse(v, shield);
    }
    return out;
  }
  return value;
}

function deepRemap(value: unknown, reversePairs: ReadonlyArray<readonly [string, string]>): unknown {
  if (typeof value === "string") {
    return applyReplacements(value, reversePairs);
  }

  if (Array.isArray(value)) {
    return value.map((item) => deepRemap(item, reversePairs));
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = deepRemap(v, reversePairs);
    }
    return out;
  }

  return value;
}

/**
 * Build a combined regex + lookup map for single-pass replacement.
 * Cached per unique set of reverse pairs (same scope = same object ref).
 */
let cachedPairs: ReadonlyArray<readonly [string, string]> | null = null;
let cachedReplacer: { regex: RegExp; lookup: Map<string, string> } | null = null;

function getReplacer(reversePairs: ReadonlyArray<readonly [string, string]>): { regex: RegExp; lookup: Map<string, string> } {
  if (cachedPairs === reversePairs && cachedReplacer) {
    return cachedReplacer;
  }

  const lookup = new Map<string, string>();
  const escaped: string[] = [];
  for (const [pseudonym, original] of reversePairs) {
    // Case-insensitive lookup: LLMs may lowercase pseudonyms in free text
    lookup.set(pseudonym.toLowerCase(), original);
    escaped.push(pseudonym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }

  // Sort by length descending so longer pseudonyms match first
  escaped.sort((a, b) => b.length - a.length);
  // Use custom boundaries that treat underscore as a separator.
  // \b doesn't work because _ is a word character, so ORG_ZORION inside
  // ORG_ZORION_VARIABLES wouldn't match with \b boundaries.
  // Instead: not preceded/followed by a letter or digit (underscore IS a boundary).
  // Case-insensitive flag added: LLMs often lowercase pseudonyms.
  const regex = new RegExp(
    escaped.map((e) => `(?<![a-zA-Z0-9])${e}(?![a-zA-Z0-9])`).join("|"),
    "gi"
  );

  cachedPairs = reversePairs;
  cachedReplacer = { regex, lookup };
  return cachedReplacer;
}

function applyReplacements(input: string, reversePairs: ReadonlyArray<readonly [string, string]>): string {
  if (reversePairs.length === 0) return input;

  const { regex, lookup } = getReplacer(reversePairs);
  // Reset lastIndex since regex is global and reused
  regex.lastIndex = 0;
  return input.replace(regex, (match) => lookup.get(match.toLowerCase()) ?? match);
}

/**
 * Extract text content from a remapped SSE event for response capture.
 * Handles both Chat Completions format (choices[].delta.content)
 * and Responses API format (delta field on text events).
 */
function extractDeltaContent(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const rec = event as Record<string, unknown>;

  // Chat Completions: choices[0].delta.content
  if (Array.isArray(rec.choices)) {
    const choice = rec.choices[0] as Record<string, unknown> | undefined;
    if (choice?.delta && typeof choice.delta === "object") {
      const delta = choice.delta as Record<string, unknown>;
      if (typeof delta.content === "string") return delta.content;
    }
  }

  // Responses API: delta (text delta events)
  if (typeof rec.delta === "string") return rec.delta;

  return null;
}

/**
 * Set the text content in a delta SSE event (mutates in place).
 * Handles both Chat Completions (choices[0].delta.content)
 * and Responses API (delta field).
 */
function setDeltaContent(event: Record<string, unknown>, content: string): void {
  // Chat Completions: choices[0].delta.content
  if (Array.isArray(event.choices)) {
    const choice = event.choices[0] as Record<string, unknown> | undefined;
    if (choice?.delta && typeof choice.delta === "object") {
      (choice.delta as Record<string, unknown>).content = content;
      return;
    }
  }

  // Responses API: delta field
  if ("delta" in event) {
    event.delta = content;
  }
}
