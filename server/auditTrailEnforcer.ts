/**
 * auditTrailEnforcer.ts — v62.0.0 "The Security Vault"
 * Immutable audit trail with tamper detection and compliance reporting.
 */

export type AuditEventType = "access" | "modification" | "deletion" | "authentication" | "authorization" | "error";
export interface AuditEntry { entryId: string; timestamp: number; userId: string; eventType: AuditEventType; resource: string; outcome: "success" | "failure"; details: string; checksum: string; }
export interface ComplianceReport { reportId: string; period: { from: number; to: number }; totalEvents: number; failureRate: number; topUsers: string[]; eventBreakdown: Record<AuditEventType, number>; }

const trail: AuditEntry[] = [];
let eCounter = 0, rCounter = 0;

function simpleChecksum(data: string): string {
  return data.split("").reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) & 0xFFFFFF, 0).toString(16);
}

export function logAuditEvent(userId: string, eventType: AuditEventType, resource: string, outcome: "success" | "failure", details = ""): AuditEntry {
  const entry: Omit<AuditEntry, "checksum"> = { entryId: `aud-${++eCounter}`, timestamp: Date.now(), userId, eventType, resource, outcome, details };
  const checksum = simpleChecksum(JSON.stringify(entry));
  const full: AuditEntry = { ...entry, checksum };
  trail.push(full);
  return full;
}

export function verifyTrailIntegrity(): boolean {
  return trail.every(entry => {
    const { checksum, ...rest } = entry;
    return simpleChecksum(JSON.stringify(rest)) === checksum;
  });
}

export function generateComplianceReport(from: number, to: number): ComplianceReport {
  const period = trail.filter(e => e.timestamp >= from && e.timestamp <= to);
  const failures = period.filter(e => e.outcome === "failure").length;
  const userCounts = period.reduce<Record<string, number>>((m, e) => { m[e.userId] = (m[e.userId] ?? 0) + 1; return m; }, {});
  const topUsers = Object.entries(userCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([u]) => u);
  const breakdown = period.reduce<Record<AuditEventType, number>>((m, e) => { m[e.eventType] = (m[e.eventType] ?? 0) + 1; return m; }, {} as Record<AuditEventType, number>);
  return { reportId: `rep-${++rCounter}`, period: { from, to }, totalEvents: period.length, failureRate: period.length > 0 ? failures / period.length : 0, topUsers, eventBreakdown: breakdown };
}

export function getTrail(): AuditEntry[] { return [...trail]; }
export function _resetAuditTrailEnforcerForTest(): void { trail.length = 0; eCounter = 0; rCounter = 0; }
