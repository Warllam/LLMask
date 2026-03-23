/**
 * Live Events Bus
 *
 * Simple in-memory event emitter for broadcasting masking events
 * and alert events to the dashboard SSE endpoint.
 */

import { EventEmitter } from "node:events";

export type LiveMaskingEvent = {
  timestamp: string;
  endpoint: string;         // e.g. "/v1/chat/completions"
  model: string;
  transformedCount: number;
  entityKinds: string[];    // e.g. ["org", "svc", "tbl"]
  scopeId: string;
  /** Short preview of what was masked (truncated, no real data) */
  preview?: string;
};

export type LiveAlertEvent = {
  type: "firing" | "resolved";
  id?: number;
  ruleId: string;
  ruleName: string;
  severity: "info" | "warning" | "critical";
  message?: string;
  value?: number;
  threshold?: number;
  firedAt?: string;
  resolvedAt?: string;
};

class LiveEventBus extends EventEmitter {
  emit(event: "masking", data: LiveMaskingEvent): boolean;
  emit(event: "alert", data: LiveAlertEvent): boolean;
  emit(event: string, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  on(event: "masking", listener: (data: LiveMaskingEvent) => void): this;
  on(event: "alert", listener: (data: LiveAlertEvent) => void): this;
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
}

// Singleton
export const liveBus = new LiveEventBus();
liveBus.setMaxListeners(50);
