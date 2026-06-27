import { createLogger } from "./logger.js";
const log = createLogger("DependencyScanner");
/**
 * dependencyScanner.ts — v76.0.0 "Supply Chain & Dependency Management"
 * Scans project dependency manifests and produces a normalized dependency inventory.
 */
export type DependencyType = "direct" | "transitive" | "dev" | "peer" | "optional";
export type EcosystemType = "npm" | "pip" | "maven" | "cargo" | "go" | "nuget" | "gem";

export interface Dependency {
  name: string;
  version: string;
  ecosystem: EcosystemType;
  depType: DependencyType;
  resolvedVersion: string | null;
}

export interface ScanResult {
  scanId: string;
  projectName: string;
  ecosystem: EcosystemType;
  dependencies: Dependency[];
  directCount: number;
  transitiveCount: number;
  scannedAt: number;
}

const scanHistory: ScanResult[] = [];
let scanCounter = 0;

export function scanDependencies(projectName: string, ecosystem: EcosystemType, rawDependencies: Array<{ name: string; version: string; depType: DependencyType; resolvedVersion?: string }>): ScanResult {
  const dependencies: Dependency[] = rawDependencies.map(dep => ({
    name: dep.name,
    version: dep.version,
    ecosystem,
    depType: dep.depType,
    resolvedVersion: dep.resolvedVersion ?? dep.version,
  }));

  const result: ScanResult = {
    scanId: `scan-${++scanCounter}`,
    projectName,
    ecosystem,
    dependencies,
    directCount: dependencies.filter(d => d.depType === "direct").length,
    transitiveCount: dependencies.filter(d => d.depType === "transitive").length,
    scannedAt: Date.now(),
  };

  scanHistory.push(result);
  log.info(`[DependencyScanner] Scanned ${projectName}: ${dependencies.length} dependencies (${result.directCount} direct, ${result.transitiveCount} transitive)`);
  return result;
}

export function getScanHistory(): ScanResult[] { return [...scanHistory]; }
export function _resetDependencyScannerForTest(): void { scanHistory.length = 0; scanCounter = 0; }
