/**
 * parallelRsi.ts — Multi-Agent RSI Parallelism
 * Andromeda v9.14.0
 *
 * Runs 2-3 RSI workers simultaneously on different module groups,
 * achieving ~3x throughput compared to single-threaded RSI.
 *
 * Architecture:
 *   - Partitions ANALYZABLE_FILES into N worker groups (by domain)
 *   - Each worker runs analyzeAndPropose() on its assigned modules
 *   - A coordinator collects all proposals and applies them sequentially
 *     (applies are always sequential to prevent file conflicts)
 *   - Workers are Node.js async tasks (not OS threads) — safe for single-core
 *
 * Worker Groups:
 *   Group A — Application layer (ai, browser, memory, reactEngine, etc.)
 *   Group B — RSI engine (selfImprove, rsiEngine, continuousImprover, etc.)
 *   Group C — Infrastructure (benchmarkRunner, telemetry, cache, etc.)
 */

import { analyzeAndPropose, resolveServerFile, applyProposal, ImprovementProposal } from "./selfImprove";
import { insertRsiCycle, finishRsiCycle } from "./andromedaDb";

// ─── Worker Group Definitions ────────────────────────────────────────────────

const WORKER_GROUPS: Record<string, string[]> = {
  "application": [
    "ai.ts", "grounding.ts", "browser.ts", "workspace.ts", "memory.ts",
    "multiAgent.ts", "biasDetector.ts", "codeIntel.ts", "reactEngine.ts",
    "llmProvider.ts", "contextManager.ts", "adaptiveRouter.ts",
    "selfConsistency.ts", "contextBus.ts", "manifest.ts", "streamRouter.ts",
    "aiMemory.ts", "aiPlanning.ts", "contextAwareness.ts", "search.ts",
  ],
  "rsi-engine": [
    "selfImprove.ts", "rsiEngine.ts", "continuousImprover.ts",
    "qualityToRSI.ts", "evalDrivenTargeting.ts", "testGenerator.ts",
    "consensusEngine.ts", "selfHeal.ts", "selfIntrospect.ts",
    "selfKnowledgeBase.ts", "selfModel.ts", "selfReflectionEngine.ts",
    "selfReview.ts", "selfRollback.ts", "testGenerator.ts",
    "selfTestPipeline.ts", "selfDocumentation.ts",
  ],
  "infrastructure": [
    "benchmarkRunner.ts", "vectorMemory.ts", "persistentContextStore.ts",
    "episodicMemory.ts", "selfRollback.ts", "autoRebuild.ts",
    "codeQualityMonitor.ts", "codebaseAnalyzer.ts", "dependencyGraph.ts",
    "docGenerator.ts", "skillGraph.ts", "telemetry.ts",
    "tokenBudgetManager.ts", "watchdog.ts", "circuitBreaker.ts",
    "cache.ts", "adaptiveEval.ts", "aiChangelog.ts", "systemMemory.ts",
    "capabilityDiscovery.ts", "capabilityBootstrapper.ts", "scheduler.ts",
    "taskDecomposer.ts", "taskPlanner.ts", "tieredContextManager.ts",
  ],
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ParallelCycleResult {
  cycleNum: number;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  workers: WorkerResult[];
  totalProposals: number;
  totalApplied: number;
  totalRolledBack: number;
}

export interface WorkerResult {
  group: string;
  proposals: ImprovementProposal[];
  applied: number;
  rolledBack: number;
  durationMs: number;
  error?: string;
}

// ─── State ───────────────────────────────────────────────────────────────────

let _cycleCount = 0;
let _isRunning = false;
let _lastResult: ParallelCycleResult | null = null;

// ─── Worker ──────────────────────────────────────────────────────────────────

/**
 * Run a single RSI worker on a specific module group.
 * Returns proposals without applying them (coordinator handles applies).
 */
async function runWorker(group: string, files: string[], maxProposals: number): Promise<WorkerResult> {
  const start = Date.now();
  const result: WorkerResult = {
    group,
    proposals: [],
    applied: 0,
    rolledBack: 0,
    durationMs: 0,
  };

  try {
    // Filter to only files that exist on disk
    const validFiles = files.filter(f => resolveServerFile(f) !== null);
    if (validFiles.length === 0) {
      result.durationMs = Date.now() - start;
      return result;
    }

    // Pick a random subset to analyze (avoid analyzing all files every cycle)
    const sampleSize = Math.min(maxProposals * 2, validFiles.length);
    const shuffled = [...validFiles];
    // Fisher-Yates shuffle using crypto.randomBytes for unbiased randomness
    const { randomBytes } = await import('crypto');
    for (let i = shuffled.length - 1; i > 0; i--) {
      const rand = randomBytes(4).readUInt32BE(0) / 0xFFFFFFFF;
      const j = Math.floor(rand * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const toAnalyze = shuffled.slice(0, sampleSize);

    // Analyze each file and collect proposals
    for (const file of toAnalyze) {
      try {
        const proposal = await analyzeAndPropose(file);
        if (proposal) {
          result.proposals.push(proposal);
        }
        if (result.proposals.length >= maxProposals) break;
      } catch (err) {
        // Individual file failures are non-fatal
        console.warn(`[ParallelRSI:${group}] Analysis failed for ${file}:`, err);
      }
    }

    result.proposals = result.proposals.slice(0, maxProposals);
  } catch (err) {
    result.error = String(err);
    console.warn(`[ParallelRSI:${group}] Worker failed:`, err);
  }

  result.durationMs = Date.now() - start;
  return result;
}

// ─── Coordinator ─────────────────────────────────────────────────────────────

/**
 * Run all 3 workers in parallel, then apply proposals sequentially.
 * Returns a summary of the full parallel cycle.
 */
export async function runParallelCycle(options: {
  maxProposalsPerWorker?: number;
  maxAppliesTotal?: number;
  workerGroups?: string[];
} = {}): Promise<ParallelCycleResult> {
  if (_isRunning) {
    throw new Error("[ParallelRSI] Cycle already running — cannot start another");
  }

  // Validate input options
  if (options.maxProposalsPerWorker !== undefined && (typeof options.maxProposalsPerWorker !== 'number' || options.maxProposalsPerWorker < 1)) {
    throw new Error("[ParallelRSI] maxProposalsPerWorker must be a positive number");
  }
  if (options.maxAppliesTotal !== undefined && (typeof options.maxAppliesTotal !== 'number' || options.maxAppliesTotal < 0)) {
    throw new Error("[ParallelRSI] maxAppliesTotal must be a non-negative number");
  }
  if (options.workerGroups !== undefined && (!Array.isArray(options.workerGroups) || options.workerGroups.length === 0)) {
    throw new Error("[ParallelRSI] workerGroups must be a non-empty array");
  }

  _isRunning = true;
  _cycleCount++;
  const cycleNum = _cycleCount;
  const startedAt = Date.now();
  const maxProposalsPerWorker = options.maxProposalsPerWorker ?? 3;
  const maxAppliesTotal = options.maxAppliesTotal ?? 6; // 2 per worker × 3 workers
  const groupsToRun = options.workerGroups ?? Object.keys(WORKER_GROUPS);

  console.log(`[ParallelRSI] Cycle #${cycleNum} starting — ${groupsToRun.length} workers in parallel`);

  // Record cycle start in SQLite
  const dbId = insertRsiCycle({
    cycleNum,
    startedAt,
    proposals: 0,
    applied: 0,
    rolledBack: 0,
  });

  try {
    // ── Phase 1: Run all workers in parallel ─────────────────────────────────
    const workerPromises = groupsToRun.map(group =>
      runWorker(group, WORKER_GROUPS[group] ?? [], maxProposalsPerWorker)
    );
    const workerResults = await Promise.all(workerPromises);

    // ── Phase 2: Collect all proposals ───────────────────────────────────────
    const allProposals: ImprovementProposal[] = [];
    for (const wr of workerResults) {
      allProposals.push(...wr.proposals);
    }

    // Sort by confidence (highest first)
    allProposals.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

    console.log(`[ParallelRSI] Cycle #${cycleNum}: ${allProposals.length} proposals collected from ${workerResults.length} workers`);

    // ── Phase 3: Apply proposals sequentially (prevent file conflicts) ───────
    let applied = 0;
    let rolledBack = 0;

    for (const proposal of allProposals) {
      if (applied + rolledBack >= maxAppliesTotal) break;

      try {
        if (!proposal.id) continue;
        const applyResult = await applyProposal(proposal.id);
        if (applyResult.success) {
          applied++;
          // Credit the worker that produced this proposal
          const worker = workerResults.find(w => w.proposals.includes(proposal));
          if (worker) worker.applied++;
        } else {
          rolledBack++;
          const worker = workerResults.find(w => w.proposals.includes(proposal));
          if (worker) worker.rolledBack++;
        }
      } catch (err) {
        console.warn(`[ParallelRSI] Apply failed for proposal "${proposal.title}":`, err);
        rolledBack++;
      }
    }

    const finishedAt = Date.now();
    const result: ParallelCycleResult = {
      cycleNum,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      workers: workerResults,
      totalProposals: allProposals.length,
      totalApplied: applied,
      totalRolledBack: rolledBack,
    };

    _lastResult = result;
    finishRsiCycle(dbId, finishedAt);

    console.log(
      `[ParallelRSI] Cycle #${cycleNum} complete: ` +
      `${allProposals.length} proposals, ${applied} applied, ${rolledBack} rolled back ` +
      `in ${Math.round(result.durationMs / 1000)}s`
    );

    return result;

  } finally {
    _isRunning = false;
  }
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

let _schedulerTimer: ReturnType<typeof setInterval> | null = null;

/** Start the parallel RSI scheduler */
export function startParallelRsi(intervalMs = 30 * 60 * 1000): void {
  if (_schedulerTimer) return; // Already running

  console.log(`[ParallelRSI] Scheduler started — interval: ${intervalMs / 1000 / 60}min, workers: ${Object.keys(WORKER_GROUPS).length}`);

  // Run first cycle after a short delay (let server finish booting)
  setTimeout(() => {
    runParallelCycle().catch(err => console.warn("[ParallelRSI] First cycle failed:", err));
  }, 5 * 60 * 1000).unref(); // 5 min after boot

  _schedulerTimer = setInterval(() => {
    runParallelCycle().catch(err => console.warn("[ParallelRSI] Scheduled cycle failed:", err));
  }, intervalMs).unref();
}

/** Stop the parallel RSI scheduler */
export function stopParallelRsi(): void {
  if (_schedulerTimer) {
    clearInterval(_schedulerTimer);
    _schedulerTimer = null;
    console.log("[ParallelRSI] Scheduler stopped");
  }
}

/** Get current parallel RSI status */
export function getParallelRsiStatus(): {
  isRunning: boolean;
  cycleCount: number;
  lastResult: ParallelCycleResult | null;
  workerGroups: Record<string, number>;
} {
  return {
    isRunning: _isRunning,
    cycleCount: _cycleCount,
    lastResult: _lastResult,
    workerGroups: Object.fromEntries(
      Object.entries(WORKER_GROUPS).map(([k, v]) => [k, v.length])
    ),
  };
}
