/**
 * Alert type definitions for OSS version
 */

export type AlertSeverity = "info" | "warning" | "error" | "critical";
export type AlertStatus = "active" | "acknowledged" | "resolved";

export type Alert = {
  id: string;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  message: string;
  timestamp: number;
  acknowledgedAt?: number;
};

export type AlertRule = {
  id: string;
  name: string;
  condition: string;
  severity: AlertSeverity;
  enabled: boolean;
};

export type AlertEventFilter = {
  severity?: AlertSeverity[];
  status?: AlertStatus[];
  from?: number;
  to?: number;
  fromDate?: string;
  toDate?: string;
  ruleId?: string;
  limit?: number;
};
