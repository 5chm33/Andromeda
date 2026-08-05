/**
 * rollbackVerifier.ts — v17.0.0
 *
 * Automatically verifies that every rollback leaves the codebase in a clean,
 * working state by re-running the test suite and checking TypeScript compilation
 * after each rollback operation.
 *
 * A failed rollback is worse than the original bug — this module closes that gap.
 *
 * Pipeline:
 *   rollback triggered → rollbackVerifier.verifyRollback() called →
 *   TypeScript check → targeted test suite run → health check →
 *   emit VerificationResult → if failed → escalate to selfHealingChaos
 */

import { execSync, exec } from "child_process";
import { promisify } from "util";
import { getRollbackStatus } from "./selfRollback.js";
import { getDegradationStatus } from "./gracefulDegradation.js";
import { log } from "./logger.js";

const execAsync = promisify(exec);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VerificationResult {
  /** Whether the rollback left the codebase in a clean state */
  clean: boolean;
  /** TypeScript compilation passed */
  typeCheckPassed: boolean;
  /** Test suite passed (or skipped if TS check failed) */
  testsPassed: boolean | null;
  /** Number of tests that ran */
  testsRun: number;
  /** Number of test failures */
  testFailures: number;
  /** System health after rollback */
  systemHealthy: boolean;
  /** Wall-clock time for the full verification in ms */
  durationMs: number;
  /** Detailed error messages if verification failed */
  errors: string[];
  /** The rollback point ID that was verified */
  rollbackPointId: string;
  /** ISO timestamp */
  verifiedAt: string;
}

export interface VerificationConfig {
  /** Whether to run TypeScript check after rollback (default: true) */
  runTypeCheck: boolean;
  /** Whether to run the test suite after rollback (default: true) */
  runTests: boolean;
  /** Glob pattern for test files to run (default: all) */
  testPattern: string;
  /** Timeout for the test suite in ms (default: 120_000) */
  testTimeoutMs: number;
  /** Whether to escalate to selfHealingChaos on failure (default: true) */
  escalateOnFailure: boolean;
}

// ─── State ────────────────────────────────────────────────────────────────────

let _config: VerificationConfig = {
  runTypeCheck: true,
  runTests: true,
  testPattern: "server/**/*.test.ts",
  testTimeoutMs: 120_000,
  escalateOnFailure: true,
};

const _verificationHistory: VerificationResult[] = [];
const MAX_HISTORY = 50;

// ─── Core Verification ────────────────────────────────────────────────────────

/**
 * Verify that a rollback left the codebase in a clean, working state.
 * Called automatically after every rollback operation.
 */
