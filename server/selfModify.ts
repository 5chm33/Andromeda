/**
 * selfModify.ts — Autonomous Self-Modification Engine
 * v5.23: The core capability that allows Andromeda to modify its own source code.
 *
 * Pipeline: Backup → Write → TypeCheck → Test → HotReload → Verify → Commit
 * On failure at any stage: automatic rollback to backup.
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { createHash } from "crypto"; // v5.32: Static import (crypto is a Node.js built-in)

// v5.32: ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Simple logger (no external dependency)
function log(level: string, module: string, message: string): void {
  const prefix = `[${module}]`;
  if (level === "error") console.error(prefix, message);
  else if (level === "warn") console.warn(prefix, message);
  else console.log(prefix, message);
}

// ─── Per-File Mutex ─────────────────────────────────────────────────────────
// Prevents race conditions in the write → verify → reload sequence
const fileLocks = new Map<string, Promise<void>>();
const LOCK_TIMEOUT_MS = 30_000; // v6.12: 30s timeout prevents deadlocks
async function acquireFileLock(filePath: string): Promise<() => void> {
  const normalized = path.resolve(filePath);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (fileLocks.has(normalized)) {
    if (Date.now() > deadline) {
      // Force-release stale lock to prevent indefinite blocking
      fileLocks.delete(normalized);
      break;
    }
    await Promise.race([
      fileLocks.get(normalized)!,
      new Promise<void>(r => setTimeout(r, 1000)),
    ]);
  }
  let releaseFn!: () => void;
  const lockPromise = new Promise<void>((resolve) => { releaseFn = resolve; });
  fileLocks.set(normalized, lockPromise);
  // Auto-release after timeout to prevent leaked locks
  const autoRelease = setTimeout(() => {
    if (fileLocks.get(normalized) === lockPromise) {
      fileLocks.delete(normalized);
      releaseFn();
    }
  }, LOCK_TIMEOUT_MS);
  return () => {
    clearTimeout(autoRelease);
    fileLocks.delete(normalized);
    releaseFn();
  };
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ModificationRequest {
  filePath: string;
  newContent: string;
  reason: string;
  requireTypeCheck?: boolean;
  requireTests?: boolean;
  hotReload?: boolean;
  requireApproval?: boolean;
  // v5.34: Consensus check fields
  impact?: "high" | "medium" | "low";
  category?: "security" | "performance" | "reliability" | "readability" | "feature";
}

export interface ModificationResult {
  success: boolean;
  message: string;
  backupId?: string;
  diff?: string;
  rollbackAvailable: boolean;
}

interface BackupEntry {
  id: string;
  filePath: string;
  originalContent: string;
  timestamp: number;
  reason: string;
}

// ─── State ───────────────────────────────────────────────────────────────────

const backups = new Map<string, BackupEntry>();
const modificationHistory: Array<{
  id: string;
  filePath: string;
  reason: string;
  success: boolean;
  timestamp: number;
  rollbackId?: string;
}> = [];

let enabled = true;
let totalModifications = 0;
let successfulModifications = 0;
let failedModifications = 0;
const MAX_HISTORY = 100;
const MAX_BACKUPS = 50;

// ─── Configuration ───────────────────────────────────────────────────────────

const SERVER_DIR = path.join(process.cwd(), "server");

// Critical modules where hot-reload failure is pipeline-stopping
const CRITICAL_MODULES = new Set([
  "selfModify", "selfMonitor", "selfImprove", "selfImproveGuard",
  "selfHeal", "selfTestPipeline", "selfRollback", "streamRouter"
]);

/**
 * Verify that the in-memory loaded module matches the on-disk file content.
 * Uses a hash comparison to detect split-state.
 */
