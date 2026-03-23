import { createHash } from "node:crypto";
import type { ExtractedEntity } from "./llm-entity-extractor";

type CacheEntry = {
  hash: string;
  entities: ExtractedEntity[];
  createdAt: number;
};

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_MAX_SIZE = 500;

export class EntityCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly maxSize: number;

  constructor(ttlMs = DEFAULT_TTL_MS, maxSize = DEFAULT_MAX_SIZE) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
  }

  get(text: string): ExtractedEntity[] | null {
    const hash = this.hash(text);
    const entry = this.cache.get(hash);
    if (!entry) return null;

    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(hash);
      return null;
    }

    return entry.entities;
  }

  set(text: string, entities: ExtractedEntity[]): void {
    const hash = this.hash(text);

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(hash)) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }

    this.cache.set(hash, {
      hash,
      entities,
      createdAt: Date.now()
    });
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  private hash(text: string): string {
    return createHash("sha256").update(text).digest("hex").slice(0, 16);
  }
}
