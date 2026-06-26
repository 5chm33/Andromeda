/**
 * dependencyUpdateRsi.ts — v18.0.0
 *
 * Extends the RSI loop to propose and apply package.json dependency updates.
 * Checks npm registry for outdated packages, generates proposals with
 * changelogs, applies updates via `pnpm update`, and runs the test suite
 * as a gate before accepting the update.
 *
 * This closes the loop on a critical blind spot: the RSI system was improving
 * source code but never updating its own dependencies, leaving known security
 * patches and performance improvements on the table.
 *
 * Exported API:
 *   initDependencyUpdateRsi()           → void
 *   scanOutdatedDependencies()          → Promise<OutdatedPackage[]>
 *   generateDependencyProposal()        → Promise<DependencyProposal | null>
 *   applyDependencyUpdate(proposal)     → Promise<DependencyUpdateResult>
 *   getDependencyRsiStats()             → DependencyRsiStats
 *   _resetDependencyRsiForTest()        → void
 */

import { execSync, spawnSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createLogger } from "./logger.js";

const log = createLogger("dependencyUpdateRsi");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OutdatedPackage {
  name: string;
  current: string;
  wanted: string;
  latest: string;
  type: "dependencies" | "devDependencies";
  severity: "patch" | "minor" | "major";
}

export interface DependencyProposal {
  id: string;
  packages: OutdatedPackage[];
  rationale: string;
  estimatedRisk: "low" | "medium" | "high";
  patchCommand: string;
  createdAt: string;
}

export interface DependencyUpdateResult {
  proposalId: string;
  success: boolean;
  packagesUpdated: string[];
  testsPassed: boolean;
  rolledBack: boolean;
  errorMessage?: string;
  durationMs: number;
}

export interface DependencyRsiStats {
  totalScans: number;
  totalProposals: number;
  totalApplied: number;
  totalRolledBack: number;
  lastScanAt: string | null;
  lastAppliedAt: string | null;
  packagesKeptCurrent: number;
}

// ─── State ────────────────────────────────────────────────────────────────────

let _stats: DependencyRsiStats = {
  totalScans: 0,
  totalProposals: 0,
  totalApplied: 0,
  totalRolledBack: 0,
  lastScanAt: null,
  lastAppliedAt: null,
  packagesKeptCurrent: 0,
};

let _initialized = false;
let _scanInterval: ReturnType<typeof setInterval> | null = null;

// How often to scan for outdated deps (24 hours by default)
const SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Max packages to update in a single proposal (keep batches small for safety)
const MAX_PACKAGES_PER_PROPOSAL = 5;

// ─── Core ─────────────────────────────────────────────────────────────────────

/**
 * Scan for outdated dependencies using `pnpm outdated --json`.
 * Returns packages sorted by severity (patch first, major last).
 */
export async function scanOutdatedDependencies(): Promise<OutdatedPackage[]> {
  _stats.totalScans++;
  _stats.lastScanAt = new Date().toISOString();

  try {
    const result = spawnSync("pnpm", ["outdated", "--json"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30_000,
    });

    // pnpm outdated exits with code 1 when there are outdated packages — that's expected
    const stdout = result.stdout ?? "";
    if (!stdout.trim()) {
      log.info("[dependencyUpdateRsi] All dependencies are current");
      return [];
    }

    let outdatedData: Record<string, { current: string; wanted: string; latest: string }> = {};
    try {
      outdatedData = JSON.parse(stdout);
    } catch {
      log.warn("[dependencyUpdateRsi] Failed to parse pnpm outdated output");
      return [];
    }

    // Read package.json to determine dep vs devDep
    const pkgJsonPath = join(process.cwd(), "package.json");
    let devDeps: Set<string> = new Set();
    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
        devDeps = new Set(Object.keys(pkg.devDependencies ?? {}));
      } catch { /* ignore */ }
    }

    const packages: OutdatedPackage[] = Object.entries(outdatedData).map(([name, info]) => {
      const current = info.current ?? "0.0.0";
      const latest = info.latest ?? info.wanted ?? current;
      const severity = _classifySeverity(current, latest);
      return {
        name,
        current,
        wanted: info.wanted ?? latest,
        latest,
        type: devDeps.has(name) ? "devDependencies" : "dependencies",
        severity,
      };
    });

    // Sort: patch first (safest), major last (riskiest)
    const severityOrder = { patch: 0, minor: 1, major: 2 };
    packages.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    log.info(`[dependencyUpdateRsi] Found ${packages.length} outdated packages (${packages.filter(p => p.severity === "patch").length} patch, ${packages.filter(p => p.severity === "minor").length} minor, ${packages.filter(p => p.severity === "major").length} major)`);
    return packages;

  } catch (err) {
    log.warn(`[dependencyUpdateRsi] Scan error: ${(err as Error).message}`);
    return [];
  }
}