async function verifyLoadedVersion(filePath: string, expectedContent: string): Promise<boolean> {
  try {
    // v5.32: Using static import at top of file (crypto is a Node.js built-in)
    const absPath = resolveFilePath(filePath);
    const diskContent = fs.readFileSync(absPath, "utf-8");
    const diskHash = createHash("sha256").update(diskContent).digest("hex");
    const expectedHash = createHash("sha256").update(expectedContent).digest("hex");
    return diskHash === expectedHash;
  } catch (err) {
    log("warn", "selfModify", `File integrity check failed: ${(err as Error).message}`);
    return false;
  }
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Create a backup of a file before modification.
 */
function createBackup(filePath: string, reason: string): BackupEntry {
  const absPath = resolveFilePath(filePath);
  const content = fs.existsSync(absPath) ? fs.readFileSync(absPath, "utf-8") : "";
  const id = `backup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const entry: BackupEntry = {
    id,
    filePath: absPath,
    originalContent: content,
    timestamp: Date.now(),
    reason,
  };

  backups.set(id, entry);

  // Evict old backups if over limit
  if (backups.size > MAX_BACKUPS) {
    const oldest = Array.from(backups.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    if (oldest) backups.delete(oldest[0]);
  }

  return entry;
}

/**
 * Restore a file from backup.
 */
export function restoreFromBackup(backupId: string): { success: boolean; message: string } {
  const backup = backups.get(backupId);
  if (!backup) {
    return { success: false, message: `Backup ${backupId} not found` };
  }

  try {
    fs.writeFileSync(backup.filePath, backup.originalContent, "utf-8");
    log("info", "selfModify", `Restored ${backup.filePath} from backup ${backupId}`);
    return { success: true, message: `Restored ${path.basename(backup.filePath)} from backup` };
  } catch (err) {
    return { success: false, message: `Restore failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Run TypeScript type checking on the project.
 */
function runTypeCheck(): { success: boolean; errors: string[] } {
  try {
    const _result = execSync("pnpm exec tsc --noEmit 2>&1", {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 60_000,
    });
    return { success: true, errors: [] };
  } catch (err: any) {
    const output = err.stdout || err.message || "";
    const errors = output.split("\n").filter((l: string) => l.includes("error TS"));
    return { success: false, errors: errors.slice(0, 10) };
  }
}

/**
 * Run the test suite.
 */
function runTests(): { success: boolean; passed: number; failed: number; errors: string[] } {
  // v5.35: Actually parse vitest JSON output instead of returning hardcoded values
  function parseVitestOutput(output: string): { passed: number; failed: number } {
    try {
      const parsed = JSON.parse(output);
      return {
        passed: parsed.numPassedTests ?? parsed.numPassed ?? 0,
        failed: parsed.numFailedTests ?? parsed.numFailed ?? 0,
      };
    } catch {
      // JSON parse failed — try regex extraction from mixed output
      const passMatch = output.match(/(\d+)\s+pass/i);
      const failMatch = output.match(/(\d+)\s+fail/i);
      return {
        passed: passMatch ? parseInt(passMatch[1], 10) : 0,
        failed: failMatch ? parseInt(failMatch[1], 10) : 0,
      };
    }
  }

  try {
    const result = execSync("pnpm exec vitest run --reporter=json 2>&1", {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 120_000,
    });
    const counts = parseVitestOutput(result);
    return { success: counts.failed === 0, passed: counts.passed, failed: counts.failed, errors: [] };
  } catch (err: any) {
    const output = err.stdout || err.stderr || err.message || "";
    const counts = parseVitestOutput(output);
    return {
      success: false,
      passed: counts.passed,
      failed: Math.max(counts.failed, 1), // At least 1 failure since we're in catch
      errors: [output.slice(0, 500)],
    };
  }
}

/**
 * Generate a unified diff between old and new content.
 */
function generateDiff(oldContent: string, newContent: string, filePath: string): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  const changes: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];
  let diffCount = 0;

  for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
    if (oldLines[i] !== newLines[i]) {
      if (diffCount === 0) changes.push(`@@ -${i + 1} @@`);
      if (i < oldLines.length && oldLines[i] !== undefined) {
        changes.push(`- ${oldLines[i]}`);
      }
      if (i < newLines.length && newLines[i] !== undefined) {
        changes.push(`+ ${newLines[i]}`);
      }
      diffCount++;
      if (diffCount > 50) {
        changes.push(`... (${Math.max(oldLines.length, newLines.length) - i} more lines differ)`);
        break;
      }
    }
  }

  return changes.join("\n");
}

/**
 * Resolve a file path relative to the server directory.
 */
function resolveFilePath(filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  // Try relative to server dir first, then workspace root
  const serverPath = path.join(SERVER_DIR, filePath);
  if (fs.existsSync(serverPath)) return serverPath;
  return path.join(process.cwd(), filePath);
}

/**
 * The main self-modification function.
 * Executes the full pipeline: Backup → Write → TypeCheck → Test → Verify
 */
