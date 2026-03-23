import type Database from "better-sqlite3";

export type Tenant = {
  id: string;
  name: string;
  apiKey: string;
  rateLimit: number; // requests per minute, 0 = unlimited
  enabled: boolean;
  createdAt: string;
};

export type AuthResult =
  | { ok: true; tenant: Tenant }
  | { ok: false; reason: string };

/**
 * Manages API key authentication and tenant lookup.
 * Keys are stored in the same SQLite database as mappings.
 */
export class AuthService {
  private readonly db: Database.Database;
  /** In-memory cache: apiKey → Tenant (invalidated on write) */
  private cache = new Map<string, Tenant>();

  constructor(db: Database.Database) {
    this.db = db;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tenants (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        api_key      TEXT NOT NULL UNIQUE,
        rate_limit   INTEGER NOT NULL DEFAULT 0,
        enabled      INTEGER NOT NULL DEFAULT 1,
        created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_api_key ON tenants(api_key);
    `);
  }

  /** Validate an API key and return the associated tenant. */
  authenticate(apiKey: string): AuthResult {
    if (!apiKey) {
      return { ok: false, reason: "Missing API key" };
    }

    const cached = this.cache.get(apiKey);
    if (cached) {
      if (!cached.enabled) {
        return { ok: false, reason: "Tenant disabled" };
      }
      return { ok: true, tenant: cached };
    }

    const row = this.db.prepare(
      "SELECT id, name, api_key, rate_limit, enabled, created_at FROM tenants WHERE api_key = ?"
    ).get(apiKey) as { id: string; name: string; api_key: string; rate_limit: number; enabled: number; created_at: string } | undefined;

    if (!row) {
      return { ok: false, reason: "Invalid API key" };
    }

    const tenant: Tenant = {
      id: row.id,
      name: row.name,
      apiKey: row.api_key,
      rateLimit: row.rate_limit,
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
    };

    this.cache.set(apiKey, tenant);

    if (!tenant.enabled) {
      return { ok: false, reason: "Tenant disabled" };
    }

    return { ok: true, tenant };
  }

  /** Create a new tenant and return it with a generated API key. */
  createTenant(id: string, name: string, rateLimit = 0): Tenant {
    const apiKey = generateApiKey();
    this.db.prepare(
      "INSERT INTO tenants (id, name, api_key, rate_limit) VALUES (?, ?, ?, ?)"
    ).run(id, name, apiKey, rateLimit);

    this.cache.clear();

    const tenant: Tenant = {
      id,
      name,
      apiKey,
      rateLimit,
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    return tenant;
  }

  /** List all tenants (for admin). */
  listTenants(): Tenant[] {
    const rows = this.db.prepare(
      "SELECT id, name, api_key, rate_limit, enabled, created_at FROM tenants ORDER BY created_at"
    ).all() as Array<{ id: string; name: string; api_key: string; rate_limit: number; enabled: number; created_at: string }>;

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      apiKey: r.api_key,
      rateLimit: r.rate_limit,
      enabled: Boolean(r.enabled),
      createdAt: r.created_at,
    }));
  }

  /** Revoke (disable) a tenant. */
  disableTenant(id: string): void {
    this.db.prepare("UPDATE tenants SET enabled = 0 WHERE id = ?").run(id);
    this.cache.clear();
  }

  /** Re-enable a tenant. */
  enableTenant(id: string): void {
    this.db.prepare("UPDATE tenants SET enabled = 1 WHERE id = ?").run(id);
    this.cache.clear();
  }

  /** Rotate API key for a tenant. Returns new key. */
  rotateKey(tenantId: string): string {
    const newKey = generateApiKey();
    this.db.prepare("UPDATE tenants SET api_key = ? WHERE id = ?").run(newKey, tenantId);
    this.cache.clear();
    return newKey;
  }

  /** Check if any tenants exist. */
  hasTenants(): boolean {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM tenants").get() as { cnt: number };
    return row.cnt > 0;
  }
}

/** Generate a random API key: llmask_sk_<32 hex chars> */
function generateApiKey(): string {
  const { randomBytes } = require("node:crypto");
  return `llmask_sk_${randomBytes(16).toString("hex")}`;
}
