/**
 * Stub AlertManager for OSS version
 */

import type { FastifyBaseLogger } from "fastify";
import { AlertStore, type AlertManagerConfig } from "./alert-store";
import { AlertEngine } from "./alert-engine";

export type { AlertManagerConfig };

export class AlertManager {
  constructor(
    private readonly store: AlertStore,
    private readonly engine: AlertEngine,
    private readonly logger: FastifyBaseLogger
  ) {}

  async getActiveAlerts(): Promise<unknown[]> {
    return [];
  }

  async acknowledgeAlert(_id: string): Promise<void> {
    // No-op
  }

  async start(): Promise<void> {
    // No-op
  }

  async stop(): Promise<void> {
    // No-op
  }

  getSeverityRouter(): { getRoutes: () => unknown[]; getRouting: () => unknown; setRouting: (_routing: unknown) => void } | null {
    return {
      getRoutes: () => [],
      getRouting: () => ({}),
      setRouting: () => {}
    };
  }

  getMetrics(): Record<string, unknown> {
    return {};
  }

  getAggregator(): { getSummary: () => unknown; getBufferSize: () => number } | null {
    return {
      getSummary: () => ({}),
      getBufferSize: () => 0
    };
  }

  recordBlock(_data: unknown): void {
    // No-op
  }
}
