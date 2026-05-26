/**
 * dependencyAuditor.ts — Andromeda v5.68
 *
 * Background daemon that audits dependencies for:
 *  - Known CVEs and security vulnerabilities
 *  - Outdated packages with available updates
 *  - Deprecated packages that need replacement
 *
 * Runs every 6 hours (configurable via DEPENDENCY_AUDIT_INTERVAL env var).
 * Generates fix proposals that can be auto-applied or queued for review.
 */

import { execSync } from "child_process";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import * as path from "path";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VulnerabilityReport {
  timestamp: number;
  totalVulnerabilities: number;
  critical: number;
  high: number;
  moderate: number;
  low: number;
  vulnerabilities: Vulnerability[];
  outdatedPackages: OutdatedPackage[];
  fixProposals: FixProposal[];
}

export interface Vulnerability {
  name: string;
  severity: "critical" | "high" | "moderate" | "low";
  title: string;
  url?: string;
  fixAvailable: boolean;
  currentVersion: string;
  fixedVersion?: string;
}

export interface OutdatedPackage {
  name: string;
  current: string;
  wanted: string;
  latest: string;
  type: "dependencies" | "devDependencies";
}

export interface FixProposal {
  id: string;
  type: "security_patch" | "version_bump" | "replacement";
  package: string;
  currentVersion: string;
  proposedVersion: string;
  severity: "critical" | "high" | "moderate" | "low";
  autoFixable: boolean;
  command: string;
  rationale: string;
}

// ─── Configuration ──────────────────────────────────────────────────────────

const AUDIT_INTERVAL_MS = parseInt(process.env.DEPENDENCY_AUDIT_INTERVAL || "21600000", 10); // 6 hours
const PROJECT_ROOT = process.cwd();
const REPORT_PATH = path.join(PROJECT_ROOT, ".data", "dependency_audit.json");

// ─── State ──────────────────────────────────────────────────────────────────

let _running = false;
let _intervalId: ReturnType<typeof setInterval> | null = null;
let _lastReport: VulnerabilityReport | null = null;

// ─── Audit Functions ────────────────────────────────────────────────────────

