/**
 * twoPhaseCommit.ts — Andromeda v5.68 SOTA Safety Architecture
 *
 * Implements a two-phase commit protocol for all self-modifications:
 *
 *   Phase 1 (Prepare):
 *     - Create git snapshot
 *     - Validate with SafetySupervisor
 *     - Check FailurePatternMemory for known bad patterns
 *     - Run TypeScript check on proposed content
 *
 *   Phase 2 (Apply):
 *     - Write the file
 *     - Run health check (TypeScript compile of whole project)
 *     - If health check fails → auto-rollback from git snapshot
 *     - If health check passes → commit with SHA-256 verification
 *
 * This file is in the FORBIDDEN list and cannot be modified by self-improvement.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { validateProposal, isForbiddenFile, type SafetyValidationResult } from "./safetySupervisor.js";
import { checkFailurePattern, recordFailure, type FailureCheck } from "./failurePatternMemory.js";
import { storeMemory } from "./memory.js";
import { verifyCommitProposal } from "./proofVerifier.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CommitPhase = "idle" | "preparing" | "applying" | "verifying" | "committed" | "rolled_back";

export type CommitResult = {
  success: boolean;
  phase: CommitPhase;
  filePath: string;
  backupPath?: string;
  sha256Before?: string;
  sha256After?: string;
  safetyResult?: SafetyValidationResult;
  failureCheck?: FailureCheck;
  error?: string;
  rollbackReason?: string;
  durationMs: number;
};

export type CommitOptions = {
  filePath: string;
  proposedContent: string;
  rationale: string;
  proposedBy?: string;
  timeoutMs?: number;
  skipTypeCheck?: boolean;
  skipSafetyCheck?: boolean; // Only for emergency recovery — logs a warning
  createIfMissing?: boolean; // If true, create the file if it doesn't exist
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getServerDir(): string {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

function computeHash(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}

function createBackup(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  const backupPath = `${filePath}.tpc_backup_${Date.now()}`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function restoreBackup(backupPath: string, targetPath: string): boolean {
  try {
    if (!fs.existsSync(backupPath)) return false;
    fs.copyFileSync(backupPath, targetPath);
    fs.unlinkSync(backupPath);
    return true;
  } catch {
    return false;
  }
}

// ── Git Stable-State Helpers (v5.68) ─────────────────────────────────────────
/**
 * Ensure git is initialized in the project root and create a stable-state commit
 * before any self-modification. Returns the commit SHA or null if git unavailable.
 */
function createGitStableState(projectRoot: string, filePath: string): string | null {
  try {
    // Init git if not already initialized
    const gitDir = path.join(projectRoot, ".git");
    if (!fs.existsSync(gitDir)) {
      execSync("git init && git config user.email 'andromeda@self' && git config user.name 'Andromeda'", {
        cwd: projectRoot, encoding: "utf8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"],
      });
    }
    // Stage all changes and create a stable-state commit
    execSync("git add -A", { cwd: projectRoot, encoding: "utf8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] });
    const msg = `stable-state before modifying ${path.basename(filePath)} [${new Date().toISOString()}]`;
    execSync(`git commit --allow-empty -m "${msg}"`, {
      cwd: projectRoot, encoding: "utf8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"],
    });
    const sha = execSync("git rev-parse HEAD", { cwd: projectRoot, encoding: "utf8", timeout: 5_000 }).trim();
    console.log(`[TwoPhaseCommit] Git stable-state tagged: ${sha.slice(0, 8)} for ${path.basename(filePath)}`);
    return sha;
  } catch (e) {
    // Git not available or failed — non-fatal, fall back to file backup
    console.warn(`[TwoPhaseCommit] Git stable-state tagging skipped: ${String(e).slice(0, 100)}`);
    return null;
  }
}

/**
 * Rollback a specific file to the git stable-state commit SHA.
 * Falls back gracefully if git is unavailable.
 */
function rollbackToGitState(projectRoot: string, filePath: string, stableStateSha: string | null): boolean {
  if (!stableStateSha) return false;
  try {
    // Restore the specific file from the stable-state commit
    const relPath = path.relative(projectRoot, filePath);
    execSync(`git checkout ${stableStateSha} -- "${relPath}"`, {
      cwd: projectRoot, encoding: "utf8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"],
    });
    console.log(`[TwoPhaseCommit] Git rollback to ${stableStateSha.slice(0, 8)} for ${path.basename(filePath)}`);
    return true;
  } catch (e) {
    console.warn(`[TwoPhaseCommit] Git rollback failed: ${String(e).slice(0, 100)}`);
    return false;
  }
}

