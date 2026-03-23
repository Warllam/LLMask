import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { DashboardStats, DsiStats, LeakContext, LeakReport, MappingEntry, MappingStore, RequestLogEntry, ScopeSummary, SessionSummary } from "./mapping-store";

type MappingRow = {
  scope_id: string;
  kind: string;
  original_value: string;
  pseudonym: string;
  created_at: string;
};

type RequestLogRow = {
  id: number;
  trace_id: string;
  request_id: string;
  endpoint: string;
  model: string | null;
  original_body: string;
  rewritten_body: string;
  response_body: string | null;
  transformed_count: number;
  created_at: string;
};

export class SqliteMappingStore implements MappingStore {
  private readonly db: Database.Database;

  // In-memory mapping cache per scope — avoids repeated DB reads for the same session
  private readonly mappingCache = new Map<string, { entries: MappingEntry[]; cachedAt: number }>();
  private readonly CACHE_TTL_MS = 30_000; // 30s TTL

  // Background leak scan cache — prevents O(n×m) scan from blocking proxy requests
  private leakCache: { report: LeakReport; cachedAt: number } | null = null;
  private leakScanRunning = false;
  private readonly LEAK_CACHE_TTL_MS = 60_000; // 60s TTL

  constructor(private readonly sqlitePath: string) {
    const dir = path.dirname(path.resolve(sqlitePath));
    fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(sqlitePath);
  }

  /** Expose the raw DB instance (used by AuthService to share the same connection). */
  getDb(): Database.Database {
    return this.db;
  }

  initialize(): void {
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mapping_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        original_value TEXT NOT NULL,
        pseudonym TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE(scope_id, original_value),
        UNIQUE(scope_id, pseudonym)
      );
      CREATE INDEX IF NOT EXISTS idx_mapping_entries_scope_id
        ON mapping_entries(scope_id);
      CREATE INDEX IF NOT EXISTS idx_mapping_entries_scope_id_pseudonym
        ON mapping_entries(scope_id, pseudonym);

      CREATE TABLE IF NOT EXISTS request_log (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        trace_id          TEXT    NOT NULL,
        request_id        TEXT    NOT NULL,
        endpoint          TEXT    NOT NULL,
        model             TEXT,
        original_body     TEXT    NOT NULL,
        rewritten_body    TEXT    NOT NULL,
        response_body     TEXT,
        transformed_count INTEGER NOT NULL DEFAULT 0,
        created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_request_log_created_at
        ON request_log(created_at);

      CREATE TABLE IF NOT EXISTS session_titles (
        trace_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        is_auto_generated INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);

    // Safe migration for existing databases
    try {
      this.db.exec(`ALTER TABLE request_log ADD COLUMN response_body TEXT`);
    } catch {
      // Column already exists — ignore
    }
  }

  listMappings(scopeId: string): MappingEntry[] {
    // Check cache first
    const cached = this.mappingCache.get(scopeId);
    if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL_MS) {
      return cached.entries;
    }

    const stmt = this.db.prepare<[string], MappingRow>(`
      SELECT scope_id, kind, original_value, pseudonym, created_at
      FROM mapping_entries
      WHERE scope_id = ?
      ORDER BY id ASC
    `);

    const entries = stmt.all(scopeId).map((row: MappingRow) => ({
      scopeId: row.scope_id,
      kind: row.kind as MappingEntry["kind"],
      originalValue: row.original_value,
      pseudonym: row.pseudonym,
      createdAt: row.created_at
    }));

    this.mappingCache.set(scopeId, { entries, cachedAt: Date.now() });

    // Evict old scopes to prevent unbounded memory growth
    if (this.mappingCache.size > 200) {
      const oldest = [...this.mappingCache.entries()]
        .sort((a, b) => a[1].cachedAt - b[1].cachedAt)
        .slice(0, this.mappingCache.size - 100);
      for (const [key] of oldest) this.mappingCache.delete(key);
    }

