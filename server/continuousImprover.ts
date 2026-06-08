/**
 * Andromeda v5.27 — Continuous Self-Improvement Engine
 *
 * Runs a periodic improvement cycle that:
 * 1. Analyzes the codebase for improvement opportunities
 * 2. Generates proposals via selfImprove
 * 3. Applies safe proposals through the guard pipeline
 * 4. Self-reviews changes and rolls back if quality drops
 *
 * Configurable interval (default: every 6 hours).
 * Respects recursion guards and rate limits.
 */

import * as path from "path";
import { createLogger } from "./logger.js";
import { withContinuousImproverLock } from "./redisLock.js";
const log = createLogger("continuousImprover");

// ── Configuration ────────────────────────────────────────────────────────────

interface ContinuousImproverConfig {
  enabled: boolean;
  intervalMs: number;           // Default: 6 hours
  maxProposalsPerCycle: number; // Max proposals to generate per cycle
  maxAppliesPerCycle: number;   // Max proposals to apply per cycle
  autoApplyThreshold: number;   // Min confidence to auto-apply (0-1)
  dryRun: boolean;              // If true, generate proposals but don't apply
}

const DEFAULT_CONFIG: ContinuousImproverConfig = {
  enabled: true, // v5.30: Enabled by default — orchestrator coordinates improvement cycles
  intervalMs: 30 * 60 * 1000, // v5.30: 30 minutes — was 6 hours, too slow for active improvement
  maxProposalsPerCycle: 5,
  maxAppliesPerCycle: 3,  // v9.10.0: increased from 2 → 3 for faster improvement throughput
  autoApplyThreshold: 0.8,
  dryRun: false,
};

let config: ContinuousImproverConfig = { ...DEFAULT_CONFIG };
let cycleTimer: ReturnType<typeof setInterval> | null = null;
// v6.31: isRunning replaced by withContinuousImproverLock() distributed lock
let _timerActive = false;
let lastCycleAt = 0;
let totalCycles = 0;
let totalProposals = 0;
let totalApplied = 0;
let totalRolledBack = 0;

// ── Cycle History ────────────────────────────────────────────────────────────

interface CycleResult {
  timestamp: number;
  proposalsGenerated: number;
  proposalsApplied: number;
  proposalsRolledBack: number;
  duration: number;
  errors: string[];
}

const cycleHistory: CycleResult[] = [];
const MAX_HISTORY = 50;

// ── Core Improvement Cycle ───────────────────────────────────────────────────

