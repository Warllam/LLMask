import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { MigrationRunner } from "../../scripts/migrate";

function tmpDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llmask-migrate-"));
  return path.join(dir, "test.db");
}

function createMigrationFiles(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(path.join(dir, "001_create_users.ts"), `
const m = {
  version: 1,
  name: "create_users",
  up(db: any) { db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)"); },
  down(db: any) { db.exec("DROP TABLE IF EXISTS users"); },
};
export default m;
`);

  fs.writeFileSync(path.join(dir, "002_create_posts.ts"), `
const m = {
  version: 2,
  name: "create_posts",
  up(db: any) { db.exec("CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, user_id INTEGER)"); },
  down(db: any) { db.exec("DROP TABLE IF EXISTS posts"); },
};
export default m;
`);
}

function getTables(db: Database.Database): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\__%' ESCAPE '\\' AND name != 'sqlite_sequence'").all() as Array<{ name: string }>)
    .map(r => r.name);
}

describe("MigrationRunner", () => {
  let dbPath: string;
  let migrationsDir: string;
  let runner: MigrationRunner;

  beforeEach(async () => {
    dbPath = tmpDb();
    migrationsDir = path.join(path.dirname(dbPath), "migrations");
    createMigrationFiles(migrationsDir);
    runner = new MigrationRunner(dbPath);
    await runner.loadMigrations(migrationsDir);
  });

  afterEach(() => {
    runner.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("should show all migrations as pending initially", () => {
    expect(runner.getPending()).toHaveLength(2);
    expect(runner.getApplied()).toHaveLength(0);
  });

  it("should apply all pending migrations with up()", async () => {
    const result = await runner.up();
    expect(result.applied).toHaveLength(2);
    expect(runner.getApplied()).toHaveLength(2);
    expect(runner.getPending()).toHaveLength(0);
    expect(getTables(runner.getDb())).toContain("users");
    expect(getTables(runner.getDb())).toContain("posts");
  });

  it("should rollback last migration with down()", async () => {
    await runner.up();
    const result = await runner.down();
    expect(result.rolledBack).toHaveLength(1);
    expect(result.rolledBack[0]).toContain("create_posts");
    expect(runner.getApplied()).toHaveLength(1);
    expect(getTables(runner.getDb())).toContain("users");
    expect(getTables(runner.getDb())).not.toContain("posts");
  });

  it("should rollback all migrations with down(all=true)", async () => {
    await runner.up();
    const result = await runner.down(true);
    expect(result.rolledBack).toHaveLength(2);
    expect(runner.getApplied()).toHaveLength(0);
  });

  it("should not re-apply already applied migrations", async () => {
    await runner.up();
    const result = await runner.up();
    expect(result.applied).toHaveLength(0);
  });

  it("should support dry-run mode", async () => {
    const result = await runner.up(true);
    expect(result.applied).toHaveLength(2);
    expect(runner.getApplied()).toHaveLength(0);
    expect(runner.getPending()).toHaveLength(2);
  });

  it("should create pre-run backup before applying migrations", async () => {
    const result = await runner.up();
    expect(result.backupPath).toBeTruthy();
    expect(fs.existsSync(result.backupPath!)).toBe(true);
  });
});

describe("Real migrations", () => {
  let dbPath: string;
  let runner: MigrationRunner;

  beforeEach(async () => {
    dbPath = tmpDb();
    runner = new MigrationRunner(dbPath);
    await runner.loadMigrations(path.join(__dirname, "../../migrations"));
  });

  afterEach(() => {
    runner.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("should apply all real migrations successfully", async () => {
    const result = await runner.up();
    expect(result.applied).toHaveLength(6);
    const tables = getTables(runner.getDb());
    expect(tables).toContain("mapping_entries");
    expect(tables).toContain("tenants");
    expect(tables).toContain("audit_logs");
    expect(tables).toContain("alert_rules");
    expect(tables).toContain("alert_events");
    expect(tables).toContain("request_log");
    expect(tables).toContain("analytics_daily");
    expect(tables).toContain("analytics_hourly");
  });

  it("should fully rollback all real migrations", async () => {
    await runner.up();
    await runner.down(true);
    const tables = getTables(runner.getDb());
    // _migrations table is managed internally and intentionally kept.
    expect(tables.filter(t => t !== "_migrations")).toHaveLength(0);
  });
});