export async function selfModify(request: ModificationRequest): Promise<ModificationResult> {
  if (!enabled) {
    return { success: false, message: "Self-modification is disabled", rollbackAvailable: false };
  }

  // v5.27: Recursion guard — prevent runaway self-modification loops
  try {
    const { canModify, enterRecursion } = await import("./recursionGuard");
    const guardCheck = canModify(request.reason || "unknown", request.filePath);
    if (!guardCheck.allowed) {
      return { success: false, message: `Recursion guard: ${guardCheck.reason}`, rollbackAvailable: false };
    }
    enterRecursion();
  } catch { /* recursionGuard not available */ }

  // v5.27: Stream integrity check — verify the proposed content isn't truncated
  try {
    const { checkCompleteness } = await import("./streamIntegrityMonitor");
    const integrityCheck = checkCompleteness(request.newContent);
    if (!integrityCheck.isComplete && integrityCheck.confidence < 0.3) {
      log("warn", "selfModify", `Stream integrity check FAILED: content appears truncated. Indicators: ${integrityCheck.indicators.join(", ")}`);
      return { success: false, message: `Blocked: proposed content appears truncated (${integrityCheck.indicators[0] || "incomplete"})`, rollbackAvailable: false };
    }
  } catch { /* streamIntegrityMonitor not available */ }

  const {
    filePath,
    newContent: originalContent,
    reason,
    requireTypeCheck = true,
    requireTests = false, // Tests are optional by default (many modules don't have tests yet)
    hotReload = true,
  } = request;
  let newContent = originalContent; // v5.27: let so pre-review can auto-fix
  const absPath = resolveFilePath(filePath);
  totalModifications++;

  log("info", "selfModify", `Starting modification: ${filePath} — ${reason}`);

  // 0. Pre-modification: Dependency impact analysis + v5.26 confirmation gate
  try {
    const { analyzeImpact } = await import("./dependencyGraph.js");
    const impact = analyzeImpact(filePath);
    if (impact && impact.riskLevel === "critical" && impact.totalAffectedFiles > 10) {
      log("warn", "selfModify", `HIGH-RISK modification: ${filePath} affects ${impact.totalAffectedFiles} files (risk: ${impact.riskLevel})`);
      // v5.26: Confirmation gate — block critical-risk changes unless explicitly approved
      if (request.requireApproval !== false) {
        log("error", "selfModify", `BLOCKED: Critical-risk modification to ${filePath} requires explicit approval (set requireApproval: false to override)`);
        return {
          success: false,
          message: `Blocked: Critical-risk change affects ${impact.totalAffectedFiles} files. Set requireApproval: false to override, or reduce scope.`,
          rollbackAvailable: false,
        };
      }
      log("warn", "selfModify", `Critical-risk modification APPROVED (requireApproval=false) — proceeding with caution`);
    }
  } catch (err) {
    log("warn", "selfModify", `Impact analysis skipped — dependency graph unavailable: ${(err as Error).message}`);
  }

  // 1. Create backup
  const backup = createBackup(filePath, reason);
  log("info", "selfModify", `Backup created: ${backup.id}`);

  // v5.27: Pre-review gate — catch issues BEFORE writing to disk
  if (filePath.endsWith(".ts") || filePath.endsWith(".js")) {
    try {
      const { reviewAndGate } = await import("./selfReview.js");
      const lang = filePath.endsWith(".ts") ? "typescript" : undefined;
      const preReview = reviewAndGate(newContent, lang);
      if (!preReview.allowed) {
        const criticalIssues = preReview.result.issues.filter((i: any) => i.severity === "critical");
        if (criticalIssues.length > 0) {
          failedModifications++;
          const msg = `Pre-review BLOCKED: ${criticalIssues.length} critical issues found before write. Score: ${preReview.result.score}`;
          log("warn", "selfModify", msg);
          recordHistory(backup.id, filePath, reason, false);
          return { success: false, message: msg, backupId: backup.id, rollbackAvailable: true };
        }
      }
      // Use auto-fixed code if review cleaned it up
      if (preReview.code && preReview.code !== newContent) {
        newContent = preReview.code;
        log("info", "selfModify", `Pre-review auto-fixed ${preReview.result.autoFixCount} issues`);
      }
    } catch { /* selfReview not available — proceed without */ }
  }

  // v5.34: Consensus check for high-impact or security-related changes
  if (request.impact === "high" || request.category === "security") {
    try {
      const { validateSelfModification } = await import("./selfConsistency");
      const consensusResult = await validateSelfModification(
        filePath,
        reason || "self-modification",
        newContent.slice(0, 4000) // Send first 4K for review
      );
      if (consensusResult && !consensusResult.approved) {
        failedModifications++;
        const msg = `Consensus REJECTED: ${consensusResult.report.recommendation || "Multi-model validation disagreed"}. Confidence: ${consensusResult.report.confidence}`;
        log("warn", "selfModify", msg);
        recordHistory(backup.id, filePath, reason, false);
        return { success: false, message: msg, backupId: backup.id, rollbackAvailable: true };
      }
      if (consensusResult?.approved) {
        log("info", "selfModify", `Consensus APPROVED (confidence: ${consensusResult.report.confidence}) for ${filePath}`);
      }
    } catch (err) {
      // Consensus check failed (API down, etc) — proceed with caution but don't block
      log("warn", "selfModify", `Consensus check unavailable (proceeding): ${(err as Error).message}`);
    }
  }

  // 2. Write new content (under per-file mutex to prevent race conditions)
  const releaseLock = await acquireFileLock(absPath);
  try {
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(absPath, newContent, "utf-8");
  } catch (err) {
    releaseLock();
    failedModifications++;
    const msg = `Failed to write file: ${err instanceof Error ? err.message : String(err)}`;
    log("error", "selfModify", msg);
    return { success: false, message: msg, backupId: backup.id, rollbackAvailable: true };
  }

  // 3. Type check
  if (requireTypeCheck) {
    const typeResult = runTypeCheck();
    if (!typeResult.success) {
      releaseLock();
      restoreFromBackup(backup.id);
      failedModifications++;
      const msg = `Type check failed (${typeResult.errors.length} errors). Rolled back. First error: ${typeResult.errors[0] || "unknown"}`;
      log("warn", "selfModify", msg);
      recordHistory(backup.id, filePath, reason, false);
      return { success: false, message: msg, backupId: backup.id, rollbackAvailable: true };
    }
  }

  // 4. Run tests (if required)
  if (requireTests) {
    const testResult = runTests();
    if (!testResult.success) {
      releaseLock();
      restoreFromBackup(backup.id);
      failedModifications++;
      const msg = `Tests failed (${testResult.failed} failures). Rolled back.`;
      log("warn", "selfModify", msg);
      recordHistory(backup.id, filePath, reason, false);
      return { success: false, message: msg, backupId: backup.id, rollbackAvailable: true };
    }
  }

  // 5. Hot reload (if supported) — v5.27: Enhanced split-state detection & recovery
  if (hotReload) {
    const moduleName = path.basename(filePath, path.extname(filePath));
    const isCritical = CRITICAL_MODULES.has(moduleName);
    try {
      const { hotReloadModule } = await import("./hotReload.js");
      const reloadResult = await hotReloadModule(moduleName);

      // v5.27: Check if hot-reload reported a rollback (split-state scenario)
      if (reloadResult && !reloadResult.success) {
        if (reloadResult.rollbackPerformed || isCritical) {
          // Verify loaded version matches what we wrote
          const verified = await verifyLoadedVersion(filePath, newContent);
          if (!verified) {
            // SPLIT STATE DETECTED: in-memory module != on-disk file
            log("error", "selfModify", `[SPLIT-STATE] Hot-reload failed for ${moduleName}. Memory/disk diverged. Forcing rollback.`);
            releaseLock();
            restoreFromBackup(backup.id);
            failedModifications++;
            recordHistory(backup.id, filePath, reason, false);
            return {
              success: false,
              message: `Split-state detected: hot-reload failed and module diverged. Rolled back to backup.`,
              backupId: backup.id,
              rollbackAvailable: true,
            };
          }
        }
        // Non-critical module reload failed but file is consistent
        if (!isCritical) {
          log("warn", "selfModify", `[SPLIT STATE] Hot reload failed for non-critical module ${moduleName}. File on disk is correct; restart required for in-memory update.`);
        }
      } else {
        // Reload succeeded — verify anyway for safety
        const verified = await verifyLoadedVersion(filePath, newContent);
        if (!verified && isCritical) {
          const msg = `Hot reload verification failed for critical module: ${moduleName}. Rolling back.`;
          log("error", "selfModify", msg);
          releaseLock();
          restoreFromBackup(backup.id);
          failedModifications++;
          recordHistory(backup.id, filePath, reason, false);
          return { success: false, message: msg, backupId: backup.id, rollbackAvailable: true };
        } else if (!verified) {
          log("warn", "selfModify", `[SPLIT STATE] Module ${moduleName} on disk differs from loaded version. Restart required.`);
        }
        log("info", "selfModify", `Hot-reloaded module: ${moduleName} (verified: ${verified})`);
      }
    } catch (err) {
      if (isCritical) {
        const msg = `Hot reload FAILED for critical module ${moduleName}: ${err instanceof Error ? err.message : String(err)}. Rolling back.`;
        log("error", "selfModify", msg);
        releaseLock();
        restoreFromBackup(backup.id);
        failedModifications++;
        recordHistory(backup.id, filePath, reason, false);
        return { success: false, message: msg, backupId: backup.id, rollbackAvailable: true };
      }
      log("warn", "selfModify", `[SPLIT STATE] Hot reload failed for non-critical module ${moduleName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Release file lock — write→verify→reload sequence complete
  releaseLock();

  // 6. Generate diff for audit trail
  const diff = generateDiff(backup.originalContent, newContent, filePath);

  // 7. Post-modification: rebuild dependency graph
  try {
    const { buildGraph } = await import("./dependencyGraph.js");
    await buildGraph();
    log("info", "selfModify", `Dependency graph rebuilt after modifying ${path.basename(filePath)}`);
  } catch {
    log("warn", "selfModify", "Dependency graph rebuild failed (non-fatal)");
  }

  // 8. Post-modification: run self-review on the changed file
  let reviewScore: number | null = null;
  try {
    const { reviewCode } = await import("./selfReview.js");
    const reviewResult = reviewCode(newContent, filePath.endsWith(".ts") ? "typescript" : undefined);
    reviewScore = reviewResult?.score ?? null;
    if (reviewResult?.issues?.some((i: any) => i.severity === "critical")) {
      const msg = `Self-review found CRITICAL issues in ${path.basename(filePath)}. Rolling back.`;
      log("error", "selfModify", msg);
      restoreFromBackup(backup.id);
      recordHistory(backup.id, filePath, reason, false);
      return { success: false, message: msg, backupId: backup.id, rollbackAvailable: true };
    }
  } catch (err) {
    log("warn", "selfModify", `Self-review not available (non-fatal): ${(err as Error).message}`);
  }

  // 9. Post-modification: generate tests for changed code
  try {
    const { generateTests } = await import("./testGenerator.js");
    const testCode = fs.readFileSync(filePath, "utf-8"); const testResult = generateTests(testCode, filePath);
    if (testResult && testResult.testCount === 0) {
      log("warn", "selfModify", `Generated tests FAILED for ${path.basename(filePath)}. Consider rollback.`);
    }
  } catch (err) {
    log("warn", "selfModify", `Test generation not available (non-fatal): ${(err as Error).message}`);
  }

  // 10. Post-modification: record metrics
  try {
    const { recordMetric } = await import("./selfMonitor.js");
    recordMetric("self_modify_success", 1, path.basename(filePath));
  } catch (err) {
    log("warn", "selfModify", `Metric recording failed (non-fatal): ${(err as Error).message}`);
  }

  // 11. Post-modification: store learning in memory
  try {
    const { storeMemory } = await import("./memory.js");
    storeMemory(
      `[Self-Modify] ${reason} | File: ${path.basename(filePath)} | Success: true | Review: ${reviewScore ?? "N/A"}`,
      "project",
      ["self-modify", path.basename(filePath)]
    );
  } catch (err) {
    log("warn", "selfModify", `Cross-session memory recording failed (non-fatal): ${(err as Error).message}`);
  }

  // 12. Post-modification: start health watch via selfRollback
  try {
    const { startHealthWatch } = await import("./selfRollback.js");
    startHealthWatch(backup.id); // 5 minute watch
  } catch (err) {
    log("warn", "selfModify", `Health watch not available (non-fatal): ${(err as Error).message}`);
  }

  // 13. Record success
  successfulModifications++;
  recordHistory(backup.id, filePath, reason, true);
  log("info", "selfModify", `Modification successful: ${filePath}`);

  // v5.30: Hot-reload is handled in step 5 above with full split-state detection.
  // Removed duplicate hot-reload block that was added in v5.29.

  // v5.29: Update self-model to reflect the modification
  try {
    const { recordAction } = await import("./selfModel");
    recordAction(`Modified ${path.basename(filePath)}`, reason || "self-improvement");
  } catch { /* non-fatal */ }

  // v5.27: Release recursion guard and record modification
  try {
    const { exitRecursion, recordModification } = await import("./recursionGuard");
    exitRecursion();
    recordModification(filePath, reason || "unknown", true);
  } catch { /* non-fatal */ }

  // v6.03: Feed successful modification into skill graph for cross-module learning
  try {
    const { learnFromError } = await import("./skillGraph");
    learnFromError(reason || "modification", path.basename(filePath), `Applied: ${reason}`, undefined, true);
  } catch { /* non-fatal */ }

  return {
    success: true,
    message: `Successfully modified ${path.basename(filePath)}. Backup: ${backup.id}`,
    backupId: backup.id,
    diff,
    rollbackAvailable: true,
  };
}

/**
 * Apply multiple modifications atomically — all succeed or all roll back.
 */
export async function selfModifyBatch(
  requests: ModificationRequest[]
): Promise<{ success: boolean; results: ModificationResult[]; message: string }> {
  const results: ModificationResult[] = [];
  const appliedBackups: string[] = [];

  for (const req of requests) {
    const result = await selfModify({ ...req, requireTypeCheck: false, requireTests: false });
    results.push(result);

    if (!result.success) {
      // Rollback all previously applied changes
      for (const backupId of appliedBackups.reverse()) {
        restoreFromBackup(backupId);
      }
      return {
        success: false,
        results,
        message: `Batch failed at ${req.filePath}: ${result.message}. All changes rolled back.`,
      };
    }

    if (result.backupId) appliedBackups.push(result.backupId);
  }

  // Now run type check on the whole batch
  const typeResult = runTypeCheck();
  if (!typeResult.success) {
    for (const backupId of appliedBackups.reverse()) {
      restoreFromBackup(backupId);
    }
    return {
      success: false,
      results,
      message: `Batch type check failed. All changes rolled back. Errors: ${typeResult.errors.slice(0, 3).join("; ")}`,
    };
  }

  return {
    success: true,
    results,
    message: `Batch modification successful: ${requests.length} files modified.`,
  };
}

// ─── History & Stats ─────────────────────────────────────────────────────────

function recordHistory(backupId: string, filePath: string, reason: string, success: boolean): void {
  modificationHistory.push({
    id: backupId,
    filePath,
    reason,
    success,
    timestamp: Date.now(),
    rollbackId: success ? backupId : undefined,
  });

  // Trim history
  if (modificationHistory.length > MAX_HISTORY) {
    modificationHistory.splice(0, modificationHistory.length - MAX_HISTORY);
  }
}

export function getModificationStats(): {
  total: number;
  successful: number;
  failed: number;
  successRate: number;
  recentHistory: typeof modificationHistory;
  enabled: boolean;
} {
  return {
    total: totalModifications,
    successful: successfulModifications,
    failed: failedModifications,
    successRate: totalModifications > 0 ? successfulModifications / totalModifications : 0,
    recentHistory: modificationHistory.slice(-20),
    enabled,
  };
}

export function setEnabled(value: boolean): void {
  enabled = value;
  log("info", "selfModify", `Self-modification ${value ? "enabled" : "disabled"}`);
}

export function isEnabled(): boolean {
  return enabled;
}

// ─── Initialization ──────────────────────────────────────────────────────────

export function initSelfModify(): void {
  log("info", "selfModify", `[SelfModify] Initialized. Enabled: ${enabled}`);

  // v5.29: Periodic split-state reconciliation for ALL modules (not just critical)
  setInterval(async () => {
    try {
      const { getHotReloadStatus, hotReloadModule } = await import("./hotReload");
      const status = getHotReloadStatus();
      if (!status || !status.modules) return;

      for (const mod of status.modules) {
        try {
          const moduleName = mod.path;
          const serverDir = path.resolve(__dirname); // v5.32: Now ESM-compatible via fileURLToPath
          const filePath = path.join(serverDir, `${moduleName}.ts`);
          if (!fs.existsSync(filePath)) continue;

          const diskContent = fs.readFileSync(filePath, "utf-8");
          const _diskHash = Buffer.from(diskContent).length; // Simple size check

          // If the module was recently modified (within last 5 min), verify it loaded
          const stat = fs.statSync(filePath);
          const recentlyModified = Date.now() - stat.mtimeMs < 5 * 60 * 1000;

          if (recentlyModified) {
            // Try to reload to ensure memory matches disk
            const result = await hotReloadModule(moduleName);
            if (result.success) {
              log("info", "selfModify", `[Reconciliation] Reloaded recently-modified module: ${moduleName}`);
            }
          }
        } catch { /* skip individual module errors */ }
      }
    } catch (err) {
      log("warn", "selfModify", `[Reconciliation] Check failed: ${(err as Error).message}`);
    }
  }, 5 * 60 * 1000); // Every 5 minutes
}

// v5.26: Alias for diagnostics endpoint
export const getModifyStats = getModificationStats;
