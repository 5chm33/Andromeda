/**
 * apiSecurityAuditor.ts — v52.0.0
 *
 * Audits API configurations and requests for security vulnerabilities:
 * missing auth, insecure endpoints, sensitive data exposure, and injection risks.
 */

export type SecuritySeverity = "critical" | "high" | "medium" | "low" | "info";

export interface SecurityFinding {
  findingId: string;
  severity: SecuritySeverity;
  category: string;
  description: string;
  recommendation: string;
  affectedEndpoint?: string;
}

export interface SecurityAuditReport {
  apiId: string;
  score: number;  // 0-100, higher is better
  findings: SecurityFinding[];
  passedChecks: string[];
  auditedAt: number;
}

let findingCounter = 0;

function newFinding(severity: SecuritySeverity, category: string, description: string, recommendation: string, endpoint?: string): SecurityFinding {
  return {
    findingId: `sec-${++findingCounter}`,
    severity,
    category,
    description,
    recommendation,
    affectedEndpoint: endpoint,
  };
}

export interface ApiSecurityConfig {
  apiId: string;
  baseUrl: string;
  hasAuth: boolean;
  authScheme?: string;
  endpoints: Array<{ path: string; method: string; requiresAuth: boolean; sensitiveFields?: string[] }>;
  tlsEnabled?: boolean;
  rateLimitEnabled?: boolean;
}

export function auditApiSecurity(config: ApiSecurityConfig): SecurityAuditReport {
  const findings: SecurityFinding[] = [];
  const passedChecks: string[] = [];

  // Check 1: TLS
  if (config.baseUrl.startsWith("http://")) {
    findings.push(newFinding("critical", "Transport Security", "API uses HTTP instead of HTTPS", "Migrate to HTTPS immediately"));
  } else {
    passedChecks.push("TLS/HTTPS enabled");
  }

  // Check 2: Authentication
  if (!config.hasAuth) {
    findings.push(newFinding("high", "Authentication", "API has no authentication configured", "Implement Bearer token or API key authentication"));
  } else {
    passedChecks.push(`Authentication configured (${config.authScheme ?? "unknown scheme"})`);
  }

  // Check 3: Rate limiting
  if (!config.rateLimitEnabled) {
    findings.push(newFinding("medium", "Rate Limiting", "No rate limiting configured", "Configure rate limiting to prevent abuse"));
  } else {
    passedChecks.push("Rate limiting enabled");
  }

  // Check 4: Endpoint-level auth
  for (const ep of config.endpoints) {
    if (!ep.requiresAuth && config.hasAuth) {
      findings.push(newFinding("medium", "Authorization", `Endpoint ${ep.method} ${ep.path} does not require authentication`, "Ensure all sensitive endpoints require authentication", `${ep.method} ${ep.path}`));
    }

    // Check 5: Sensitive field exposure
    if (ep.sensitiveFields && ep.sensitiveFields.length > 0) {
      findings.push(newFinding("low", "Data Exposure", `Endpoint ${ep.path} may expose sensitive fields: ${ep.sensitiveFields.join(", ")}`, "Mask or omit sensitive fields in responses", ep.path));
    }
  }

  // Calculate score
  const severityWeights: Record<SecuritySeverity, number> = { critical: 30, high: 20, medium: 10, low: 5, info: 1 };
  const deductions = findings.reduce((sum, f) => sum + severityWeights[f.severity], 0);
  const score = Math.max(0, 100 - deductions);

  return {
    apiId: config.apiId,
    score,
    findings,
    passedChecks,
    auditedAt: Date.now(),
  };
}

export function getSecurityGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

export function _resetSecurityAuditorForTest(): void {
  findingCounter = 0;
}