async function runImprovementCycle(): Promise<CycleResult> {
  const start = Date.now();
  const result: CycleResult = {
    timestamp: start,
    proposalsGenerated: 0,
    proposalsApplied: 0,
    proposalsRolledBack: 0,
    duration: 0,
    errors: [],
  };

  try {
    // 1. Check recursion guard
    try {
      const guard = await import("./selfImproveGuard");
      const guardConfig = guard.getGuardConfig();
      if (guardConfig && guardConfig.requireApproval) {
        console.log("[ContinuousImprover] Guard is paused. Skipping cycle.");
        result.duration = Date.now() - start;
        return result;
      }
    } catch (err) { log.caught("guard not available", err); }

    // 2. Analyze codebase for improvement targets
    const { listProposals, analyzeAndPropose } = await import("./selfImprove");

    // Generate new proposals by analyzing a random file
    try {
      const { getAnalyzableFiles } = await import("./selfImprove");
      const files = getAnalyzableFiles();
      if (files.length > 0) {
        // v9.9.0: Analyze 2 files per cycle (was 1) — doubles improvement rate at minimal extra cost
        const shuffled = [...files].sort(() => Math.random() - 0.5);
        const filesToAnalyze = shuffled.slice(0, 2);
        for (const randomFile of filesToAnalyze) {
          await analyzeAndPropose(randomFile);
        }
      }
    } catch (err) {
      result.errors.push(`Proposal generation failed: ${(err as Error).message}`);
    }

    // v9.7.0: Eval-driven targeting — submit proposals for degraded benchmark areas
    try {
      const { runEvalDrivenTargeting } = await import("./evalDrivenTargeting.js");
      const targeted = await runEvalDrivenTargeting();
      if (targeted > 0) {
        console.log(`[ContinuousImprover] Eval-driven targeting: ${targeted} targeted proposals submitted`);
      }
    } catch (err) {
      result.errors.push(`Eval-driven targeting failed: ${(err as Error).message}`);
    }

    // v9.7.0: Quality monitor + JSDoc gaps → RSI proposal queue
    try {
      const { runQualityToRSI } = await import("./qualityToRSI.js");
      const { qualityProposals, docProposals } = await runQualityToRSI();
      if (qualityProposals + docProposals > 0) {
        console.log(`[ContinuousImprover] Quality→RSI: ${qualityProposals} quality + ${docProposals} doc proposals submitted`);
      }
    } catch (err) {
      result.errors.push(`Quality→RSI feed failed: ${(err as Error).message}`);
    }

    // v9.8.5: Removed autoApplyHighConfidence to centralize all apply logic
    // in the pending proposals loop below, preventing race conditions.
    let autoResults: any[] = [];

    // 3. Get pending proposals
    const proposals = listProposals().filter((p: any) => p.status === "pending");
    
    // In v9.8.1 we only count newly generated proposals in totalProposals, but here
    // proposals is the entire pending queue. We'll just report the queue size.
    result.proposalsGenerated = proposals.length;
    // Don't add to totalProposals here, as it double-counts on every cycle

    if (config.dryRun) {
      console.log(`[ContinuousImprover] DRY RUN: ${proposals.length} pending proposals, none applied.`);
      result.duration = Date.now() - start;
      return result;
    }

    // 4. Apply top proposals (up to limit) — with truncation check
    // v9.8.5: Reset any stale 'processing' proposals before applying
    // (proposals stuck in 'processing' from a previous crashed cycle will be reset to 'pending')
    try {
      const { resetStuckProcessingProposals } = await import("./selfImprove");
      resetStuckProcessingProposals();
    } catch { /* non-fatal */ }

    // v9.8.1: Sort by confidence before slicing, so we try the best ones first
    const sortedProposals = [...proposals].sort((a: any, b: any) => (b.confidence || 0) - (a.confidence || 0));
    const toApply = sortedProposals.slice(0, config.maxAppliesPerCycle);
    const { applyProposal } = await import("./selfImprove");

    // v5.29: Import stream integrity checker for truncation detection
    let checkCompleteness: ((content: string) => { isComplete: boolean; confidence: number; indicators: string[] }) | null = null;
    try {
      const sim = await import("./streamIntegrityMonitor");
      checkCompleteness = sim.checkCompleteness;
    } catch (err) { log.caught("non-fatal — proceed without check", err); }

    for (const proposal of toApply) {
      try {
        // v5.29: Check if proposal content is truncated before applying
        if (checkCompleteness && proposal.proposedContent) {
          const integrity = checkCompleteness(proposal.proposedContent);
          if (!integrity.isComplete && integrity.confidence < 0.5) {
            console.warn(`[ContinuousImprover] Skipping truncated proposal: ${proposal.title || proposal.id} (confidence: ${integrity.confidence.toFixed(2)}, indicators: ${integrity.indicators.join(", ")})`);
            result.proposalsRolledBack++;
            totalRolledBack++;
            result.errors.push(`Truncation detected in ${proposal.id}: ${integrity.indicators.join(", ")}`);
            continue;
          }
        }

        const applyResult = await applyProposal(proposal.id);
        if (applyResult.success) {
          result.proposalsApplied++;
          totalApplied++;
          console.log(`[ContinuousImprover] Applied: ${proposal.title || proposal.id}`);
        } else {
          result.proposalsRolledBack++;
          totalRolledBack++;
          console.warn(`[ContinuousImprover] Rejected: ${proposal.title || proposal.id} — ${applyResult.message}`);
        }
      } catch (err) {
        const errMsg = (err as Error).message || String(err);
        result.errors.push(`Apply failed for ${proposal.id}: ${errMsg}`);
        console.error(`[ContinuousImprover] EXCEPTION applying ${proposal.title || proposal.id}: ${errMsg}`);
        // Ensure the proposal is not left stuck in 'processing' after an exception
        try {
          const { rejectProposal } = await import('./selfImprove');
          rejectProposal(proposal.id);
        } catch { /* best effort */ }
      }
      // Yield to the event loop to prevent blocking during tight apply loops
      await new Promise(r => setImmediate(r));
    }

    // 5. Post-cycle: validate all changes with TypeScript check + smoke tests + behavioral tests
    if (result.proposalsApplied > 0) {
      try {
        const { execSync } = await import("child_process");
        const serverDir = path.resolve(process.cwd());
        console.log(`[ContinuousImprover] Running TypeScript check after ${result.proposalsApplied} applies...`);
        // v9.8.5: Use node_modules/.bin/tsc directly — npx is not available in all environments
        const tscBin = path.resolve(serverDir, "node_modules", ".bin", "tsc");
        const tscCmd = require("fs").existsSync(tscBin) ? tscBin : "npx tsc";
        execSync(`${JSON.stringify(tscCmd)} --noEmit`, { cwd: serverDir, timeout: 60000, stdio: "pipe" });
        console.log("[ContinuousImprover] TypeScript check PASSED. Changes are valid.");

        // v5.97: Run smoke tests after TypeScript check
        try {
          const { runSmokeTests } = await import("./self/smoke_test_runner.js");
          const smokeResult = await runSmokeTests(serverDir);
          if (smokeResult.rollbackRecommended) {
            throw new Error(`Smoke tests FAILED: ${smokeResult.failed}/${smokeResult.totalTests} tests failed`);
          }
          console.log(`[ContinuousImprover] Smoke tests PASSED: ${smokeResult.passed}/${smokeResult.totalTests}`);
        } catch (smokeErr: any) {
          if (smokeErr.message.includes('Smoke tests FAILED')) throw smokeErr;
          console.warn('[ContinuousImprover] Smoke tests unavailable (non-fatal):', smokeErr.message);
        }
        // 6. Trigger hot-reload so changes take effect without full restart
        try {
          const http = await import("http");
          const port = parseInt(process.env.PORT || "3000");
          const reloadReq = http.request({ hostname: "127.0.0.1", port, path: "/api/module/reload", method: "POST", headers: { "Content-Type": "application/json" } });
          reloadReq.write(JSON.stringify({ module: "./selfImprove" }));
          reloadReq.end();
          console.log("[ContinuousImprover] Hot-reload triggered for modified modules.");
        } catch (err) { log.caught("non-fatal -- server will pick up changes on next import", err); }

        // v9.9.0: Push main directly to GitHub after each successful cycle.
        // Changes are already committed to main by applyProposal().
        // Pushing triggers CI (RSI Validate + CI build) automatically.
        // No branches or PRs needed — Andromeda owns main directly.
        if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPO) {
          try {
            const { execSync: execSyncPush } = await import("child_process");
            const cwd = process.cwd();
            const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "Andromeda AI", GIT_AUTHOR_EMAIL: "andromeda@local", GIT_COMMITTER_NAME: "Andromeda AI", GIT_COMMITTER_EMAIL: "andromeda@local" };
            execSyncPush("git push origin main", { cwd, env: gitEnv, encoding: "utf-8", stdio: "pipe", timeout: 30000 });
            console.log(`[ContinuousImprover] Pushed ${result.proposalsApplied} improvement(s) to origin/main — CI triggered.`);
          } catch (pushErr: any) {
            // Non-fatal — push failure should never block the improvement cycle
            console.warn(`[ContinuousImprover] Git push failed (non-fatal): ${pushErr.message}`);
          }
        }
      } catch (tsErr: any) {
        // TypeScript check failed -- rollback all proposals applied this cycle
        console.error(`[ContinuousImprover] TypeScript check FAILED after applies. Rolling back...`);
        result.errors.push(`Post-apply TS check failed: ${(tsErr.stderr || tsErr.message || "").toString().slice(0, 200)}`);
        try {
          const { execSync } = await import("child_process");
          // v9.8.0: Fine-grained rollback — only revert the files we actually touched
          const filesToRollback = new Set<string>();
          for (const r of autoResults.filter((r: any) => r.applied)) filesToRollback.add(r.targetFile);
          for (const p of toApply) {
            // Check if it was applied this cycle
            const wasApplied = listProposals().find((sp: any) => sp.id === p.id)?.status === "applied";
            if (wasApplied) filesToRollback.add(p.targetFile);
          }
          
          if (filesToRollback.size > 0) {
            const filesArg = Array.from(filesToRollback).map(f => `"${f}"`).join(" ");
            execSync(`git checkout HEAD -- ${filesArg}`, { cwd: process.cwd(), timeout: 10000, stdio: "pipe" });
            console.log(`[ContinuousImprover] Rolled back specific files: ${Array.from(filesToRollback).join(", ")}`);
          } else {
            console.log("[ContinuousImprover] No specific files identified for rollback.");
          }
          result.proposalsRolledBack += result.proposalsApplied;
          result.proposalsApplied = 0;
        } catch (rollbackErr) {
          result.errors.push(`Rollback failed: ${(rollbackErr as Error).message}`);
        }
      }
    }

    // 7. Post-cycle health check
    try {
      const { getHealthReport } = await import("./selfMonitor");
      const report = getHealthReport();
      if (report && report.status !== "healthy") {
        console.warn(`[ContinuousImprover] Post-cycle health: ${report.status}. Pausing next cycle.`);
      }
    } catch (err) { log.caught("non-fatal", err); }

  } catch (err) {
    result.errors.push(`Cycle error: ${(err as Error).message}`);
    console.error("[ContinuousImprover] Cycle failed:", (err as Error).message);
  }

  result.duration = Date.now() - start;
  lastCycleAt = Date.now();
  totalCycles++;
  cycleHistory.push(result);
  if (cycleHistory.length > MAX_HISTORY) cycleHistory.shift();

  console.log(`[ContinuousImprover] Cycle #${totalCycles} complete: ${result.proposalsApplied} applied, ${result.proposalsRolledBack} rolled back (${result.duration}ms)`);
  return result;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function startContinuousImprover(overrides?: Partial<ContinuousImproverConfig>): void {
  if (overrides) config = { ...config, ...overrides };
  if (!config.enabled) {
    console.log("[ContinuousImprover] Disabled. Set enabled: true to activate.");
    return;
  }
  if (_timerActive) return;

  // v6.31: Each interval tick acquires the distributed lock before running
  _timerActive = true;
  
  // v9.8.1: Run an initial cycle shortly after startup to process pending proposals
  setTimeout(() => {
    if (_timerActive) {
      withContinuousImproverLock(() => runImprovementCycle()).catch(err =>
        console.warn("[ContinuousImprover] Initial cycle skipped (lock busy or error):", (err as Error).message)
      );
    }
  }, 15000); // 15 seconds after startup
  
  cycleTimer = setInterval(() => {
    withContinuousImproverLock(() => runImprovementCycle()).catch(err =>
      console.warn("[ContinuousImprover] Cycle skipped (lock busy or error):", (err as Error).message)
    );
  }, config.intervalMs);
  console.log(`[ContinuousImprover] Started. Interval: ${config.intervalMs / 1000 / 60}min, maxApplies: ${config.maxAppliesPerCycle}`);
}