/**
 * Generate a dependency update proposal for the safest batch of outdated packages.
 * Prioritizes patch updates, then minor. Skips major updates (too risky for autonomous apply).
 */
export async function generateDependencyProposal(): Promise<DependencyProposal | null> {
  const outdated = await scanOutdatedDependencies();
  if (outdated.length === 0) return null;

  // Only propose patch and minor updates autonomously; major updates need human review
  const safeUpdates = outdated
    .filter(p => p.severity !== "major")
    .slice(0, MAX_PACKAGES_PER_PROPOSAL);

  if (safeUpdates.length === 0) {
    log.info("[dependencyUpdateRsi] Only major updates available — skipping autonomous proposal (requires human review)");
    return null;
  }

  const risk: DependencyProposal["estimatedRisk"] =
    safeUpdates.some(p => p.severity === "minor") ? "medium" : "low";

  const packageArgs = safeUpdates.map(p => `${p.name}@${p.latest}`).join(" ");
  const patchCommand = `pnpm update ${packageArgs}`;

  const rationale = [
    `Updating ${safeUpdates.length} package(s) to latest compatible versions:`,
    ...safeUpdates.map(p => `  • ${p.name}: ${p.current} → ${p.latest} (${p.severity})`),
    `Risk level: ${risk}. All updates are ${safeUpdates.every(p => p.severity === "patch") ? "patch-level only" : "patch/minor"}.`,
    `Test suite will be run as acceptance gate before committing.`,
  ].join("\n");

  const proposal: DependencyProposal = {
    id: `dep-rsi-${Date.now()}`,
    packages: safeUpdates,
    rationale,
    estimatedRisk: risk,
    patchCommand,
    createdAt: new Date().toISOString(),
  };

  _stats.totalProposals++;
  log.info(`[dependencyUpdateRsi] Generated proposal ${proposal.id}: ${safeUpdates.map(p => p.name).join(", ")}`);
  return proposal;
}

/**
 * Apply a dependency update proposal.
 * Runs pnpm update, then runs the test suite as a gate.
 * Rolls back (restores package.json + lockfile) if tests fail.
 */
export async function applyDependencyUpdate(proposal: DependencyProposal): Promise<DependencyUpdateResult> {
  const start = Date.now();
  const result: DependencyUpdateResult = {
    proposalId: proposal.id,
    success: false,
    packagesUpdated: proposal.packages.map(p => `${p.name}@${p.latest}`),
    testsPassed: false,
    rolledBack: false,
    durationMs: 0,
  };

  // Snapshot current package.json and lockfile for rollback
  let pkgJsonSnapshot = "";
  let lockfileSnapshot = "";
  const pkgJsonPath = join(process.cwd(), "package.json");
  const lockfilePath = join(process.cwd(), "pnpm-lock.yaml");

  try {
    pkgJsonSnapshot = readFileSync(pkgJsonPath, "utf8");
  } catch { /* ignore */ }
  try {
    if (existsSync(lockfilePath)) {
      lockfileSnapshot = readFileSync(lockfilePath, "utf8");
    }
  } catch { /* ignore */ }

  try {
    // Apply the update
    log.info(`[dependencyUpdateRsi] Applying: ${proposal.patchCommand}`);
    execSync(proposal.patchCommand, {
      cwd: process.cwd(),
      timeout: 120_000,
      stdio: "pipe",
    });

    // Run test suite as acceptance gate
    log.info("[dependencyUpdateRsi] Running test suite as acceptance gate...");
    const testResult = spawnSync(
      "./node_modules/.bin/vitest",
      ["run", "--reporter=verbose"],
      {
        cwd: process.cwd(),
        timeout: 180_000,
        encoding: "utf8",
        env: { ...process.env, CI: "true" },
      }
    );

    result.testsPassed = testResult.status === 0;

    if (!result.testsPassed) {
      // Tests failed — rollback
      log.warn("[dependencyUpdateRsi] Tests FAILED after dependency update — rolling back");
      _rollback(pkgJsonPath, pkgJsonSnapshot, lockfilePath, lockfileSnapshot);
      result.rolledBack = true;
      result.errorMessage = `Tests failed: ${(testResult.stderr ?? "").slice(0, 500)}`;
      _stats.totalRolledBack++;
    } else {
      result.success = true;
      _stats.totalApplied++;
      _stats.lastAppliedAt = new Date().toISOString();
      _stats.packagesKeptCurrent += proposal.packages.length;
      log.info(`[dependencyUpdateRsi] ✓ Applied ${proposal.packages.length} dependency update(s) — tests passed`);
    }

  } catch (err) {
    log.warn(`[dependencyUpdateRsi] Apply error: ${(err as Error).message}`);
    _rollback(pkgJsonPath, pkgJsonSnapshot, lockfilePath, lockfileSnapshot);
    result.rolledBack = true;
    result.errorMessage = (err as Error).message;
    _stats.totalRolledBack++;
  }

  result.durationMs = Date.now() - start;
  return result;
}