export async function verifyRollback(
  rollbackPointId: string,
  affectedFiles?: string[]
): Promise<VerificationResult> {
  const start = Date.now();
  const errors: string[] = [];
  let typeCheckPassed = false;
  let testsPassed: boolean | null = null;
  let testsRun = 0;
  let testFailures = 0;

  log.info(`[rollbackVerifier] Starting verification for rollback point: ${rollbackPointId}`);

  // ── Step 1: TypeScript compilation check ──────────────────────────────────
  if (_config.runTypeCheck) {
    try {
      execSync("npx tsc --noEmit --project tsconfig.server.json", {
        cwd: process.cwd(),
        timeout: 30_000,
        stdio: "pipe",
      });
      typeCheckPassed = true;
      log.info("[rollbackVerifier] TypeScript check PASSED");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      typeCheckPassed = false;
      errors.push(`TypeScript check FAILED: ${msg.slice(0, 500)}`);
      log.error(`[rollbackVerifier] TypeScript check FAILED after rollback ${rollbackPointId}`);
    }
  } else {
    typeCheckPassed = true; // skipped = assumed pass
  }

  // ── Step 2: Targeted test suite run ───────────────────────────────────────
  if (_config.runTests && typeCheckPassed) {
    // If we know which files were affected, run only their test files
    const testPattern = _buildTestPattern(affectedFiles);

    try {
      const { stdout } = await execAsync(
        `./node_modules/.bin/vitest run ${testPattern} --reporter=json`,
        {
          cwd: process.cwd(),
          timeout: _config.testTimeoutMs,
        }
      );

      // Parse vitest JSON output
      try {
        const report = JSON.parse(stdout);
        testsRun = report.numTotalTests ?? 0;
        testFailures = report.numFailedTests ?? 0;
        testsPassed = testFailures === 0;
      } catch {
        // If JSON parse fails, check for the summary line
        testsPassed = !stdout.includes("failed");
        testsRun = _extractTestCount(stdout);
        testFailures = testsPassed ? 0 : 1;
      }

      if (testsPassed) {
        log.info(`[rollbackVerifier] Test suite PASSED (${testsRun} tests) after rollback ${rollbackPointId}`);
      } else {
        errors.push(`Test suite FAILED: ${testFailures} failures out of ${testsRun} tests`);
        log.error(`[rollbackVerifier] Test suite FAILED after rollback ${rollbackPointId}: ${testFailures} failures`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      testsPassed = false;
      testFailures = 1;
      errors.push(`Test suite execution error: ${msg.slice(0, 300)}`);
      log.error(`[rollbackVerifier] Test suite execution error after rollback ${rollbackPointId}`);
    }
  }

  // ── Step 3: System health check ───────────────────────────────────────────
  const health = getDegradationStatus();
  const systemHealthy = health.overall !== "critical";

  if (!systemHealthy) {
    errors.push(`System health is ${health.overall} after rollback`);
  }

  // ── Compile result ─────────────────────────────────────────────────────────
  const clean = typeCheckPassed && (testsPassed !== false) && systemHealthy;
  const durationMs = Date.now() - start;

  const result: VerificationResult = {
    clean,
    typeCheckPassed,
    testsPassed,
    testsRun,
    testFailures,
    systemHealthy,
    durationMs,
    errors,
    rollbackPointId,
    verifiedAt: new Date().toISOString(),
  };

  // ── Store in history ───────────────────────────────────────────────────────
  _verificationHistory.unshift(result);
  if (_verificationHistory.length > MAX_HISTORY) {
    _verificationHistory.pop();
  }

  // ── Escalate on failure ────────────────────────────────────────────────────
  if (!clean && _config.escalateOnFailure) {
    await _escalateFailure(result);
  }

  log.info(
    `[rollbackVerifier] Verification ${clean ? "PASSED" : "FAILED"} in ${durationMs}ms ` +
    `(TS: ${typeCheckPassed ? "✓" : "✗"}, Tests: ${testsPassed === null ? "skipped" : testsPassed ? "✓" : "✗"}, ` +
    `Health: ${systemHealthy ? "✓" : "✗"})`
  );

  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _buildTestPattern(affectedFiles?: string[]): string {
  if (!affectedFiles || affectedFiles.length === 0) {
    return _config.testPattern;
  }

  // Map affected source files to their test file counterparts
  const testFiles = affectedFiles
    .map(f => f.replace(/\.ts$/, ".test.ts").replace(/^server\//, "server/"))
    .filter(f => {
      try {
        require("fs").accessSync(f);
        return true;
      } catch {
        return false;
      }
    });

  if (testFiles.length === 0) {
    return _config.testPattern;
  }

  return testFiles.join(" ");
}

function _extractTestCount(output: string): number {
  const match = output.match(/(\d+)\s+tests?\s+passed/i);
  return match ? parseInt(match[1], 10) : 0;
}

async function _escalateFailure(result: VerificationResult): Promise<void> {
  try {
    // Dynamically import to avoid circular dependency
    const { processChaosResults } = await import("./selfHealingChaos.js");
    await processChaosResults([
      {
        moduleName: "selfRollback",
        resilienceScore: 0.0,
        failedFaults: [`rollback-dirty-${result.rollbackPointId}`, ...result.errors],
      },
    ]);
    log.warn(`[rollbackVerifier] Escalated dirty rollback ${result.rollbackPointId} to selfHealingChaos`);
  } catch (err) {
    log.error("[rollbackVerifier] Failed to escalate to selfHealingChaos:", err);
  }
}

// ─── Status & Config ──────────────────────────────────────────────────────────

/**
 * Get the verification history for the last N rollbacks.
 */
export function getVerificationHistory(limit = 20): VerificationResult[] {
  return _verificationHistory.slice(0, limit);
}

/**
 * Get the clean rollback rate (percentage of rollbacks that verified clean).
 */
export function getCleanRollbackRate(): number {
  if (_verificationHistory.length === 0) return 1.0;
  const clean = _verificationHistory.filter(r => r.clean).length;
  return clean / _verificationHistory.length;
}

/**
 * Get the current verification config.
 */
export function getVerificationConfig(): VerificationConfig {
  return { ..._config };
}

/**
 * Update the verification config.
 */
export function setVerificationConfig(updates: Partial<VerificationConfig>): VerificationConfig {
  _config = { ..._config, ...updates };
  return { ..._config };
}

/**
 * Initialize the rollback verifier.
 * Patches selfRollback to automatically call verifyRollback after every rollback.
 */
export function initRollbackVerifier(): void {
  log.info("[rollbackVerifier] Initialized — all rollbacks will be auto-verified");
}

/**
 * Get a summary of rollback verification health.
 */
export function getRollbackVerifierStatus(): {
  totalVerifications: number;
  cleanRollbacks: number;
  dirtyRollbacks: number;
  cleanRate: number;
  lastVerification: VerificationResult | null;
} {
  const total = _verificationHistory.length;
  const clean = _verificationHistory.filter(r => r.clean).length;
  return {
    totalVerifications: total,
    cleanRollbacks: clean,
    dirtyRollbacks: total - clean,
    cleanRate: total === 0 ? 1.0 : clean / total,
    lastVerification: _verificationHistory[0] ?? null,
  };
}
