/**
 * v76.test.ts — Supply Chain & Dependency Management
 * Comprehensive tests for all 6 v76 modules.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { scanDependencies, getScanHistory, _resetDependencyScannerForTest } from "./dependencyScanner";
import { registerVulnerability, generateAdvisoryReport, getAdvisoryReports, _resetVulnerabilityAdvisorForTest } from "./vulnerabilityAdvisor";
import { checkLicenses, getLicenseReports, _resetLicenseCheckerForTest } from "./licenseChecker";
import { generateSbom, getSbomHistory, _resetSbomGeneratorForTest } from "./sbomGenerator";
import { auditSupplyChain, getAuditHistory, _resetSupplyChainAuditorForTest } from "./supplyChainAuditor";
import { analyzeDependencyGraph, getAnalysisHistory, _resetDependencyGraphAnalyzerForTest } from "./dependencyGraphAnalyzer";

// ─── dependencyScanner ───────────────────────────────────────────────────────
describe("dependencyScanner", () => {
  beforeEach(() => _resetDependencyScannerForTest());

  it("scans dependencies and counts direct vs transitive", () => {
    const result = scanDependencies("my-app", "npm", [
      { name: "express", version: "4.18.0", depType: "direct" },
      { name: "lodash", version: "4.17.21", depType: "transitive" },
      { name: "vitest", version: "1.0.0", depType: "dev" },
    ]);
    expect(result.projectName).toBe("my-app");
    expect(result.ecosystem).toBe("npm");
    expect(result.dependencies.length).toBe(3);
    expect(result.directCount).toBe(1);
    expect(result.transitiveCount).toBe(1);
  });

  it("uses version as resolvedVersion when not provided", () => {
    const result = scanDependencies("app", "pip", [{ name: "requests", version: "2.28.0", depType: "direct" }]);
    expect(result.dependencies[0].resolvedVersion).toBe("2.28.0");
  });

  it("accumulates scan history", () => {
    scanDependencies("app1", "npm", []);
    scanDependencies("app2", "pip", []);
    expect(getScanHistory().length).toBe(2);
  });

  it("resets cleanly", () => {
    scanDependencies("app", "npm", []);
    _resetDependencyScannerForTest();
    expect(getScanHistory().length).toBe(0);
  });
});

// ─── vulnerabilityAdvisor ────────────────────────────────────────────────────
describe("vulnerabilityAdvisor", () => {
  beforeEach(() => _resetVulnerabilityAdvisorForTest());

  it("finds vulnerability for affected package", () => {
    registerVulnerability({ cveId: "CVE-2023-0001", packageName: "lodash", affectedVersionRange: "<4.17.21", severity: "high", description: "Prototype pollution", fixedInVersion: "4.17.21" });
    const report = generateAdvisoryReport("my-app", [{ name: "lodash", version: "4.17.20" }]);
    expect(report.findings.length).toBe(1);
    expect(report.findings[0].cveId).toBe("CVE-2023-0001");
    expect(report.highCount).toBe(1);
  });

  it("does not flag non-affected versions", () => {
    registerVulnerability({ cveId: "CVE-2023-0002", packageName: "express", affectedVersionRange: "<4.18.0", severity: "medium", description: "XSS", fixedInVersion: "4.18.0" });
    const report = generateAdvisoryReport("my-app", [{ name: "express", version: "4.18.0" }]);
    expect(report.findings.length).toBe(0);
  });

  it("handles no vulnerabilities", () => {
    const report = generateAdvisoryReport("clean-app", [{ name: "safe-pkg", version: "1.0.0" }]);
    expect(report.findings.length).toBe(0);
    expect(report.criticalCount).toBe(0);
  });

  it("provides remediation advice", () => {
    registerVulnerability({ cveId: "CVE-2023-0003", packageName: "axios", affectedVersionRange: "0.21.0", severity: "critical", description: "SSRF", fixedInVersion: "0.21.1" });
    const report = generateAdvisoryReport("app", [{ name: "axios", version: "0.21.0" }]);
    expect(report.findings[0].remediation).toContain("0.21.1");
  });

  it("accumulates reports", () => {
    generateAdvisoryReport("app1", []);
    generateAdvisoryReport("app2", []);
    expect(getAdvisoryReports().length).toBe(2);
  });

  it("resets cleanly", () => {
    registerVulnerability({ cveId: "CVE-X", packageName: "x", affectedVersionRange: "1.0.0", severity: "low", description: "x", fixedInVersion: null });
    _resetVulnerabilityAdvisorForTest();
    expect(getAdvisoryReports().length).toBe(0);
  });
});

// ─── licenseChecker ──────────────────────────────────────────────────────────
describe("licenseChecker", () => {
  beforeEach(() => _resetLicenseCheckerForTest());

  it("marks MIT license as compatible", () => {
    const report = checkLicenses("app", [{ name: "lodash", version: "4.17.21", license: "MIT" }]);
    expect(report.compatibleCount).toBe(1);
    expect(report.incompatibleCount).toBe(0);
  });

  it("marks GPL-3.0 as incompatible", () => {
    const report = checkLicenses("app", [{ name: "gpl-pkg", version: "1.0.0", license: "GPL-3.0" }]);
    expect(report.incompatibleCount).toBe(1);
  });

  it("marks LGPL-2.1 as review required", () => {
    const report = checkLicenses("app", [{ name: "lgpl-pkg", version: "1.0.0", license: "LGPL-2.1" }]);
    expect(report.reviewRequiredCount).toBe(1);
  });

  it("marks unknown license as unknown", () => {
    const report = checkLicenses("app", [{ name: "weird-pkg", version: "1.0.0", license: "CUSTOM-1.0" }]);
    expect(report.unknownCount).toBe(1);
  });

  it("handles mixed licenses", () => {
    const report = checkLicenses("app", [
      { name: "a", version: "1.0.0", license: "MIT" },
      { name: "b", version: "1.0.0", license: "GPL-3.0" },
      { name: "c", version: "1.0.0", license: "LGPL-2.1" },
    ]);
    expect(report.compatibleCount).toBe(1);
    expect(report.incompatibleCount).toBe(1);
    expect(report.reviewRequiredCount).toBe(1);
  });

  it("resets cleanly", () => {
    checkLicenses("app", [{ name: "x", version: "1.0.0", license: "MIT" }]);
    _resetLicenseCheckerForTest();
    expect(getLicenseReports().length).toBe(0);
  });
});

// ─── sbomGenerator ───────────────────────────────────────────────────────────
describe("sbomGenerator", () => {
  beforeEach(() => _resetSbomGeneratorForTest());

  it("generates a valid SBOM", () => {
    const sbom = generateSbom("my-app", "1.0.0", [
      { name: "lodash", version: "4.17.21", ecosystem: "npm", licenses: ["MIT"] },
      { name: "express", version: "4.18.0", ecosystem: "npm", licenses: ["MIT"] },
    ]);
    expect(sbom.specVersion).toBe("1.4");
    expect(sbom.metadata.component.name).toBe("my-app");
    expect(sbom.components.length).toBe(2);
    expect(sbom.components[0].purl).toContain("pkg:npm/lodash@4.17.21");
  });

  it("generates unique serial numbers", () => {
    const s1 = generateSbom("app1", "1.0.0", []);
    const s2 = generateSbom("app2", "1.0.0", []);
    expect(s1.serialNumber).not.toBe(s2.serialNumber);
  });

  it("handles empty component list", () => {
    const sbom = generateSbom("empty-app", "0.1.0", []);
    expect(sbom.components.length).toBe(0);
  });

  it("accumulates SBOM history", () => {
    generateSbom("a", "1.0.0", []);
    generateSbom("b", "1.0.0", []);
    expect(getSbomHistory().length).toBe(2);
  });

  it("resets cleanly", () => {
    generateSbom("x", "1.0.0", []);
    _resetSbomGeneratorForTest();
    expect(getSbomHistory().length).toBe(0);
  });
});

// ─── supplyChainAuditor ──────────────────────────────────────────────────────
describe("supplyChainAuditor", () => {
  beforeEach(() => _resetSupplyChainAuditorForTest());

  it("detects typosquatting", () => {
    const report = auditSupplyChain("app", [{ name: "lodahs", version: "4.17.21" }]);
    expect(report.findings.some(f => f.category === "typosquatting")).toBe(true);
    expect(["critical", "high"]).toContain(report.overallRisk);
  });

  it("flags packages without provenance", () => {
    const report = auditSupplyChain("app", [{ name: "safe-pkg", version: "1.0.0", hasProvenance: false }]);
    expect(report.findings.some(f => f.category === "provenance")).toBe(true);
  });

  it("flags very new packages", () => {
    const report = auditSupplyChain("app", [{ name: "new-pkg", version: "0.0.1", publishedDaysAgo: 2 }]);
    expect(report.findings.some(f => f.category === "age")).toBe(true);
  });

  it("returns no findings for clean packages", () => {
    const report = auditSupplyChain("app", [{ name: "lodash", version: "4.17.21", hasProvenance: true, publishedDaysAgo: 365 }]);
    expect(report.findings.length).toBe(0);
    expect(report.overallRisk).toBe("none");
  });

  it("accumulates audit history", () => {
    auditSupplyChain("app1", []);
    auditSupplyChain("app2", []);
    expect(getAuditHistory().length).toBe(2);
  });

  it("resets cleanly", () => {
    auditSupplyChain("app", []);
    _resetSupplyChainAuditorForTest();
    expect(getAuditHistory().length).toBe(0);
  });
});

// ─── dependencyGraphAnalyzer ─────────────────────────────────────────────────
describe("dependencyGraphAnalyzer", () => {
  beforeEach(() => _resetDependencyGraphAnalyzerForTest());

  it("analyzes a simple linear graph", () => {
    const result = analyzeDependencyGraph([
      { from: "A", to: "B" },
      { from: "B", to: "C" },
    ]);
    expect(result.nodeCount).toBe(3);
    expect(result.edgeCount).toBe(2);
    expect(result.maxDepth).toBe(2);
    expect(result.cycles.length).toBe(0);
  });

  it("detects cycles in the graph", () => {
    const result = analyzeDependencyGraph([
      { from: "A", to: "B" },
      { from: "B", to: "C" },
      { from: "C", to: "A" },
    ]);
    expect(result.cycles.length).toBeGreaterThan(0);
  });

  it("identifies critical nodes by out-degree", () => {
    const result = analyzeDependencyGraph([
      { from: "hub", to: "A" },
      { from: "hub", to: "B" },
      { from: "hub", to: "C" },
      { from: "leaf", to: "D" },
    ]);
    expect(result.criticalNodes[0]).toBe("hub");
  });

  it("handles empty graph", () => {
    const result = analyzeDependencyGraph([]);
    expect(result.nodeCount).toBe(0);
    expect(result.edgeCount).toBe(0);
  });

  it("accumulates analysis history", () => {
    analyzeDependencyGraph([{ from: "A", to: "B" }]);
    analyzeDependencyGraph([{ from: "C", to: "D" }]);
    expect(getAnalysisHistory().length).toBe(2);
  });

  it("resets cleanly", () => {
    analyzeDependencyGraph([{ from: "A", to: "B" }]);
    _resetDependencyGraphAnalyzerForTest();
    expect(getAnalysisHistory().length).toBe(0);
  });
});