/**
 * Get dependency RSI statistics for dashboards.
 */
export function getDependencyRsiStats(): DependencyRsiStats {
  return { ..._stats };
}

/**
 * Initialize the dependency RSI daemon.
 * Schedules periodic scans and proposal generation.
 */
export function initDependencyUpdateRsi(): void {
  if (_initialized) return;
  _initialized = true;

  log.info("[dependencyUpdateRsi] Initialized — will scan for outdated dependencies every 24h");

  // Run first scan after a 5-minute delay (don't block boot)
  const bootDelay = setTimeout(() => {
    generateDependencyProposal()
      .then(proposal => {
        if (proposal) {
          log.info(`[dependencyUpdateRsi] Boot scan found updates — proposal ${proposal.id} ready`);
          // Note: Actual apply is triggered by the RSI cycle, not here
        }
      })
      .catch(err => {
        log.warn(`[dependencyUpdateRsi] Boot scan error: ${(err as Error).message}`);
      });
  }, 5 * 60 * 1000);

  if (bootDelay.unref) bootDelay.unref();

  // Periodic scan
  _scanInterval = setInterval(() => {
    generateDependencyProposal().catch(err => {
      log.warn(`[dependencyUpdateRsi] Periodic scan error: ${(err as Error).message}`);
    });
  }, SCAN_INTERVAL_MS);

  if (_scanInterval.unref) _scanInterval.unref();
}

/**
 * Reset state for testing.
 */
export function _resetDependencyRsiForTest(): void {
  _stats = {
    totalScans: 0,
    totalProposals: 0,
    totalApplied: 0,
    totalRolledBack: 0,
    lastScanAt: null,
    lastAppliedAt: null,
    packagesKeptCurrent: 0,
  };
  _initialized = false;
  if (_scanInterval) {
    clearInterval(_scanInterval);
    _scanInterval = null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _classifySeverity(current: string, latest: string): OutdatedPackage["severity"] {
  const parseSemver = (v: string) => {
    const clean = v.replace(/^[^0-9]*/, "");
    const parts = clean.split(".").map(Number);
    return { major: parts[0] ?? 0, minor: parts[1] ?? 0, patch: parts[2] ?? 0 };
  };

  try {
    const c = parseSemver(current);
    const l = parseSemver(latest);
    if (l.major > c.major) return "major";
    if (l.minor > c.minor) return "minor";
    return "patch";
  } catch {
    return "minor"; // Safe default
  }
}

function _rollback(
  pkgJsonPath: string,
  pkgJsonSnapshot: string,
  lockfilePath: string,
  lockfileSnapshot: string
): void {
  try {
    if (pkgJsonSnapshot) {
      const { writeFileSync } = require("fs");
      writeFileSync(pkgJsonPath, pkgJsonSnapshot, "utf8");
    }
    if (lockfileSnapshot) {
      const { writeFileSync } = require("fs");
      writeFileSync(lockfilePath, lockfileSnapshot, "utf8");
    }
    // Re-install to restore node_modules
    execSync("pnpm install --frozen-lockfile", {
      cwd: process.cwd(),
      timeout: 120_000,
      stdio: "pipe",
    });
    log.info("[dependencyUpdateRsi] Rollback complete");
  } catch (err) {
    log.warn(`[dependencyUpdateRsi] Rollback failed: ${(err as Error).message}`);
  }
}
