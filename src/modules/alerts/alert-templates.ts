/**
 * Alert templates for OSS version
 */

import type { AlertSeverity } from "./alert-types";

export type AlertTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
  channelType?: string;
  titleTemplate?: string;
};

export function formatAlertMessage(_severity: AlertSeverity, _message: string): string {
  return "";
}

export function sendAlertNotification(_alert: unknown): Promise<void> {
  return Promise.resolve();
}

export function getAllTemplates(): AlertTemplate[] {
  return [];
}

export function setCustomTemplate(_template: AlertTemplate): void {
  // No-op
}