    return entries;
  }

  listScopes(): ScopeSummary[] {
    const stmt = this.db.prepare(`
      SELECT scope_id, COUNT(*) as entry_count, MAX(created_at) as last_created_at
      FROM mapping_entries
      GROUP BY scope_id
      ORDER BY last_created_at DESC
    `);
    return (stmt.all() as Array<{ scope_id: string; entry_count: number; last_created_at: string }>).map((row) => ({
      scopeId: row.scope_id,
      entryCount: row.entry_count,
      lastCreatedAt: row.last_created_at
    }));
  }

  listRecentMappings(limit: number): MappingEntry[] {
    const stmt = this.db.prepare<[number], MappingRow>(`
      SELECT scope_id, kind, original_value, pseudonym, created_at
      FROM mapping_entries
      ORDER BY created_at DESC
      LIMIT ?
    `);
    return stmt.all(limit).map((row: MappingRow) => ({
      scopeId: row.scope_id,
      kind: row.kind as MappingEntry["kind"],
      originalValue: row.original_value,
      pseudonym: row.pseudonym,
      createdAt: row.created_at
    }));
  }

  upsertMappings(
    scopeId: string,
    entries: Array<Pick<MappingEntry, "kind" | "originalValue" | "pseudonym">>
  ): void {
    if (entries.length === 0) return;

    // First, delete any existing entry that has the same pseudonym but different original_value
    // to avoid UNIQUE(scope_id, pseudonym) violations when re-mapping
    const clearConflict = this.db.prepare(`
      DELETE FROM mapping_entries
      WHERE scope_id = @scope_id AND pseudonym = @pseudonym AND original_value != @original_value
    `);

    const insert = this.db.prepare(`
      INSERT INTO mapping_entries (scope_id, kind, original_value, pseudonym)
      VALUES (@scope_id, @kind, @original_value, @pseudonym)
      ON CONFLICT(scope_id, original_value) DO UPDATE SET
        kind = excluded.kind,
        pseudonym = excluded.pseudonym
    `);

    const tx = this.db.transaction((rows: Array<Pick<MappingEntry, "kind" | "originalValue" | "pseudonym">>) => {
      for (const row of rows) {
        clearConflict.run({
          scope_id: scopeId,
          pseudonym: row.pseudonym,
          original_value: row.originalValue
        });
        insert.run({
          scope_id: scopeId,
          kind: row.kind,
          original_value: row.originalValue,
          pseudonym: row.pseudonym
        });
      }
    });

    tx(entries);

    // Invalidate cache for this scope
    this.mappingCache.delete(scopeId);
  }

  insertRequestLog(entry: Omit<RequestLogEntry, "id" | "createdAt" | "responseBody">): number {
    const stmt = this.db.prepare(`
      INSERT INTO request_log (trace_id, request_id, endpoint, model, original_body, rewritten_body, transformed_count)
      VALUES (@trace_id, @request_id, @endpoint, @model, @original_body, @rewritten_body, @transformed_count)
    `);
    const result = stmt.run({
      trace_id: entry.traceId,
      request_id: entry.requestId,
      endpoint: entry.endpoint,
      model: entry.model,
      original_body: entry.originalBody,
      rewritten_body: entry.rewrittenBody,
      transformed_count: entry.transformedCount
    });
    return Number(result.lastInsertRowid);
  }

  updateResponseBody(logId: number, responseBody: string): void {
    this.db.prepare(`UPDATE request_log SET response_body = ? WHERE id = ?`).run(responseBody, logId);
  }

  listRequestLogs(limit: number): RequestLogEntry[] {
    const stmt = this.db.prepare<[number], RequestLogRow>(`
      SELECT id, trace_id, request_id, endpoint, model, original_body, rewritten_body, response_body, transformed_count, created_at
      FROM request_log
      ORDER BY created_at DESC
      LIMIT ?
    `);
    return stmt.all(limit).map((row) => ({
      id: row.id,
      traceId: row.trace_id,
      requestId: row.request_id,
      endpoint: row.endpoint,
      model: row.model,
      originalBody: row.original_body,
      rewrittenBody: row.rewritten_body,
      responseBody: row.response_body ?? null,
      transformedCount: row.transformed_count,
      createdAt: row.created_at
    }));
  }

  getRequestLog(id: number): RequestLogEntry | null {
    const stmt = this.db.prepare<[number], RequestLogRow>(`
      SELECT id, trace_id, request_id, endpoint, model, original_body, rewritten_body, response_body, transformed_count, created_at
      FROM request_log
      WHERE id = ?
    `);
    const row = stmt.get(id);
    if (!row) return null;
    return {
      id: row.id,
      traceId: row.trace_id,
      requestId: row.request_id,
      endpoint: row.endpoint,
      model: row.model,
      originalBody: row.original_body,
      rewrittenBody: row.rewritten_body,
      responseBody: row.response_body ?? null,
      transformedCount: row.transformed_count,
      createdAt: row.created_at
    };
  }

  getSessionTitle(traceId: string): string | null {
    const row = this.db.prepare<[string], { title: string }>(
      "SELECT title FROM session_titles WHERE trace_id = ?"
    ).get(traceId);
    return row?.title ?? null;
  }

  deleteSession(traceId: string): void {
    const del = this.db.transaction(() => {
      this.db.prepare("DELETE FROM mapping_entries WHERE scope_id = ?").run(traceId);
      this.db.prepare("DELETE FROM request_log WHERE trace_id = ?").run(traceId);
      this.db.prepare("DELETE FROM session_titles WHERE trace_id = ?").run(traceId);
    });
    del();
    this.mappingCache.delete(traceId);
  }

  upsertSessionTitle(traceId: string, title: string, isAutoGenerated: boolean): void {
    this.db.prepare(`
      INSERT INTO session_titles (trace_id, title, is_auto_generated, updated_at)
      VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(trace_id) DO UPDATE SET
        title = excluded.title,
        is_auto_generated = excluded.is_auto_generated,
        updated_at = excluded.updated_at
    `).run(traceId, title, isAutoGenerated ? 1 : 0);
  }

  listSessions(limit: number): SessionSummary[] {
    const stmt = this.db.prepare(`
      SELECT
        r.trace_id,
        COUNT(*) as request_count,
        COALESCE(SUM(r.transformed_count), 0) as total_transforms,
        GROUP_CONCAT(DISTINCT r.model) as models_csv,
        MIN(r.created_at) as first_request_at,
        MAX(r.created_at) as last_request_at,
        (SELECT original_body FROM request_log r2 WHERE r2.trace_id = r.trace_id ORDER BY r2.created_at ASC LIMIT 1) as first_body,
        st.title as session_title,
        st.is_auto_generated
      FROM request_log r
      LEFT JOIN session_titles st ON st.trace_id = r.trace_id
      GROUP BY r.trace_id
      ORDER BY last_request_at DESC
      LIMIT ?
    `);
    type SessionRow = {
      trace_id: string;
      request_count: number;
      total_transforms: number;
      models_csv: string | null;
      first_request_at: string;
      last_request_at: string;
      first_body: string | null;
      session_title: string | null;
      is_auto_generated: number | null;
    };
    const rows = stmt.all(limit) as SessionRow[];

    // Lazy-generate titles for sessions that don't have one yet
    for (const row of rows) {
      if (!row.session_title) {
        const generated = generateSessionTitle(row.first_body, row.trace_id);
        this.upsertSessionTitle(row.trace_id, generated, true);
        row.session_title = generated;
      }
    }

    return rows.map((row) => ({
      traceId: row.trace_id,
      title: row.session_title!,
      requestCount: row.request_count,
      totalTransforms: row.total_transforms,
      models: row.models_csv ? [...new Set(row.models_csv.split(",").filter(Boolean))] : [],
      firstRequestAt: row.first_request_at,
      lastRequestAt: row.last_request_at,
      previewMessage: extractPreviewFromBody(row.first_body)
    }));
  }

  listRequestLogsByTraceId(traceId: string): RequestLogEntry[] {
    const stmt = this.db.prepare<[string], RequestLogRow>(`
      SELECT id, trace_id, request_id, endpoint, model, original_body, rewritten_body, response_body, transformed_count, created_at
      FROM request_log
      WHERE trace_id = ?
      ORDER BY created_at ASC
    `);
    return stmt.all(traceId).map((row) => ({
      id: row.id,
      traceId: row.trace_id,
      requestId: row.request_id,
      endpoint: row.endpoint,
      model: row.model,
      originalBody: row.original_body,
      rewrittenBody: row.rewritten_body,
      responseBody: row.response_body ?? null,
      transformedCount: row.transformed_count,
      createdAt: row.created_at
    }));
  }

  getStats(): DashboardStats {
    const totalMappings = (this.db.prepare("SELECT COUNT(*) as c FROM mapping_entries").get() as { c: number }).c;
    const totalRequests = (this.db.prepare("SELECT COUNT(*) as c FROM request_log").get() as { c: number }).c;
    const totalTransforms = (this.db.prepare("SELECT COALESCE(SUM(transformed_count), 0) as c FROM request_log").get() as { c: number }).c;

    const kindRows = this.db.prepare("SELECT kind, COUNT(*) as c FROM mapping_entries GROUP BY kind").all() as Array<{ kind: string; c: number }>;
    const mappingsByKind: Record<string, number> = {};
    for (const row of kindRows) mappingsByKind[row.kind] = row.c;

    const epRows = this.db.prepare("SELECT endpoint, COUNT(*) as c FROM request_log GROUP BY endpoint").all() as Array<{ endpoint: string; c: number }>;
    const requestsByEndpoint: Record<string, number> = {};
    for (const row of epRows) requestsByEndpoint[row.endpoint] = row.c;

    const activityRows = this.db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as c
      FROM request_log
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 7
    `).all() as Array<{ date: string; c: number }>;
    const recentActivity = activityRows.map((r) => ({ date: r.date, count: r.c }));

    const topRows = this.db.prepare(`
      SELECT original_value, pseudonym, kind, COUNT(*) as occurrences
      FROM mapping_entries
      GROUP BY original_value
      ORDER BY occurrences DESC, original_value ASC
      LIMIT 20
    `).all() as Array<{ original_value: string; pseudonym: string; kind: string; occurrences: number }>;
    const topTokens = topRows.map((r) => ({
      originalValue: r.original_value,
      pseudonym: r.pseudonym,
      kind: r.kind,
      occurrences: r.occurrences
    }));

    return { totalMappings, totalRequests, totalTransforms, mappingsByKind, requestsByEndpoint, recentActivity, topTokens };
  }

  getDsiStats(): DsiStats {
    const totalRequests = (this.db.prepare("SELECT COUNT(*) as c FROM request_log").get() as { c: number }).c;
    const totalTransforms = (this.db.prepare("SELECT COALESCE(SUM(transformed_count), 0) as c FROM request_log").get() as { c: number }).c;
    const totalEntities = (this.db.prepare("SELECT COUNT(*) as c FROM mapping_entries").get() as { c: number }).c;
    const sessions = (this.db.prepare("SELECT COUNT(DISTINCT trace_id) as c FROM request_log").get() as { c: number }).c;

    const kindRows = this.db.prepare("SELECT kind, COUNT(*) as c FROM mapping_entries GROUP BY kind").all() as Array<{ kind: string; c: number }>;
    const entitiesByKind: Record<string, number> = {};
    for (const row of kindRows) entitiesByKind[row.kind] = row.c;

    const dayRows = this.db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as c
      FROM request_log
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 30
    `).all() as Array<{ date: string; c: number }>;
    const requestsByDay = dayRows.reverse().map(r => ({ date: r.date, count: r.c }));

    const modelRows = this.db.prepare("SELECT model, COUNT(*) as c FROM request_log WHERE model IS NOT NULL GROUP BY model ORDER BY c DESC").all() as Array<{ model: string; c: number }>;
    const requestsByModel: Record<string, number> = {};
    for (const row of modelRows) requestsByModel[row.model] = row.c;

    const epRows = this.db.prepare("SELECT endpoint, COUNT(*) as c FROM request_log GROUP BY endpoint ORDER BY c DESC").all() as Array<{ endpoint: string; c: number }>;
    const requestsByEndpoint: Record<string, number> = {};
    for (const row of epRows) requestsByEndpoint[row.endpoint] = row.c;

    const sampleRows = this.db.prepare(`
      SELECT kind, original_value, pseudonym FROM mapping_entries ORDER BY RANDOM() LIMIT 15
    `).all() as Array<{ kind: string; original_value: string; pseudonym: string }>;
    const sampleMappings = sampleRows.map(r => ({ kind: r.kind, original: r.original_value, pseudonym: r.pseudonym }));

    const avgTransformsPerRequest = totalRequests > 0 ? Math.round(totalTransforms / totalRequests) : 0;

    return { totalRequests, totalTransforms, totalEntities, entitiesByKind, requestsByDay, requestsByModel, requestsByEndpoint, avgTransformsPerRequest, sessions, sampleMappings };
  }

  /**
   * Returns cached leak report if fresh, otherwise triggers background scan
   * and returns stale/empty report immediately (non-blocking).
   */
  scanLeaksCached(shieldTerms?: string[]): LeakReport {
    if (this.leakCache && Date.now() - this.leakCache.cachedAt < this.LEAK_CACHE_TTL_MS) {
      return this.leakCache.report;
    }

    // Return stale cache while refreshing in background
    if (!this.leakScanRunning) {
      this.leakScanRunning = true;
      // Use setImmediate to run outside current call stack
      setImmediate(() => {
        try {
          const report = this.scanLeaks(200, shieldTerms);
          this.leakCache = { report, cachedAt: Date.now() };
        } finally {
          this.leakScanRunning = false;
        }
      });
    }

    return this.leakCache?.report ?? {
      totalRequestsScanned: 0,
      requestLeaks: 0,
      responseLeaks: 0,
      shieldLeaks: 0,
      leakDetails: [],
    };
  }

  scanLeaks(limit = 200, shieldTerms?: string[]): LeakReport {
    // Fetch recent request logs (lightweight: only id + trace + bodies)
    const requests = this.db.prepare(`
      SELECT id, trace_id, request_id, endpoint, rewritten_body, response_body, created_at
      FROM request_log
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as Array<{
      id: number; trace_id: string; request_id: string; endpoint: string;
      rewritten_body: string; response_body: string | null; created_at: string;
    }>;

    // Fetch all mappings grouped by scope
    const allMappings = this.db.prepare(`
      SELECT scope_id, original_value, pseudonym FROM mapping_entries WHERE LENGTH(original_value) >= 4
    `).all() as Array<{ scope_id: string; original_value: string; pseudonym: string }>;

    const mappingsByScope = new Map<string, Array<{ original: string; pseudo: string }>>();
    for (const m of allMappings) {
      let arr = mappingsByScope.get(m.scope_id);
      if (!arr) { arr = []; mappingsByScope.set(m.scope_id, arr); }
      arr.push({ original: m.original_value, pseudo: m.pseudonym });
    }

    // Filter shield terms: only check terms >= 3 chars, case-insensitive
    const activeShieldTerms = (shieldTerms ?? []).filter(t => t.length >= 3);

    let requestLeaks = 0;
    let responseLeaks = 0;
    let shieldLeaks = 0;
    const leakDetails: LeakReport["leakDetails"] = [];

    for (const req of requests) {
      const scopeMappings = mappingsByScope.get(req.trace_id);

      const leakedOriginals: LeakContext[] = [];
      const leakedPseudonyms: LeakContext[] = [];
      const leakedShieldTerms: LeakContext[] = [];

      // Check: did any original value leak into the rewritten body?
      if (scopeMappings) {
        for (const m of scopeMappings) {
          if (req.rewritten_body.includes(m.original)) {
            const ctxs = extractLeakContext(req.rewritten_body, m.original, "request");
            for (const ctx of ctxs) {
              ctx.pseudonym = m.pseudo;
              leakedOriginals.push(ctx);
            }
          }
        }

        // Check: did any pseudonym survive in the response body?
        if (req.response_body) {
          for (const m of scopeMappings) {
            if (req.response_body.includes(m.pseudo)) {
              const ctxs = extractLeakContext(req.response_body, m.pseudo, "response");
              for (const ctx of ctxs) {
                ctx.originalValue = m.original;
                leakedPseudonyms.push(ctx);
              }
            }
          }
        }
      }

      // Check: did any shield term (project/product/client name) leak into the rewritten body?
      if (activeShieldTerms.length > 0) {
        const rewrittenLower = req.rewritten_body.toLowerCase();
        for (const term of activeShieldTerms) {
          const termLower = term.toLowerCase();
          if (rewrittenLower.includes(termLower)) {
            const pos = rewrittenLower.indexOf(termLower);
            const CONTEXT_CHARS = 40;
            const contextStart = Math.max(0, pos - CONTEXT_CHARS);
            const contextEnd = Math.min(req.rewritten_body.length, pos + term.length + CONTEXT_CHARS);
            const context = (contextStart > 0 ? "..." : "") +
              req.rewritten_body.slice(contextStart, contextEnd) +
              (contextEnd < req.rewritten_body.length ? "..." : "");
            leakedShieldTerms.push({ value: term, context, position: pos, bodyType: "request" });
          }
        }
      }

      if (leakedOriginals.length > 0) requestLeaks++;
      if (leakedPseudonyms.length > 0) responseLeaks++;
      if (leakedShieldTerms.length > 0) shieldLeaks++;

      if (leakedOriginals.length > 0 || leakedPseudonyms.length > 0 || leakedShieldTerms.length > 0) {
        leakDetails.push({
          requestId: req.request_id,
          traceId: req.trace_id,
          endpoint: req.endpoint,
          createdAt: req.created_at,
          leakedOriginals: leakedOriginals.slice(0, 10),
          leakedPseudonyms: leakedPseudonyms.slice(0, 10),
          leakedShieldTerms: leakedShieldTerms.slice(0, 10),
        });
      }
    }

    return {
      totalRequestsScanned: requests.length,
      requestLeaks,
      responseLeaks,
      shieldLeaks,
      leakDetails: leakDetails.slice(0, 50),
    };
  }
}

function extractLeakContext(body: string, searchValue: string, bodyType: "request" | "response"): LeakContext[] {
  const contexts: LeakContext[] = [];
  const CONTEXT_CHARS = 40;
  let startIdx = 0;

  while (startIdx < body.length) {
    const pos = body.indexOf(searchValue, startIdx);
    if (pos === -1) break;

    const contextStart = Math.max(0, pos - CONTEXT_CHARS);
    const contextEnd = Math.min(body.length, pos + searchValue.length + CONTEXT_CHARS);
    const context = (contextStart > 0 ? "..." : "") +
      body.slice(contextStart, contextEnd) +
      (contextEnd < body.length ? "..." : "");

    contexts.push({ value: searchValue, context, position: pos, bodyType });
    startIdx = pos + searchValue.length;
    if (contexts.length >= 5) break;
  }

  return contexts;
}

function generateSessionTitle(bodyJson: string | null, traceId: string): string {
  const preview = extractPreviewFromBody(bodyJson);
  if (!preview || preview.trim().length < 5) {
    return "Session " + traceId.slice(0, 8);
  }

  let title = preview
    .replace(/^#+\s*/, "")
    .replace(/^(hi|hello|hey|please|can you|could you|salut|bonjour)\b[,!\s]*/i, "")
    .trim();

  // Take first sentence or first 50 chars at word boundary
  const sentenceEnd = title.search(/[.!?\n]/);
  if (sentenceEnd > 0 && sentenceEnd <= 50) {
    title = title.slice(0, sentenceEnd);
  } else if (title.length > 50) {
    const lastSpace = title.lastIndexOf(" ", 50);
    title = title.slice(0, lastSpace > 10 ? lastSpace : 50);
  }

  return title.trim() || "Session " + traceId.slice(0, 8);
}

function extractPreviewFromBody(bodyJson: string | null): string | null {
  if (!bodyJson) return null;
  try {
    const body = JSON.parse(bodyJson);
    // Chat Completions format — find FIRST user message (skip system prompts)
    if (Array.isArray(body.messages)) {
      for (let i = 0; i < body.messages.length; i++) {
        const m = body.messages[i];
        if (m.role === "user" && typeof m.content === "string") {
          return m.content.length > 120 ? m.content.slice(0, 120) + "…" : m.content;
        }
      }
    }
    // Responses API format — find FIRST user message
    if (Array.isArray(body.input)) {
      for (let i = 0; i < body.input.length; i++) {
        const item = body.input[i];
        if (item.role !== "user") continue;
        if (typeof item.content === "string") {
          return item.content.length > 120 ? item.content.slice(0, 120) + "…" : item.content;
        }
        if (Array.isArray(item.content)) {
          for (const block of item.content) {
            if (block.type === "input_text" && typeof block.text === "string") {
              return block.text.length > 120 ? block.text.slice(0, 120) + "…" : block.text;
            }
          }
        }
      }
    }
  } catch {}
  return null;
}
