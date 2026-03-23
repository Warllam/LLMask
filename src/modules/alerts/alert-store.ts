/**
 * Stub AlertStore for OSS version
 * Full alerting available in Pro/Enterprise editions
 */

export type AlertManagerConfig = {
  enabled?: boolean;
  checkIntervalMs?: number;
};

export class AlertStore {
  async initialize(): Promise<void> {
    // No-op
  }
  async getActiveAlerts(): Promise<unknown[]> {
    return [];
  }

  async getAlertHistory(): Promise<unknown[]> {
    return [];
  }

  async acknowledgeAlert(_id: string): Promise<void> {
    // No-op in OSS version
  }

  async listRules(): Promise<unknown[]> {
    return [];
  }

  async upsertRule(_rule: unknown): Promise<void> {
    // No-op
  }

  async deleteRule(_id: string): Promise<void> {
    // No-op
  }

  async listEvents(_filter?: unknown): Promise<unknown[]> {
    return [];
  }

  async listFiringEvents(): Promise<unknown[]> {
    return [];
  }

  async resolveEvent(_id: string | number): Promise<void> {
    // No-op
  }

  async acknowledgeEvent(_id: string | number, _acknowledgedBy?: string): Promise<void> {
    // No-op
  }

  async bulkAcknowledge(_ids: (string | number)[], _acknowledgedBy?: string): Promise<void | number> {
    // No-op
    return 0;
  }

  async filterEvents(_filter: unknown): Promise<unknown[]> {
    return [];
  }

  async countUnacknowledged(): Promise<number> {
    return 0;
  }
}
