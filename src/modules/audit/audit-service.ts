import type { FastifyBaseLogger } from "fastify";

/**
 * Stub AuditService for OSS version
 * Full audit logging available in Enterprise edition
 */
export class AuditService {
  constructor(private readonly logger: FastifyBaseLogger) {}

  logRequest(_data: unknown): void {
    // No-op in OSS version
  }

  logMasking(_data: unknown): void {
    // No-op in OSS version
  }

  logAccess(_data: unknown): void {
    // No-op in OSS version
  }

  record(_eventOrData: string | unknown, _data?: unknown): void {
    // No-op in OSS version
  }
}
