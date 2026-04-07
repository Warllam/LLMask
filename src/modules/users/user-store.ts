import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";

export type UserRole = "admin" | "viewer";

export type User = {
  id: string;
  username: string;
  role: UserRole;
  apiKey: string;
  createdAt: string;
  lastLogin: string | null;
};

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  api_key: string;
  created_at: string;
  last_login: string | null;
};

export class UserStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id           TEXT PRIMARY KEY,
        username     TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role         TEXT NOT NULL DEFAULT 'viewer',
        api_key      TEXT NOT NULL UNIQUE,
        created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        last_login   TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_api_key  ON users(api_key);
    `);
  }

  hasUsers(): boolean {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM users").get() as { cnt: number };
    return row.cnt > 0;
  }

  getUserByUsername(username: string): UserRow | null {
    return this.db.prepare(
      "SELECT id, username, password_hash, role, api_key, created_at, last_login FROM users WHERE username = ?"
    ).get(username) as UserRow | null;
  }

  getUserById(id: string): UserRow | null {
    return this.db.prepare(
      "SELECT id, username, password_hash, role, api_key, created_at, last_login FROM users WHERE id = ?"
    ).get(id) as UserRow | null;
  }

  getUserByApiKey(apiKey: string): User | null {
    const row = this.db.prepare(
      "SELECT id, username, role, api_key, created_at, last_login FROM users WHERE api_key = ?"
    ).get(apiKey) as Omit<UserRow, "password_hash"> | null;
    if (!row) return null;
    return rowToUser(row as UserRow);
  }

  listUsers(): User[] {
    const rows = this.db.prepare(
      "SELECT id, username, role, api_key, created_at, last_login FROM users ORDER BY created_at"
    ).all() as UserRow[];
    return rows.map(rowToUser);
  }

  createUser(id: string, username: string, passwordHash: string, role: UserRole): User {
    const apiKey = generateUserApiKey();
    this.db.prepare(
      "INSERT INTO users (id, username, password_hash, role, api_key) VALUES (?, ?, ?, ?, ?)"
    ).run(id, username, passwordHash, role, apiKey);

    return { id, username, role, apiKey, createdAt: new Date().toISOString(), lastLogin: null };
  }

  updateLastLogin(id: string): void {
    this.db.prepare(
      "UPDATE users SET last_login = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
    ).run(id);
  }

  updatePassword(id: string, passwordHash: string): void {
    this.db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, id);
  }

  updateRole(id: string, role: UserRole): void {
    this.db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
  }

  rotateApiKey(id: string): string {
    const newKey = generateUserApiKey();
    this.db.prepare("UPDATE users SET api_key = ? WHERE id = ?").run(newKey, id);
    return newKey;
  }

  deleteUser(id: string): void {
    this.db.prepare("DELETE FROM users WHERE id = ?").run(id);
  }
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    apiKey: row.api_key,
    createdAt: row.created_at,
    lastLogin: row.last_login,
  };
}

/** Generate a user-scoped API key: llmask_uk_<32 hex chars> */
function generateUserApiKey(): string {
  return `llmask_uk_${randomBytes(16).toString("hex")}`;
}
