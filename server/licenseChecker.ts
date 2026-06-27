import { createLogger } from "./logger.js";
const log = createLogger("LicenseChecker");
/**
 * licenseChecker.ts — v76.0.0 "Supply Chain & Dependency Management"
 * Checks dependency licenses for compatibility with the project's license policy.
 */
export type LicenseCompatibility = "compatible" | "incompatible" | "review_required" | "unknown";

export interface LicensePolicy {
  allowedLicenses: string[];
  incompatibleLicenses: string[];
  reviewRequiredLicenses: string[];
}

export interface LicenseCheckResult {
  packageName: string;
  version: string;
  license: string;
  compatibility: LicenseCompatibility;
  reason: string;
}

export interface LicenseReport {
  reportId: string;
  projectName: string;
  results: LicenseCheckResult[];
  compatibleCount: number;
  incompatibleCount: number;
  reviewRequiredCount: number;
  unknownCount: number;
  generatedAt: number;
}

const reports: LicenseReport[] = [];
let reportCounter = 0;

const DEFAULT_POLICY: LicensePolicy = {
  allowedLicenses: ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "CC0-1.0"],
  incompatibleLicenses: ["GPL-2.0", "GPL-3.0", "AGPL-3.0", "SSPL-1.0"],
  reviewRequiredLicenses: ["LGPL-2.1", "LGPL-3.0", "MPL-2.0", "CDDL-1.0"],
};

export function checkLicenses(projectName: string, packages: Array<{ name: string; version: string; license: string }>, policy: LicensePolicy = DEFAULT_POLICY): LicenseReport {
  const results: LicenseCheckResult[] = packages.map(pkg => {
    let compatibility: LicenseCompatibility;
    let reason: string;

    if (policy.allowedLicenses.includes(pkg.license)) {
      compatibility = "compatible";
      reason = `License "${pkg.license}" is explicitly allowed`;
    } else if (policy.incompatibleLicenses.includes(pkg.license)) {
      compatibility = "incompatible";
      reason = `License "${pkg.license}" is incompatible with project license policy`;
    } else if (policy.reviewRequiredLicenses.includes(pkg.license)) {
      compatibility = "review_required";
      reason = `License "${pkg.license}" requires legal review before use`;
    } else {
      compatibility = "unknown";
      reason = `License "${pkg.license}" is not in the policy — manual review recommended`;
    }

    return { packageName: pkg.name, version: pkg.version, license: pkg.license, compatibility, reason };
  });

  const report: LicenseReport = {
    reportId: `license-report-${++reportCounter}`,
    projectName,
    results,
    compatibleCount: results.filter(r => r.compatibility === "compatible").length,
    incompatibleCount: results.filter(r => r.compatibility === "incompatible").length,
    reviewRequiredCount: results.filter(r => r.compatibility === "review_required").length,
    unknownCount: results.filter(r => r.compatibility === "unknown").length,
    generatedAt: Date.now(),
  };

  reports.push(report);
  log.info(`[LicenseChecker] License report for ${projectName}: ${report.incompatibleCount} incompatible, ${report.reviewRequiredCount} review required`);
  return report;
}

export function getLicenseReports(): LicenseReport[] { return [...reports]; }
export function _resetLicenseCheckerForTest(): void { reports.length = 0; reportCounter = 0; }