/**
 * Store a negative-example memory after a rollback so the agent learns from failures
 * and avoids repeating the same mistake in future sessions. (v5.68)
 */
async function storeRollbackMemory(filePath: string, rationale: string, rollbackReason: string, errorDetail: string): Promise<void> {
  try {
    const memContent = [
      `SELF-MODIFICATION FAILURE — NEGATIVE EXAMPLE (do not repeat):`,
      `File: ${path.basename(filePath)}`,
      `Full path: ${filePath}`,
      `Rationale was: "${rationale.slice(0, 200)}"`,
      `Rollback reason: ${rollbackReason}`,
      `Error: ${errorDetail.slice(0, 300)}`,
      `Lesson: Avoid this pattern when modifying ${path.basename(filePath)}.`,
      `Path note: This file is at '${filePath}' — NOT in src/ directory.`,
    ].join("\n");
    // v5.75: Use structured self_mod_failure episodic memory type
    storeMemory(memContent, "self_mod_failure", ["self-modification", "rollback", "negative-example", path.basename(filePath)]);
    console.log(`[TwoPhaseCommit] Stored self_mod_failure episodic memory for rollback of ${path.basename(filePath)}`);
  } catch (e) {
    // Non-fatal — memory store failure should not block the rollback result
    console.warn(`[TwoPhaseCommit] Failed to store rollback memory: ${String(e).slice(0, 100)}`);
  }
}

// v5.75: Store episodic memory for successful self-modifications
async function storeSuccessMemory(filePath: string, rationale: string, linesWritten: number): Promise<void> {
  try {
    const memContent = [
      `SELF-MODIFICATION SUCCESS — POSITIVE EXAMPLE:`,
      `File: ${path.basename(filePath)}`,
      `Full path: ${filePath}`,
      `Rationale: "${rationale.slice(0, 200)}"`,
      `Lines written: ${linesWritten}`,
      `Path note: This file is at '${filePath}' — NOT in src/ directory.`,
      `Lesson: This modification pattern worked. The file is in server/, not src/.`,
    ].join("\n");
    storeMemory(memContent, "self_mod_success", ["self-modification", "success", path.basename(filePath)]);
    console.log(`[TwoPhaseCommit] Stored self_mod_success episodic memory for ${path.basename(filePath)}`);
  } catch (e) {
    console.warn(`[TwoPhaseCommit] Failed to store success memory: ${String(e).slice(0, 100)}`);
  }
}

/**
 * v5.75: Detect if TypeScript/JavaScript content appears truncated.
 * Checks for unbalanced braces, brackets, and parentheses.
 * Returns a description of the imbalance, or null if content looks complete.
 */
