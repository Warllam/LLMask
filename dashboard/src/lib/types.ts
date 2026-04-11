export type ClassValue = string | boolean | null | undefined | ClassValue[];

// --- API Types ---

export type MappingKind = "org" | "svc" | "tbl" | "col" | "idn";

export interface MappingEntry {
  scopeId: string;
  kind: MappingKind;
  originalValue: string;
  pseudonym: string;
  createdAt: string;
}

export interface RequestLogEntry {
  id: number;
  traceId: string;
  requestId: string;
  endpoint: string;
  model: string | null;
  originalBody: string;
  rewrittenBody: string;
  responseBody: string | null;
  transformedCount: number;
  createdAt: string;
}

export interface SessionSummary {
  traceId: string;
  title: string;
  requestCount: number;
  totalTransforms: number;
  models: string[];
  firstRequestAt: string;
  lastRequestAt: string;
  previewMessage: string | null;
}

export interface DashboardStats {
  totalMappings: number;
  totalRequests: number;
  totalTransforms: number;
  mappingsByKind: Record<string, number>;
  requestsByEndpoint: Record<string, number>;
  recentActivity: Array<{ date: string; count: number }>;
  topTokens: Array<{
    originalValue: string;
    pseudonym: string;
    kind: string;
    occurrences: number;
  }>;
}

export interface DsiStats {
  totalRequests: number;
  totalTransforms: number;
  totalEntities: number;
  entitiesByKind: Record<string, number>;
  requestsByDay: Array<{ date: string; count: number }>;
  requestsByModel: Record<string, number>;
  requestsByEndpoint: Record<string, number>;
  avgTransformsPerRequest: number;
  sessions: number;
  sampleMappings: Array<{
    kind: string;
    original: string;
    pseudonym: string;
  }>;
}

export interface LeakContext {
  value: string;
  pseudonym?: string;
  originalValue?: string;
  context: string;
  position: number;
  bodyType: "request" | "response";
}

export interface LeakDetail {
  requestId: string;
  traceId: string;
  endpoint: string;
  createdAt: string;
  leakedOriginals: LeakContext[];
  leakedPseudonyms: LeakContext[];
  leakedShieldTerms: LeakContext[];
}

export interface LeakReport {
  totalRequestsScanned: number;
  requestLeaks: number;
  responseLeaks: number;
  shieldLeaks: number;
  leakDetails: LeakDetail[];
}

export interface AlertRule {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  severity: "info" | "warning" | "critical";
  threshold: number;
  windowMinutes: number;
  channels: string[];
  cooldownMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export interface AlertEvent {
  id: number;
  ruleId: string;
  ruleName: string;
  severity: "info" | "warning" | "critical";
  status: "firing" | "resolved";
  message: string;
  value: number;
  threshold: number;
  firedAt: string;
  resolvedAt: string | null;
}

export interface LiveMaskingEvent {
  type: "masking";
  timestamp: string;
  endpoint: string;
  model: string;
  transformedCount: number;
  entityKinds: string[];
  scopeId: string;
  preview: string;
}

export interface LiveAlertEvent {
  eventType: "alert";
  type: "firing" | "resolved";
  id: number;
  ruleId: string;
  ruleName: string;
  severity: "info" | "warning" | "critical";
  message: string;
  value: number;
  threshold: number;
  firedAt: string;
  resolvedAt?: string;
}

export type LiveEvent = LiveMaskingEvent | LiveAlertEvent;

export interface ChatPreviewResult {
  original: string;
  masked: string;
  entities: Array<{ original: string; pseudonym: string; kind: string }>;
}

export interface AlertRuleConfig {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  severity: "info" | "warning" | "critical";
  threshold: number;
  windowMinutes: number;
  channels: string[];
  cooldownMinutes: number;
  lastFiredAt: string | null;
  acknowledged: boolean;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

export interface ConfigInfo {
  environment: Record<string, string>;
  providers: Array<{
    name: string;
    enabled: boolean;
    status: "connected" | "degraded" | "disconnected";
    latencyMs: number | null;
  }>;
  features: Record<string, boolean>;
  version: string;
  uptime: number;
}

export interface LatencyStats {
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  min: number;
  max: number;
}

export interface ActivityEntry {
  id: string;
  timestamp: string;
  provider: string;
  endpoint: string;
  model: string;
  entitiesMasked: number;
  entityKinds: string[];
  latencyMs: number;
  status: "success" | "error";
}

export type View = "welcome" | "conversation" | "chat" | "activity" | "config" | "health" | "gdpr" | "settings" | "requestlog" | "custom-rules";

export type MaskingStrategy = "pseudonymization" | "redaction" | "generalization" | "tokenization";

export interface AppSettings {
  maskingStrategy: MaskingStrategy;
  retentionDays: number;
  provider: string;
  defaultModel: string;
}

export interface ProviderInfo {
  id: string;
  label: string;
  description: string;
  authMode: string;
  configured: boolean;
  active: boolean;
}

export interface ProvidersResponse {
  providers: ProviderInfo[];
  activeProvider: string;
  defaultModel: string;
}

export interface ModelInfo {
  id: string;
  label: string;
  provider?: string;
}

// ── GDPR Types ────────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  id: number;
  timestamp: string;
  maskedCount: number;
  strategy: string;
  provider: string;
  categories: string[];
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuditLogQuery {
  page?: number;
  pageSize?: number;
  dateFrom?: string;
  dateTo?: string;
  strategy?: string;
  provider?: string;
}

export interface GdprEvent {
  id: number;
  timestamp: string;
  eventType: "erasure" | "export" | "retention_cleanup";
  affectedCount: number;
  searchTerm?: string;
  details: string;
}

export interface RetentionInfo {
  retentionDays: number;
  enabled: boolean;
  envVar: string;
  description: string;
}

export interface EraseResult {
  ok: boolean;
  deletedMappings: number;
  deletedRequests: number;
  deletedSessions: number;
}

// ── Custom Rules Types ────────────────────────────────────────────────────────

export interface CustomRule {
  id: number;
  name: string;
  pattern: string;
  replacementPrefix: string;
  category: string;
  enabled: boolean;
  createdAt: string;
}

export interface TestRuleResult {
  valid: boolean;
  matches: string[];
  preview: string;
  error?: string;
}
