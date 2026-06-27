/**
 * featureAuditLog.ts — v77.0.0 "Feature Flags & Experimentation"
 * Immutable audit log for all feature flag and experiment changes.
 */
export type AuditAction = "create" | "update" | "enable" | "disable" | "delete" | "rollback" | "promote";
export type AuditEntityType = "feature_flag" | "experiment" | "canary" | "rollout";

export interface AuditEntry {
  entryId: string;
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  actor: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string;
  timestamp: number;
}

const auditLog: AuditEntry[] = [];
let entryCounter = 0;

export function logAuditEntry(params: {
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  actor: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string;
}): AuditEntry {
  const entry: AuditEntry = {
    entryId: `audit-${++entryCounter}`,
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    actor: params.actor,
    before: params.before ?? null,
    after: params.after ?? null,
    reason: params.reason ?? "",
    timestamp: Date.now(),
  };
  auditLog.push(entry);
  return entry;
}

export function getAuditLog(): AuditEntry[] { return [...auditLog]; }

export function getAuditLogForEntity(entityId: string): AuditEntry[] {
  return auditLog.filter(e => e.entityId === entityId);
}

export function getAuditLogByActor(actor: string): AuditEntry[] {
  return auditLog.filter(e => e.actor === actor);
}

export function getAuditLogByAction(action: AuditAction): AuditEntry[] {
  return auditLog.filter(e => e.action === action);
}

export function _resetFeatureAuditLogForTest(): void { auditLog.length = 0; entryCounter = 0; }
