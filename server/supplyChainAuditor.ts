/**
 * supplyChainAuditor.ts — v76.0.0 "Supply Chain & Dependency Management"
 * Audits the software supply chain for integrity issues, typosquatting risks, and provenance gaps.
 */
export type AuditRiskLevel = "critical" | "high" | "medium" | "low" | "none";

export interface AuditFinding {
  findingId: string;
  packageName: string;
  riskLevel: AuditRiskLevel;
  category: "typosquatting" | "provenance" | "integrity" | "maintainer" | "age";
  description: string;
  recommendation: string;
}

export interface SupplyChainAuditReport {
  auditId: string;
  projectName: string;
  findings: AuditFinding[];
  riskScore: number;
  overallRisk: AuditRiskLevel;
  generatedAt: number;
}

const auditHistory: SupplyChainAuditReport[] = [];
let auditCounter = 0;
let findingCounter = 0;

const KNOWN_TYPOSQUATS: Record<string, string> = {
  "lodash": "lodahs", "express": "expres", "react": "reakt",
  "axios": "axois", "moment": "momet", "webpack": "webpak",
};

function computeRiskScore(findings: AuditFinding[]): number {
  const weights: Record<AuditRiskLevel, number> = { critical: 40, high: 20, medium: 10, low: 5, none: 0 };
  return Math.min(findings.reduce((sum, f) => sum + weights[f.riskLevel], 0), 100);
}

function scoreToRisk(score: number): AuditRiskLevel {
  if (score >= 70) return "critical";
  if (score >= 40) return "high";
  if (score >= 20) return "medium";
  if (score > 0) return "low";
  return "none";
}

export function auditSupplyChain(projectName: string, packages: Array<{ name: string; version: string; publishedDaysAgo?: number; hasProvenance?: boolean }>): SupplyChainAuditReport {
  const findings: AuditFinding[] = [];

  for (const pkg of packages) {
    // Typosquatting check
    for (const [legit, squatted] of Object.entries(KNOWN_TYPOSQUATS)) {
      if (pkg.name === squatted) {
        findings.push({ findingId: `finding-${++findingCounter}`, packageName: pkg.name, riskLevel: "critical", category: "typosquatting", description: `Package "${pkg.name}" appears to be a typosquat of "${legit}"`, recommendation: `Replace with the legitimate package "${legit}"` });
      }
    }

    // Provenance check
    if (pkg.hasProvenance === false) {
      findings.push({ findingId: `finding-${++findingCounter}`, packageName: pkg.name, riskLevel: "medium", category: "provenance", description: `Package "${pkg.name}" lacks build provenance attestation`, recommendation: "Verify package integrity via checksums and consider requiring provenance" });
    }

    // Age check (very new packages are riskier)
    if (pkg.publishedDaysAgo !== undefined && pkg.publishedDaysAgo < 7) {
      findings.push({ findingId: `finding-${++findingCounter}`, packageName: pkg.name, riskLevel: "low", category: "age", description: `Package "${pkg.name}" was published only ${pkg.publishedDaysAgo} day(s) ago`, recommendation: "Wait for community vetting or pin to a well-established version" });
    }
  }

  const riskScore = computeRiskScore(findings);
  const report: SupplyChainAuditReport = {
    auditId: `audit-${++auditCounter}`,
    projectName, findings, riskScore,
    overallRisk: scoreToRisk(riskScore),
    generatedAt: Date.now(),
  };

  auditHistory.push(report);
  console.log(`[SupplyChainAuditor] Audit for ${projectName}: ${findings.length} findings, risk score ${riskScore}`);
  return report;
}

export function getAuditHistory(): SupplyChainAuditReport[] { return [...auditHistory]; }
export function _resetSupplyChainAuditorForTest(): void { auditHistory.length = 0; auditCounter = 0; findingCounter = 0; }
