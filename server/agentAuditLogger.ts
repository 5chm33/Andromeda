/**
 * agentAuditLogger.ts — v49.0.0
 *
 * Immutable append-only audit log for all agent actions, decisions, and
 * state changes. Supports structured querying and tamper detection.
 */

export type AuditEventType =
  | "action"
  | "decision"
  | "state_change"
  | "error"
  | "security"
  | "performance"
  | "lifecycle";

export interface AuditEvent {
  eventId: string;
  agentId: string;
  type: AuditEventType;
  summary: string;
  details: Record<string, unknown>;
  checksum: string;
  timestamp: number;
  sessionId?: string;
}

const log: AuditEvent[] = [];
let eventCounter = 0;

function computeChecksum(event: Omit<AuditEvent, "checksum">): string {
  const str = JSON.stringify({ id: event.eventId, agentId: event.agentId, summary: event.summary, ts: event.timestamp });
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

export function logEvent(
  agentId: string,
  type: AuditEventType,
  summary: string,
  details: Record<string, unknown> = {},
  sessionId?: string
): AuditEvent {
  const partial = {
    eventId: `audit-${++eventCounter}-${Date.now()}`,
    agentId,
    type,
    summary,
    details,
    timestamp: Date.now(),
    sessionId,
  };
  const event: AuditEvent = { ...partial, checksum: computeChecksum(partial) };
  log.push(event);
  return event;
}

export function queryLog(filters: {
  agentId?: string;
  type?: AuditEventType;
  since?: number;
  until?: number;
  limit?: number;
}): AuditEvent[] {
  let results = [...log];
  if (filters.agentId) results = results.filter(e => e.agentId === filters.agentId);
  if (filters.type) results = results.filter(e => e.type === filters.type);
  if (filters.since) results = results.filter(e => e.timestamp >= filters.since!);
  if (filters.until) results = results.filter(e => e.timestamp <= filters.until!);
  if (filters.limit) results = results.slice(-filters.limit);
  return results;
}

export function verifyIntegrity(): { valid: boolean; tamperedCount: number } {
  let tamperedCount = 0;
  for (const event of log) {
    const { checksum, ...rest } = event;
    const expected = computeChecksum(rest);
    if (expected !== checksum) tamperedCount++;
  }
  return { valid: tamperedCount === 0, tamperedCount };
}

export function getEventCount(agentId?: string): number {
  return agentId ? log.filter(e => e.agentId === agentId).length : log.length;
}

export function _resetAuditLoggerForTest(): void {
  log.length = 0;
  eventCounter = 0;
}