function detectTruncation(content: string, filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'].includes(ext)) return null;
  // Strip string literals and comments to avoid false positives from content inside strings
  const stripped = content
    .replace(/`[^`]*`/gs, '``')              // template literals
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')    // double-quoted strings
    .replace(/\'(?:[^\'\\]|\\.)*\'/g, "''")  // single-quoted strings
    .replace(/\/\*[\s\S]*?\*\//g, '')        // block comments
    .replace(/\/\/[^\n]*/g, '');             // line comments
  let braces = 0, brackets = 0, parens = 0;
  for (const ch of stripped) {
    if (ch === '{') braces++; else if (ch === '}') braces--;
    if (ch === '[') brackets++; else if (ch === ']') brackets--;
    if (ch === '(') parens++; else if (ch === ')') parens--;
  }
  const issues: string[] = [];
  if (braces > 0) issues.push(`${braces} unclosed '{' brace(s)`);
  if (brackets > 0) issues.push(`${brackets} unclosed '[' bracket(s)`);
  if (parens > 0) issues.push(`${parens} unclosed '(' paren(s)`);
  if (issues.length > 0) {
    return `Content appears TRUNCATED: ${issues.join(', ')}. The file was likely cut off mid-code. Use self_write_file_chunked to write large files in chunks.`;
  }
  return null;
}

function runTypeScriptCheck(serverDir: string): { passed: boolean; error?: string } {
  try {
    const projectRoot = path.resolve(serverDir, "..");
    execSync("npx tsc --noEmit", {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 60_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { passed: true };
  } catch (e) {
    const errMsg = (e as { stderr?: string; stdout?: string })?.stderr ||
      (e as { stdout?: string })?.stdout ||
      String(e);
    return { passed: false, error: errMsg.slice(0, 500) };
  }
}

// ── Active Commits Tracker ────────────────────────────────────────────────────

const activeCommits = new Map<string, CommitPhase>();

// ── Main Two-Phase Commit ─────────────────────────────────────────────────────

/**
 * Execute a two-phase commit for a self-modification.
 * Returns a CommitResult with full audit trail.
 */
export async function twoPhaseCommit(options: CommitOptions): Promise<CommitResult> {
  const startTime = Date.now();
  const serverDir = getServerDir();
  const absolutePath = path.isAbsolute(options.filePath)
    ? options.filePath
    : path.resolve(serverDir, "..", options.filePath);

  // Prevent concurrent commits to the same file
  if (activeCommits.get(absolutePath) === "applying") {
    return {
      success: false,
      phase: "idle",
      filePath: options.filePath,
      error: "Concurrent commit to the same file is not allowed",
      durationMs: Date.now() - startTime,
    };
  }

  activeCommits.set(absolutePath, "preparing");

  try {
    // ── PHASE 1: PREPARE ──────────────────────────────────────────────────────

    // 1a. Check forbidden files (immutable check — cannot be bypassed)
    if (isForbiddenFile(options.filePath)) {
      activeCommits.delete(absolutePath);
      return {
        success: false,
        phase: "preparing",
        filePath: options.filePath,
        error: `FORBIDDEN: ${options.filePath} is in the immutable protected file list`,
        durationMs: Date.now() - startTime,
      };
    }

    // 1b. Safety supervisor validation
    let safetyResult: SafetyValidationResult | undefined;
    if (!options.skipSafetyCheck) {
      safetyResult = await validateProposal({
        filePath: options.filePath,
        proposedContent: options.proposedContent,
        rationale: options.rationale,
        proposedBy: options.proposedBy || "unknown",
      });

      if (!safetyResult.passed) {
        activeCommits.delete(absolutePath);
        await recordFailure({
          filePath: options.filePath,
          rationale: options.rationale,
          failureType: "safety",
          errorMessage: safetyResult.violations.join("; "),
          proposedBy: options.proposedBy || "unknown",
        });
        return {
          success: false,
          phase: "preparing",
          filePath: options.filePath,
          safetyResult,
          error: `Safety validation failed: ${safetyResult.violations.join("; ")}`,
          durationMs: Date.now() - startTime,
        };
      }
    } else {
      console.warn(`[TwoPhaseCommit] WARNING: Safety check bypassed for ${options.filePath}`);
    }

    // 1c. Check failure pattern memory
    const failureCheck = await checkFailurePattern({
      filePath: options.filePath,
      proposedContent: options.proposedContent,
      rationale: options.rationale,
    });

    if (failureCheck.hasKnownFailure && failureCheck.severity === "block") {
      activeCommits.delete(absolutePath);
      return {
        success: false,
        phase: "preparing",
        filePath: options.filePath,
        safetyResult,
        failureCheck,
        error: `Known failure pattern detected: ${failureCheck.matchedPattern}. Previous failure: ${failureCheck.previousError}`,
        durationMs: Date.now() - startTime,
      };
    }

    // 1d. v5.75: Detect truncated content before writing
    const truncationError = detectTruncation(options.proposedContent, options.filePath);
    if (truncationError) {
      activeCommits.delete(absolutePath);
      return {
        success: false,
        phase: "preparing",
        filePath: options.filePath,
        error: truncationError,
        durationMs: Date.now() - startTime,
      };
    }

    // 1e. v9.0: Proof verification gate — run propositional + TLA+ + ZK checks
    // Runs in warn-only mode by default so it never blocks a commit on proof failure alone.
    // To enforce blocking, set ANDROMEDA_PROOF_GATE_STRICT=true in the environment.
    try {
      const strictMode = process.env.ANDROMEDA_PROOF_GATE_STRICT === "true";
      const proofResult = await verifyCommitProposal({
        filePath: options.filePath,
        proposedContent: options.proposedContent,
        rationale: options.rationale,
        preConditions: {},
        postConditions: {},
        expectedUtilityDelta: 0.01,
      });
      if (strictMode && !proofResult.valid) {
        activeCommits.delete(absolutePath);
        return {
          success: false,
          phase: "preparing",
          filePath: options.filePath,
          safetyResult,
          failureCheck,
          error: `Proof gate BLOCKED: ${proofResult.explanation}`,
          durationMs: Date.now() - startTime,
        };
      }
      if (proofResult.outcome !== "proved") {
        console.log(`[TwoPhaseCommit] Proof gate: ${proofResult.outcome} (confidence: ${(proofResult.confidence * 100).toFixed(0)}%) — proceeding in warn-only mode`);
      } else {
        console.log(`[TwoPhaseCommit] Proof gate: PROVED (confidence: ${(proofResult.confidence * 100).toFixed(0)}%)`);
      }
    } catch (proofErr) {
      // Non-fatal — proof gate failure should not block a commit
      console.warn(`[TwoPhaseCommit] Proof gate error (non-fatal): ${String(proofErr).slice(0, 100)}`);
    }

    // 1f. Create backup + git stable-state tag (v5.68)
    const sha256Before = fs.existsSync(absolutePath)
      ? computeHash(fs.readFileSync(absolutePath, "utf8"))
      : undefined;
    const backupPath = createBackup(absolutePath) ?? undefined;
    const projectRoot = path.resolve(serverDir, "..");
    const stableStateSha = createGitStableState(projectRoot, absolutePath);

    // ── PHASE 2: APPLY ────────────────────────────────────────────────────────

    activeCommits.set(absolutePath, "applying");

    // 2a. Write the file
    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(absolutePath, options.proposedContent, "utf8");

    // 2b. Verify write integrity
    const writtenContent = fs.readFileSync(absolutePath, "utf8");
    const sha256After = computeHash(writtenContent);
    const expectedHash = computeHash(options.proposedContent);

    if (sha256After !== expectedHash) {
      // Write integrity failure — restore backup + git rollback (v5.68)
      if (backupPath) restoreBackup(backupPath, absolutePath);
      rollbackToGitState(projectRoot, absolutePath, stableStateSha);
      activeCommits.set(absolutePath, "rolled_back");
      activeCommits.delete(absolutePath);
      const integrityError = `SHA-256 mismatch after write: expected ${expectedHash}, got ${sha256After}`;
      await recordFailure({
        filePath: options.filePath,
        rationale: options.rationale,
        failureType: "integrity",
        errorMessage: integrityError,
        proposedBy: options.proposedBy || "unknown",
      });
      await storeRollbackMemory(options.filePath, options.rationale, "sha256_mismatch", integrityError);
      return {
        success: false,
        phase: "applying",
        filePath: options.filePath,
        backupPath,
        sha256Before,
        sha256After,
        safetyResult,
        failureCheck,
        error: "Write integrity check failed — backup restored",
        rollbackReason: "sha256_mismatch",
        durationMs: Date.now() - startTime,
      };
    }

    // ── PHASE 3: VERIFY ───────────────────────────────────────────────────────

    activeCommits.set(absolutePath, "verifying");

    if (!options.skipTypeCheck) {
      const tsCheck = runTypeScriptCheck(serverDir);
      if (!tsCheck.passed) {
        // TypeScript check failed — restore backup + git rollback (v5.68)
        if (backupPath) restoreBackup(backupPath, absolutePath);
        rollbackToGitState(projectRoot, absolutePath, stableStateSha);
        activeCommits.set(absolutePath, "rolled_back");
        activeCommits.delete(absolutePath);
        const tsError = tsCheck.error || "TypeScript compilation failed";
        await recordFailure({
          filePath: options.filePath,
          rationale: options.rationale,
          failureType: "typescript",
          errorMessage: tsError,
          proposedBy: options.proposedBy || "unknown",
        });
        await storeRollbackMemory(options.filePath, options.rationale, "typescript_failure", tsError);
        return {
          success: false,
          phase: "verifying",
          filePath: options.filePath,
          backupPath,
          sha256Before,
          sha256After,
          safetyResult,
          failureCheck,
          error: `TypeScript check failed after write — backup restored. Errors: ${tsError}`,
          rollbackReason: "typescript_failure",
          durationMs: Date.now() - startTime,
        };
      }
    }

    // ── COMMIT ────────────────────────────────────────────────────────────────

    activeCommits.set(absolutePath, "committed");

    // Clean up backup on success
    if (backupPath && fs.existsSync(backupPath)) {
      try { fs.unlinkSync(backupPath); } catch { /* ignore */ }
    }

    // v5.75: Store success episodic memory so the agent learns correct file paths
    const linesWritten = options.proposedContent.split("\n").length;
    storeSuccessMemory(absolutePath, options.rationale, linesWritten).catch(() => {});
    capturePostCommitSnapshot(absolutePath);

    activeCommits.delete(absolutePath);

    return {
      success: true,
      phase: "committed",
      filePath: options.filePath,
      sha256Before,
      sha256After,
      safetyResult,
      failureCheck,
      durationMs: Date.now() - startTime,
    };

  } catch (e) {
    activeCommits.delete(absolutePath);
    return {
      success: false,
      phase: "applying",
      filePath: options.filePath,
      error: `Unexpected error during two-phase commit: ${(e as Error).message}`,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Get the status of all active commits.
 */
export function getActiveCommits(): Record<string, CommitPhase> {
  return Object.fromEntries(activeCommits);
}

// ── Performance Regression Detection (v5.75) ─────────────────────────────────
// Implements the expanded rollback triggers from Andromeda's B+ → A+ roadmap:
// - Memory leak detection (heap growth > 10% in 5 min) → warning + negative memory
// - Heap growth > 20% → critical warning

interface PerformanceSnapshot {
  heapUsedMb: number;
  timestamp: number;
  commitFilePath: string;
}

const recentCommitSnapshots: PerformanceSnapshot[] = [];
const MAX_SNAPSHOTS = 20;

/**
 * Capture a performance snapshot after a successful commit.
 * Called automatically by twoPhaseCommit on success.
 */
export function capturePostCommitSnapshot(filePath: string): void {
  const mem = process.memoryUsage();
  const snapshot: PerformanceSnapshot = {
    heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10,
    timestamp: Date.now(),
    commitFilePath: filePath,
  };
  recentCommitSnapshots.push(snapshot);
  if (recentCommitSnapshots.length > MAX_SNAPSHOTS) {
    recentCommitSnapshots.shift();
  }
  // Check for memory leak: heap growth > 10% in last 5 minutes
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  const oldSnapshots = recentCommitSnapshots.filter(s => s.timestamp < fiveMinAgo);
  if (oldSnapshots.length > 0) {
    const oldestHeap = oldSnapshots[0].heapUsedMb;
    const heapGrowthPct = (snapshot.heapUsedMb - oldestHeap) / oldestHeap;
    if (heapGrowthPct > 0.10) {
      const severity = heapGrowthPct > 0.20 ? "CRITICAL" : "WARNING";
      console.warn(`[TwoPhaseCommit] ⚠️ ${severity}: Memory regression detected after commit to ${path.basename(filePath)}: heap grew ${Math.round(heapGrowthPct * 100)}% in 5 minutes (${oldestHeap}MB → ${snapshot.heapUsedMb}MB)`);
      storeRollbackMemory(
        filePath,
        "memory-regression-detection",
        "heap_growth_exceeded",
        `Heap grew ${Math.round(heapGrowthPct * 100)}% in 5 minutes after this commit (${oldestHeap}MB → ${snapshot.heapUsedMb}MB)`
      ).catch(() => {});
    }
  }
}

/**
 * Get the performance regression report for recent commits.
 * Used by /api/health and self_diagnose to surface regressions.
 */
export function getPerformanceRegressionReport(): {
  snapshots: PerformanceSnapshot[];
  currentHeapMb: number;
  heapTrendPct: number | null;
  status: "healthy" | "warning" | "critical";
} {
  const mem = process.memoryUsage();
  const currentHeapMb = Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10;
  let heapTrendPct: number | null = null;
  let status: "healthy" | "warning" | "critical" = "healthy";

  if (recentCommitSnapshots.length >= 2) {
    const first = recentCommitSnapshots[0].heapUsedMb;
    heapTrendPct = Math.round((currentHeapMb - first) / first * 100);
    if (heapTrendPct > 20) status = "critical";
    else if (heapTrendPct > 10) status = "warning";
  }

  return { snapshots: recentCommitSnapshots.slice(-5), currentHeapMb, heapTrendPct, status };
}
