/**
 * ethicsAuditor.ts — v93.0.0 "Ethical Reasoning & AI Safety"
 * Periodic ethics auditing system that reviews agent behavior for ethical compliance.
 */
export type AuditStatus = "pending" | "in_progress" | "completed" | "escalated";
export type ComplianceLevel = "compliant" | "minor_issues" | "major_issues" | "non_compliant";

export interface AuditFinding {
  findingId: string;
  category: string;
  description: string;
  severity: "info" | "warning" | "critical";
  evidence: string;
  recommendation: string;
}

export interface EthicsAudit {
  auditId: string;
  agentId: string;
  auditorId: string;
  period: { start: number; end: number };
  findings: AuditFinding[];
  complianceLevel: ComplianceLevel;
  overallScore: number;
  status: AuditStatus;
  summary: string;
  createdAt: number;
  completedAt: number | null;
}

const audits: EthicsAudit[] = [];
let auditCounter = 0;
let findingCounter = 0;

export function createAudit(agentId: string, auditorId: string, periodStart: number, periodEnd: number): EthicsAudit {
  const audit: EthicsAudit = {
    auditId: `ea-${++auditCounter}`,
    agentId, auditorId,
    period: { start: periodStart, end: periodEnd },
    findings: [], complianceLevel: "compliant",
    overallScore: 1.0, status: "pending",
    summary: "", createdAt: Date.now(), completedAt: null,
  };
  audits.push(audit);
  return audit;
}

export function addFinding(auditId: string, category: string, description: string, severity: AuditFinding["severity"], evidence: string, recommendation: string): AuditFinding | null {
  const audit = audits.find(a => a.auditId === auditId);
  if (!audit) return null;
  const finding: AuditFinding = { findingId: `af-${++findingCounter}`, category, description, severity, evidence, recommendation };
  audit.findings.push(finding);
  audit.status = "in_progress";
  return finding;
}

export function completeAudit(auditId: string, summary: string): EthicsAudit | null {
  const audit = audits.find(a => a.auditId === auditId);
  if (!audit) return null;

  const criticalCount = audit.findings.filter(f => f.severity === "critical").length;
  const warningCount = audit.findings.filter(f => f.severity === "warning").length;

  if (criticalCount > 0) { audit.complianceLevel = "non_compliant"; audit.overallScore = Math.max(0, 0.5 - criticalCount * 0.2); }
  else if (warningCount > 2) { audit.complianceLevel = "major_issues"; audit.overallScore = Math.max(0.3, 0.7 - warningCount * 0.05); }
  else if (warningCount > 0) { audit.complianceLevel = "minor_issues"; audit.overallScore = Math.max(0.6, 0.9 - warningCount * 0.05); }
  else { audit.complianceLevel = "compliant"; audit.overallScore = 1.0; }

  if (audit.overallScore < 0.4) audit.status = "escalated";
  else audit.status = "completed";

  audit.summary = summary;
  audit.completedAt = Date.now();
  return audit;
}

export function getAudits(agentId?: string, status?: AuditStatus): EthicsAudit[] {
  return audits.filter(a => (!agentId || a.agentId === agentId) && (!status || a.status === status));
}
export function _resetEthicsAuditorForTest(): void { audits.length = 0; auditCounter = 0; findingCounter = 0; }