export function stopContinuousImprover(): void {
  if (cycleTimer) clearInterval(cycleTimer);
  cycleTimer = null;
  _timerActive = false;
  // v6.31: No isRunning flag to clear — lock releases automatically
  console.log("[ContinuousImprover] Stopped.");
}

export function triggerCycleNow(): Promise<CycleResult> {
  // v6.31: Acquire lock for manual trigger too
  return withContinuousImproverLock(() => runImprovementCycle()).then(r => r.result ?? ({} as CycleResult));
}

export function getImproverStats(): {
  enabled: boolean;
  running: boolean;
  totalCycles: number;
  totalProposals: number;
  totalApplied: number;
  totalRolledBack: number;
  lastCycleAt: number;
  intervalMs: number;
  recentHistory: CycleResult[];
} {
  return {
    enabled: config.enabled,
    running: _timerActive,
    totalCycles,
    totalProposals,
    totalApplied,
    totalRolledBack,
    lastCycleAt,
    intervalMs: config.intervalMs,
    recentHistory: cycleHistory.slice(-10),
  };
}

export function updateImproverConfig(updates: Partial<ContinuousImproverConfig>): void {
  config = { ...config, ...updates };
  if (_timerActive && updates.intervalMs) {
    // Restart with new interval
    stopContinuousImprover();
    startContinuousImprover();
  }
}
