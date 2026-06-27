import { createLogger } from "./logger.js";
const log = createLogger("GdprComplianceChecker");
/**
 * gdprComplianceChecker.ts — v74.0.0 "Privacy & Data Protection"
 * Checks data processing operations for GDPR compliance: lawful basis, data minimization, purpose limitation.
 */
export type LawfulBasis = "consent" | "contract" | "legal_obligation" | "vital_interests" | "public_task" | "legitimate_interests";

export interface ComplianceCheck {
  checkId: string;
  operation: string;
  lawfulBasis: LawfulBasis;
  hasConsent: boolean;
  dataMinimized: boolean;
  purposeLimited: boolean;
  retentionDefined: boolean;
  compliant: boolean;
  violations: string[];
  checkedAt: number;
}

const checkHistory: ComplianceCheck[] = [];
let checkCounter = 0;

export function checkGdprCompliance(params: {
  operation: string;
  lawfulBasis: LawfulBasis;
  hasConsent: boolean;
  dataMinimized: boolean;
  purposeLimited: boolean;
  retentionDefined: boolean;
}): ComplianceCheck {
  const violations: string[] = [];

  if (params.lawfulBasis === "consent" && !params.hasConsent) violations.push("Consent required but not obtained");
  if (!params.dataMinimized) violations.push("Data minimization principle violated");
  if (!params.purposeLimited) violations.push("Purpose limitation principle violated");
  if (!params.retentionDefined) violations.push("Retention period not defined");

  const check: ComplianceCheck = {
    checkId: `gdpr-check-${++checkCounter}`,
    operation: params.operation,
    lawfulBasis: params.lawfulBasis,
    hasConsent: params.hasConsent,
    dataMinimized: params.dataMinimized,
    purposeLimited: params.purposeLimited,
    retentionDefined: params.retentionDefined,
    compliant: violations.length === 0,
    violations,
    checkedAt: Date.now(),
  };

  checkHistory.push(check);
  if (!check.compliant) {
    log.info(`[GdprComplianceChecker] Non-compliant: ${params.operation} — ${violations.join("; ")}`);
  }
  return check;
}

export function getComplianceReport(): { total: number; compliant: number; nonCompliant: number; checks: ComplianceCheck[] } {
  const compliant = checkHistory.filter(c => c.compliant).length;
  return { total: checkHistory.length, compliant, nonCompliant: checkHistory.length - compliant, checks: [...checkHistory] };
}

export function _resetGdprComplianceCheckerForTest(): void { checkHistory.length = 0; checkCounter = 0; }
