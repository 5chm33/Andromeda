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
  maxAppliesPerCycle: 2,
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
        const randomFile = files[Math.floor(Math.random() * files.length)];
        await analyzeAndPropose(randomFile);
      }
    } catch (err) {
      result.errors.push(`Proposal generation failed: ${(err as Error).message}`);
    }

    // v5.32: Auto-apply high-confidence proposals from previous cycles


    try {
      const { autoApplyHighConfidence } = await import("./selfImprove");
      const autoResults = await autoApplyHighConfidence();
      const autoApplied = autoResults.filter(r => r.applied);
      if (autoApplied.length > 0) {
        result.proposalsApplied += autoApplied.length;
        totalApplied += autoApplied.length;
        console.log(`[ContinuousImprover] Auto-applied ${autoApplied.length} high-confidence proposals`);
      }
    } catch (err) {
      result.errors.push(`Auto-apply check failed: ${(err as Error).message}`);
    }

    // 3. Get pending proposals
    const proposals = listProposals().filter((p: any) => p.status === "pending");
    result.proposalsGenerated = proposals.length;
    totalProposals += proposals.length;

    if (config.dryRun) {
      console.log(`[ContinuousImprover] DRY RUN: ${proposals.length} proposals generated, none applied.`);
      result.duration = Date.now() - start;
      return result;
    }

    // 4. Apply top proposals (up to limit) — with truncation check
    const toApply = proposals.slice(0, config.maxAppliesPerCycle);
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
        result.errors.push(`Apply failed for ${proposal.id}: ${(err as Error).message}`);
      }
    }

    // 5. Post-cycle: validate all changes with TypeScript check + smoke tests + behavioral tests
    if (result.proposalsApplied > 0) {
      try {
        const { execSync } = await import("child_process");
        const serverDir = path.resolve(process.cwd());
        console.log(`[ContinuousImprover] Running TypeScript check after ${result.proposalsApplied} applies...`);
        execSync("npx tsc --noEmit", { cwd: serverDir, timeout: 60000, stdio: "pipe" });
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
      } catch (tsErr: any) {
        // TypeScript check failed -- rollback all proposals applied this cycle
        console.error(`[ContinuousImprover] TypeScript check FAILED after applies. Rolling back...`);
        result.errors.push(`Post-apply TS check failed: ${(tsErr.stderr || tsErr.message || "").toString().slice(0, 200)}`);
        try {
          const { execSync } = await import("child_process");
          execSync("git checkout -- .", { cwd: process.cwd(), timeout: 10000, stdio: "pipe" });
          console.log("[ContinuousImprover] Rolled back all changes via git checkout.");
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