function runNpmAudit(): { vulnerabilities: Vulnerability[]; counts: Record<string, number> } {
  const vulnerabilities: Vulnerability[] = [];
  const counts = { critical: 0, high: 0, moderate: 0, low: 0 };

  try {
    // Run npm audit in JSON format
    const result = execSync("npm audit --json", {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      timeout: 60_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const audit = JSON.parse(result || "{}");

    if (audit.vulnerabilities) {
      for (const [name, data] of Object.entries(audit.vulnerabilities) as [string, any][]) {
        const severity = data.severity || "low";
        counts[severity as keyof typeof counts] = (counts[severity as keyof typeof counts] || 0) + 1;
        vulnerabilities.push({
          name,
          severity,
          title: data.via?.[0]?.title || data.via?.[0] || "Unknown vulnerability",
          url: data.via?.[0]?.url,
          fixAvailable: !!data.fixAvailable,
          currentVersion: data.range || "unknown",
          fixedVersion: typeof data.fixAvailable === "object" ? data.fixAvailable.version : undefined,
        });
      }
    }
  } catch (err) {
    console.warn("[DependencyAuditor] npm audit failed:", String(err).slice(0, 200));
  }

  return { vulnerabilities, counts };
}

function checkOutdatedPackages(): OutdatedPackage[] {
  const outdated: OutdatedPackage[] = [];

  try {
    const result = execSync("npm outdated --json", {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      timeout: 60_000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const data = JSON.parse(result || "{}");
    for (const [name, info] of Object.entries(data) as [string, any][]) {
      outdated.push({
        name,
        current: info.current || "unknown",
        wanted: info.wanted || "unknown",
        latest: info.latest || "unknown",
        type: info.type === "devDependencies" ? "devDependencies" : "dependencies",
      });
    }
  } catch (err) {
    console.warn("[DependencyAuditor] npm outdated failed:", String(err).slice(0, 200));
  }

  return outdated;
}

function generateFixProposals(
  vulnerabilities: Vulnerability[],
  outdated: OutdatedPackage[]
): FixProposal[] {
  const proposals: FixProposal[] = [];

  // Security fix proposals
  for (const vuln of vulnerabilities.filter(v => v.fixAvailable)) {
    proposals.push({
      id: `fix_${vuln.name}_${Date.now()}`,
      type: "security_patch",
      package: vuln.name,
      currentVersion: vuln.currentVersion,
      proposedVersion: vuln.fixedVersion || "latest",
      severity: vuln.severity,
      autoFixable: vuln.severity === "critical" || vuln.severity === "high",
      command: `npm audit fix --force`,
      rationale: `Security vulnerability (${vuln.severity}): ${vuln.title}`,
    });
  }

  // Version bump proposals for outdated packages (only major/minor bumps)
  for (const pkg of outdated) {
    if (pkg.current === pkg.latest) continue;
    const isMajor = pkg.current.split(".")[0] !== pkg.latest.split(".")[0];
    proposals.push({
      id: `bump_${pkg.name}_${Date.now()}`,
      type: "version_bump",
      package: pkg.name,
      currentVersion: pkg.current,
      proposedVersion: isMajor ? pkg.wanted : pkg.latest,
      severity: isMajor ? "moderate" : "low",
      autoFixable: !isMajor, // Only auto-fix minor/patch bumps
      command: isMajor ? `npm install ${pkg.name}@${pkg.wanted}` : `npm install ${pkg.name}@${pkg.latest}`,
      rationale: `Package outdated: ${pkg.current} → ${pkg.latest}${isMajor ? " (MAJOR version change — review needed)" : ""}`,
    });
  }

  return proposals;
}

// ─── Full Audit ─────────────────────────────────────────────────────────────

export function runFullAudit(): VulnerabilityReport {
  console.log("[DependencyAuditor] Running full dependency audit...");

  const { vulnerabilities, counts } = runNpmAudit();
  const outdated = checkOutdatedPackages();
  const fixProposals = generateFixProposals(vulnerabilities, outdated);

  const report: VulnerabilityReport = {
    timestamp: Date.now(),
    totalVulnerabilities: vulnerabilities.length,
    critical: counts.critical || 0,
    high: counts.high || 0,
    moderate: counts.moderate || 0,
    low: counts.low || 0,
    vulnerabilities,
    outdatedPackages: outdated,
    fixProposals,
  };

  // Save report
  try {
    const dir = path.dirname(REPORT_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  } catch { /* non-fatal */ }

  _lastReport = report;

  const criticalCount = counts.critical + counts.high;
  if (criticalCount > 0) {
    console.warn(`[DependencyAuditor] ⚠️ ${criticalCount} critical/high vulnerabilities found!`);
  } else {
    console.log(`[DependencyAuditor] ✓ No critical vulnerabilities. ${outdated.length} packages outdated.`);
  }

  return report;
}

// ─── Daemon Control ─────────────────────────────────────────────────────────

export function startDependencyAuditor(): void {
  if (_running) return;
  _running = true;

  // Run initial audit after 30 seconds
  setTimeout(() => {
    try { runFullAudit(); } catch (err) { console.warn("[DependencyAuditor] Initial audit failed:", err); }
  }, 30_000);

  _intervalId = setInterval(() => {
    try { runFullAudit(); } catch (err) { console.warn("[DependencyAuditor] Audit failed:", err); }
  }, AUDIT_INTERVAL_MS);

  console.log(`[DependencyAuditor] Started — auditing every ${AUDIT_INTERVAL_MS / 3600000} hours`);
}

export function stopDependencyAuditor(): void {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
  _running = false;
}

export function getLastAuditReport(): VulnerabilityReport | null {
  if (_lastReport) return _lastReport;
  try {
    if (existsSync(REPORT_PATH)) {
      return JSON.parse(readFileSync(REPORT_PATH, "utf8"));
    }
  } catch { /* ignore */ }
  return null;
}

export function isRunning(): boolean {
  return _running;
}
