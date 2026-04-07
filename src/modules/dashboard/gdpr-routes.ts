import type { FastifyInstance } from "fastify";
import type { MappingStore, AuditLogQuery } from "../mapping-store/mapping-store";

type GdprDeps = {
  mappingStore: MappingStore;
  retentionDays: number;
};

export function registerGdprRoutes(server: FastifyInstance, deps: GdprDeps): void {
  const { mappingStore } = deps;

  // ── GET /dashboard/api/audit ─────────────────────────────────────────────
  // Paginated audit log of all masking operations.
  server.get<{
    Querystring: {
      page?: string;
      pageSize?: string;
      dateFrom?: string;
      dateTo?: string;
      strategy?: string;
      provider?: string;
    };
  }>("/dashboard/api/audit", async (request) => {
    const { page, pageSize, dateFrom, dateTo, strategy, provider } = request.query;
    const query: AuditLogQuery = {
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? Math.min(parseInt(pageSize, 10), 500) : 50,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      strategy: strategy || undefined,
      provider: provider || undefined,
    };
    return mappingStore.queryAuditLogs(query);
  });

  // ── DELETE /dashboard/api/gdpr/erase ────────────────────────────────────
  // Right to erasure (GDPR Article 17): deletes all records containing a term.
  server.delete<{ Body: { term: string } }>(
    "/dashboard/api/gdpr/erase",
    async (request, reply) => {
      const { term } = request.body as { term?: string };
      if (!term || typeof term !== "string" || term.trim().length < 2) {
        return reply.code(400).send({
          error: "term is required and must be at least 2 characters",
        });
      }
      const result = mappingStore.eraseBySearchTerm(term.trim());
      return { ok: true, ...result };
    }
  );

  // ── GET /dashboard/api/gdpr/export ──────────────────────────────────────
  // Data portability (GDPR Article 20): export all stored data as JSON.
  server.get("/dashboard/api/gdpr/export", async (_request, reply) => {
    const data = mappingStore.exportAll(deps.retentionDays);
    const filename = `llmask-export-${new Date().toISOString().slice(0, 10)}.json`;
    return reply
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .header("Content-Type", "application/json")
      .send(JSON.stringify(data, null, 2));
  });

  // ── GET /dashboard/api/gdpr/events ──────────────────────────────────────
  // Audit trail of GDPR operations (erasures, exports, retention cleanups).
  server.get<{ Querystring: { limit?: string } }>(
    "/dashboard/api/gdpr/events",
    async (request) => {
      const limit = Math.min(parseInt(request.query.limit ?? "100", 10) || 100, 500);
      return mappingStore.listGdprEvents(limit);
    }
  );

  // ── GET /dashboard/api/gdpr/retention ───────────────────────────────────
  // Returns the current retention policy configuration.
  server.get("/dashboard/api/gdpr/retention", async () => ({
    retentionDays: deps.retentionDays,
    enabled: deps.retentionDays > 0,
    envVar: "LLMASK_GDPR_RETENTION_DAYS",
    description:
      deps.retentionDays > 0
        ? `Data older than ${deps.retentionDays} days is automatically deleted.`
        : "No automatic deletion configured. Set LLMASK_GDPR_RETENTION_DAYS to enable.",
  }));
}
