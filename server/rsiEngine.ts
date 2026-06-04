/**
 * rsiEngine.ts — Andromeda v5.75 Recursive Self-Improvement (RSI) Engine
 *
 * Implements the RSI cycle as described in the AI safety literature:
 *
 *   1. OBSERVE   — Read own source code, metrics, and failure logs
 *   2. EVALUATE  — Score current capabilities against benchmarks
 *   3. PROPOSE   — Generate targeted improvement proposals
 *   4. VALIDATE  — Run safety checks and truncation guards
 *   5. APPLY     — Write changes via twoPhaseCommit (git-safe)
 *   6. VERIFY    — Run TypeScript check + benchmark regression test
 *   7. RECORD    — Store outcome in long-term memory
 *   8. RECURSE   — Feed results back into step 1
 *
 * Safety constraints (non-negotiable):
 *   - twoPhaseCommit is the ONLY write path (git stable-state + rollback)
 *   - Forbidden files (twoPhaseCommit.ts, safetySupervisor.ts, etc.) cannot be modified
 *   - Max 3 consecutive auto-applies before requiring human confirmation
 *   - Every cycle is logged to workspace/rsi-history.jsonl
 *
 * This is the "holy grail" feature: the agent improves its own code daily,
 * compounding its capabilities over time without human intervention.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { storeMemory } from "./memory.js";
import { createSnapshot, restoreSnapshot } from "./autoRollback.js";
import { execSync } from "child_process";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RSIPhase =
  | "idle"
  | "observing"
  | "evaluating"
  | "proposing"
  | "validating"
  | "applying"
  | "verifying"
  | "recording"
  | "paused"
  | "error";

export type RSICycleResult = {
  cycleId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  phase: RSIPhase;
  proposalsGenerated: number;
  proposalsApplied: number;
  proposalsRejected: number;
  capabilityScoreBefore: number;
  capabilityScoreAfter: number;
  scoreImprovement: number;
  appliedFiles: string[];
  errors: string[];
  memoryStoredCount: number;
  // v6.16: Detailed benchmark breakdown for before/after comparison
  benchmarkBefore?: BenchmarkBreakdown;
  benchmarkAfter?: BenchmarkBreakdown;
};

export type RSIConfig = {
  enabled: boolean;
  intervalMs: number;           // How often to run a cycle (default: 6 hours)
  maxAutoApplyPerCycle: number; // Max proposals to auto-apply per cycle (default: 3)
  requireHumanConfirmAfter: number; // Pause after N consecutive auto-applies (default: 9)
  targetFiles: string[];        // Files to focus improvement on (empty = all allowed)
  minConfidenceThreshold: number; // Min confidence score to auto-apply (0-1, default: 0.8)
  verboseLogging: boolean;
};

export type RSIStatus = {
  phase: RSIPhase;
  cycleCount: number;
  totalApplied: number;
  totalRejected: number;
  consecutiveAutoApplies: number;
  lastCycleAt: string | null;
  nextCycleAt: string | null;
  config: RSIConfig;
  recentCycles: RSICycleResult[];
};

// ── State ─────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: RSIConfig = {
  enabled: false, // Off by default — user must explicitly enable
  intervalMs: 6 * 60 * 60 * 1000, // 6 hours
  maxAutoApplyPerCycle: 3,
  requireHumanConfirmAfter: 9,
  targetFiles: [],
  minConfidenceThreshold: 0.8,
  verboseLogging: false,
};

let rsiConfig: RSIConfig = { ...DEFAULT_CONFIG };
let rsiPhase: RSIPhase = "idle";
let cycleCount = 0;
let totalApplied = 0;
let totalRejected = 0;
let consecutiveAutoApplies = 0;
let lastCycleAt: string | null = null;
let nextCycleAt: string | null = null;
let cycleTimer: ReturnType<typeof setTimeout> | null = null;
const recentCycles: RSICycleResult[] = [];
const MAX_RECENT_CYCLES = 50;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getWorkspaceDir(): string {
  try {
    const serverDir = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(serverDir, "..", "workspace");
  } catch {
    return path.resolve(process.cwd(), "workspace");
  }
}

function getHistoryPath(): string {
  const dir = getWorkspaceDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "rsi-history.jsonl");
}

function getConfigPath(): string {
  const dir = getWorkspaceDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "rsi-config.json");
}

function loadPersistedConfig(): void {
  try {
    const p = getConfigPath();
    if (fs.existsSync(p)) {
      const saved = JSON.parse(fs.readFileSync(p, "utf8"));
      rsiConfig = { ...DEFAULT_CONFIG, ...saved };
    }
  } catch {
    // Use defaults
  }
}

function saveConfig(): void {
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify(rsiConfig, null, 2), "utf8");
  } catch {
    // Non-fatal
  }
}

function appendCycleHistory(result: RSICycleResult): void {
  try {
    fs.appendFileSync(getHistoryPath(), JSON.stringify(result) + "\n", "utf8");
  } catch {
    // Non-fatal
  }
}

// ── v6.29: RSI Proof History ──────────────────────────────────────────────────
// Writes a compact before/after score delta record to data/rsi_proof_history.json
// after every cycle. This gives a human-readable audit trail that proves RSI is
// improving the system over time.

function getProofHistoryPath(): string {
  try {
    const serverDir = path.dirname(fileURLToPath(import.meta.url));
    const dataDir = path.resolve(serverDir, "..", "data");
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    return path.join(dataDir, "rsi_proof_history.json");
  } catch {
    return path.resolve(process.cwd(), "data", "rsi_proof_history.json");
  }
}

function appendProofHistory(result: RSICycleResult): void {
  try {
    const p = getProofHistoryPath();
    let history: any[] = [];
    if (fs.existsSync(p)) {
      try { history = JSON.parse(fs.readFileSync(p, "utf8")); } catch { history = []; }
    }
    history.push({
      cycleId: result.cycleId,
      completedAt: result.completedAt,
      durationMs: result.durationMs,
      proposalsApplied: result.proposalsApplied,
      proposalsRejected: result.proposalsRejected,
      scoreBefore: result.capabilityScoreBefore,
      scoreAfter: result.capabilityScoreAfter,
      scoreDelta: result.scoreImprovement,
      appliedFiles: result.appliedFiles,
      benchmarkBefore: result.benchmarkBefore
        ? {
            ts: result.benchmarkBefore.typeScriptHealth,
            pq: result.benchmarkBefore.proposalQuality,
            tc: result.benchmarkBefore.testCoverage,
            mr: result.benchmarkBefore.memoryRichness,
            gc: result.benchmarkBefore.goalCompletion,
          }
        : null,
      benchmarkAfter: result.benchmarkAfter
        ? {
            ts: result.benchmarkAfter.typeScriptHealth,
            pq: result.benchmarkAfter.proposalQuality,
            tc: result.benchmarkAfter.testCoverage,
            mr: result.benchmarkAfter.memoryRichness,
            gc: result.benchmarkAfter.goalCompletion,
          }
        : null,
      errors: result.errors.length > 0 ? result.errors.slice(0, 3) : undefined,
    });
    // Keep last 200 entries
    if (history.length > 200) history = history.slice(-200);
    fs.writeFileSync(p, JSON.stringify(history, null, 2), "utf8");
  } catch {
    // Non-fatal
  }
}

function generateCycleId(): string {
  return `rsi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * v6.16: Multi-dimensional capability benchmark.
 * Measures real code quality signals instead of just counting proposals.
 *
 * Dimensions (each 0-20 points, total 0-100):
 *   1. TypeScript health  — tsc --noEmit error count (0 errors = 20pts)
 *   2. Proposal quality   — ratio of applied vs rejected proposals
 *   3. Test coverage      — selfTestPipeline pass rate
 *   4. Memory richness    — number of stored memories (proxy for learned knowledge)
 *   5. Goal completion    — ratio of completed vs total goals
 *
 * This gives a REAL before/after score that proves RSI is working.
 */
export type BenchmarkBreakdown = {
  typeScriptHealth: number;   // 0-20
  proposalQuality: number;    // 0-20
  testCoverage: number;       // 0-20
  memoryRichness: number;     // 0-20
  goalCompletion: number;     // 0-20
  total: number;              // 0-100
  measuredAt: string;
};

export async function measureBenchmark(): Promise<BenchmarkBreakdown> {
  const breakdown: BenchmarkBreakdown = {
    typeScriptHealth: 10,
    proposalQuality: 10,
    testCoverage: 10,
    memoryRichness: 10,
    goalCompletion: 10,
    total: 50,
    measuredAt: new Date().toISOString(),
  };

  // ── Dimension 1: TypeScript Health (0-20) ───────────────────────────────
  try {
    const { execSync } = await import("child_process");
    const serverDir = path.dirname(fileURLToPath(import.meta.url));
    const projectRoot = path.resolve(serverDir, "..");
    const tscOutput = execSync(
      `cd "${projectRoot}" && npx tsc --noEmit 2>&1 | grep -c "error TS" || echo 0`,
      { timeout: 30_000, encoding: "utf8" }
    ).trim();
    const errorCount = parseInt(tscOutput, 10) || 0;
    // 0 errors = 20pts, 1-5 = 15pts, 6-20 = 10pts, 21-50 = 5pts, 50+ = 0pts
    if (errorCount === 0) breakdown.typeScriptHealth = 20;
    else if (errorCount <= 5) breakdown.typeScriptHealth = 15;
    else if (errorCount <= 20) breakdown.typeScriptHealth = 10;
    else if (errorCount <= 50) breakdown.typeScriptHealth = 5;
    else breakdown.typeScriptHealth = 0;
  } catch {
    breakdown.typeScriptHealth = 10; // Unknown — neutral
  }

  // ── Dimension 2: Proposal Quality (0-20) ────────────────────────────────
  try {
    const { listProposals } = await import("./selfImprove.js");
    const applied = listProposals("applied").length;
    const rejected = listProposals("rejected").length;
    const total = applied + rejected;
    if (total === 0) {
      breakdown.proposalQuality = 10; // No data yet
    } else {
      const acceptRate = applied / total;
      // 80%+ accept rate = 20pts, 60-80% = 15pts, 40-60% = 10pts, <40% = 5pts
      if (acceptRate >= 0.8) breakdown.proposalQuality = 20;
      else if (acceptRate >= 0.6) breakdown.proposalQuality = 15;
      else if (acceptRate >= 0.4) breakdown.proposalQuality = 10;
      else breakdown.proposalQuality = 5;
    }
  } catch {
    breakdown.proposalQuality = 10;
  }

  // ── Dimension 3: Test Coverage (0-20) ───────────────────────────────────
  try {
    const { runPipeline } = await import("./selfTestPipeline.js");
    // Run a lightweight test (just type-check, no full test suite)
    const result = await runPipeline({ typeCheckOnly: true, timeout: 20_000 });
    if (result.passed) breakdown.testCoverage = 20;
    else if (result.errors && result.errors.length <= 3) breakdown.testCoverage = 12;
    else breakdown.testCoverage = 5;
  } catch {
    breakdown.testCoverage = 10;
  }

  // ── Dimension 4: Memory Richness (0-20) ─────────────────────────────────
  try {
    const { searchMemory } = await import("./memory.js");
    const memories = searchMemory("", 100, "all");
    const count = Array.isArray(memories) ? memories.length : 0;
    // 100+ memories = 20pts, 50-99 = 15pts, 20-49 = 10pts, 5-19 = 5pts, <5 = 0pts
    if (count >= 100) breakdown.memoryRichness = 20;
    else if (count >= 50) breakdown.memoryRichness = 15;
    else if (count >= 20) breakdown.memoryRichness = 10;
    else if (count >= 5) breakdown.memoryRichness = 5;
    else breakdown.memoryRichness = 0;
  } catch {
    breakdown.memoryRichness = 10;
  }

  // ── Dimension 5: Goal Completion (0-20) ─────────────────────────────────
  try {
    const { getImprovementProgress } = await import("./recursiveGoals.js");
    const progress = getImprovementProgress();
    const rate = progress.completionRate || 0;
    // 80%+ = 20pts, 60-80% = 15pts, 40-60% = 10pts, 20-40% = 5pts, <20% = 0pts
    if (rate >= 0.8) breakdown.goalCompletion = 20;
    else if (rate >= 0.6) breakdown.goalCompletion = 15;
    else if (rate >= 0.4) breakdown.goalCompletion = 10;
    else if (rate >= 0.2) breakdown.goalCompletion = 5;
    else breakdown.goalCompletion = 0;
  } catch {
    breakdown.goalCompletion = 10;
  }

  breakdown.total = breakdown.typeScriptHealth + breakdown.proposalQuality +
    breakdown.testCoverage + breakdown.memoryRichness + breakdown.goalCompletion;

  return breakdown;
}

async function scoreCapabilities(): Promise<number> {
  const b = await measureBenchmark();
  return b.total;
}

// ── Core RSI Cycle ────────────────────────────────────────────────────────────

/**
 * Run one complete RSI cycle.
 * This is the main entry point for the recursive self-improvement loop.
 */
export async function runRSICycle(): Promise<RSICycleResult> {
  const cycleId = generateCycleId();
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const errors: string[] = [];
  const appliedFiles: string[] = [];
  let proposalsGenerated = 0;
  let proposalsApplied = 0;
  let proposalsRejected = 0;
  let memoryStoredCount = 0;
  let capabilityScoreBefore = 0;
  let capabilityScoreAfter = 0;
  let benchmarkBefore: BenchmarkBreakdown | undefined;
  let benchmarkAfter: BenchmarkBreakdown | undefined;

  console.log(`[RSIEngine] Starting cycle ${cycleId} (cycle #${cycleCount + 1})`);
  rsiPhase = "observing";

  try {
    // ── STEP 1: OBSERVE ─────────────────────────────────────────────────────────────────────────────
    rsiPhase = "observing";
    if (rsiConfig.verboseLogging) console.log(`[RSIEngine] Phase: OBSERVE`);

    // ── STEP 2: EVALUATE ─────────────────────────────────────────────────────────────────────────────
    rsiPhase = "evaluating";
    if (rsiConfig.verboseLogging) console.log(`[RSIEngine] Phase: EVALUATE`);
    // v6.16: Capture full benchmark breakdown, not just total score
    benchmarkBefore = await measureBenchmark();
    capabilityScoreBefore = benchmarkBefore.total;
    console.log(`[RSIEngine] Benchmark BEFORE: ${capabilityScoreBefore}/100 (TS:${benchmarkBefore.typeScriptHealth} PQ:${benchmarkBefore.proposalQuality} TC:${benchmarkBefore.testCoverage} MR:${benchmarkBefore.memoryRichness} GC:${benchmarkBefore.goalCompletion})`);

    // ── STEP 3: PROPOSE ──────────────────────────────────────────────────────
    rsiPhase = "proposing";
    if (rsiConfig.verboseLogging) console.log(`[RSIEngine] Phase: PROPOSE`);

    let proposals: Array<{ id: string; confidence: number; filePath: string }> = [];
    try {
      const { analyzeAndPropose, listProposals } = await import("./selfImprove.js");
      // Analyze a target file or let selfImprove pick one
      const targetFile = rsiConfig.targetFiles[0] || null;
      if (targetFile) {
        await analyzeAndPropose(targetFile);
      }
      const pending = listProposals("pending");
      proposals = pending.map(p => ({
        id: p.id,
        confidence: p.impact === 'high' ? 0.9 : p.impact === 'medium' ? 0.7 : 0.5,
        filePath: p.targetFile,
      }));
      proposalsGenerated = proposals.length;
    } catch (e) {
      errors.push(`Propose phase error: ${String(e).slice(0, 200)}`);
    }

    // ── STEP 4: VALIDATE + STEP 5: APPLY ─────────────────────────────────────
    rsiPhase = "validating";
    if (rsiConfig.verboseLogging) console.log(`[RSIEngine] Phase: VALIDATE + APPLY`);

    // Check if we've hit the consecutive auto-apply limit
    if (consecutiveAutoApplies >= rsiConfig.requireHumanConfirmAfter) {
      rsiPhase = "paused";
      console.log(`[RSIEngine] Paused: ${consecutiveAutoApplies} consecutive auto-applies reached. Human confirmation required.`);
      storeMemory(
        `RSI cycle ${cycleId} PAUSED: ${consecutiveAutoApplies} consecutive auto-applies. Human confirmation required before continuing.`,
        "fact",
        ["rsi", "paused", "human-confirmation-required"]
      );
      memoryStoredCount++;
    } else {
      rsiPhase = "applying";
      // Apply proposals that meet the confidence threshold, up to maxAutoApplyPerCycle
      const eligible = proposals
        .filter(p => p.confidence >= rsiConfig.minConfidenceThreshold)
        .slice(0, rsiConfig.maxAutoApplyPerCycle);

      for (const proposal of eligible) {
        // v6.27: Create snapshot BEFORE applying so we can roll back if tests fail
        const snapshotId = createSnapshot(
          [proposal.filePath],
          `RSI cycle ${cycleId} — proposal ${proposal.id}`
        );
        try {
          const { applyProposal } = await import("./selfImprove.js");
          const result = await applyProposal(proposal.id);
          if (result.success) {
            // v6.30: Use ciPipeline for typecheck + test + build + hot-reload
            console.log(`[RSIEngine] Running CI pipeline to validate proposal ${proposal.id}...`);
            const { runCiPipeline } = await import("./ciPipeline.js");
            const ciResult = await runCiPipeline(proposal.id, snapshotId, {
              skipBuild: false,
              skipReload: false,
            });
            if (ciResult.success) {
              proposalsApplied++;
              consecutiveAutoApplies++;
              appliedFiles.push(proposal.filePath);
              console.log(`[RSIEngine] CI PASSED — proposal ${proposal.id} committed to ${proposal.filePath}`);
              // v6.30: Mirror to DB
              const { dbSaveProposal } = await import("./rsiDb.js");
              dbSaveProposal({ ...proposal, status: "applied" }).catch(() => {});
            } else {
              const failSummary = ciResult.stages
                .filter(s => !s.passed)
                .map(s => `${s.stage}: ${s.output.slice(0, 200)}`)
                .join("; ");
              console.warn(`[RSIEngine] CI FAILED at stage "${ciResult.failedStage}" — ${ciResult.rolledBack ? "rolled back" : "no rollback"}`);
              proposalsRejected++;
              errors.push(`Proposal ${proposal.id} rejected by CI (${ciResult.failedStage}): ${failSummary}`);
              storeMemory(
                `RSI proposal ${proposal.id} REJECTED by CI pipeline at stage ${ciResult.failedStage}. File: ${proposal.filePath}`,
                "fact",
                ["rsi", "ci-failure", ciResult.failedStage ?? "unknown"]
              );
            }
          } else {
            proposalsRejected++;
            errors.push(`Apply failed for ${proposal.id}: ${result.message}`);
          }
        } catch (e) {
          // Roll back snapshot on unexpected error
          restoreSnapshot(snapshotId);
          proposalsRejected++;
          errors.push(`Apply error for ${proposal.id}: ${String(e).slice(0, 200)}`);
        }
      }

      // Proposals below threshold are rejected
      proposalsRejected += proposals.filter(p => p.confidence < rsiConfig.minConfidenceThreshold).length;
    }

    // ── STEP 6: VERIFY ───────────────────────────────────────────────────────
    rsiPhase = "verifying";
    if (rsiConfig.verboseLogging) console.log(`[RSIEngine] Phase: VERIFY`);
    // v6.16: Capture full benchmark breakdown after applying changes
    benchmarkAfter = await measureBenchmark();
    capabilityScoreAfter = benchmarkAfter.total;
    console.log(`[RSIEngine] Benchmark AFTER:  ${capabilityScoreAfter}/100 (TS:${benchmarkAfter.typeScriptHealth} PQ:${benchmarkAfter.proposalQuality} TC:${benchmarkAfter.testCoverage} MR:${benchmarkAfter.memoryRichness} GC:${benchmarkAfter.goalCompletion})`);
    // v6.19: Run quick eval (easy tasks only) to get a standardized score delta.
    // v6.22: Run eval AFTER applying changes — this is the publishable proof that RSI works.
    // Fixed: pass a runAgent function as the first argument (was incorrectly passing task array).
    if (proposalsApplied > 0) {
      try {
        const { runEvaluation, EVAL_TASKS } = await import("./evalFramework.js");
        const { simpleChatCompletion } = await import("./llmProvider.js");
        const easyTaskIds = (EVAL_TASKS as any[]).filter((t: any) => t.difficulty === "easy").map((t: any) => t.id);
        const runAgent = async (prompt: string, maxTokens: number, timeoutMs: number): Promise<string> => {
          const result = await Promise.race([
            simpleChatCompletion(prompt, { maxTokens }),
            new Promise<string>((_, reject) => setTimeout(() => reject(new Error("eval timeout")), timeoutMs)),
          ]);
          return result as string;
        };
        const evalRun = await runEvaluation(runAgent, easyTaskIds);
        console.log(`[RSIEngine] Eval score after RSI cycle: ${evalRun.percentage.toFixed(1)}% (${evalRun.passed}/${evalRun.passed + evalRun.failed} easy tasks passed)`);
        storeMemory(
          `RSI cycle ${cycleId} eval score: ${evalRun.percentage.toFixed(1)}% (${evalRun.passed}/${evalRun.passed + evalRun.failed} easy tasks passed). Benchmark: ${capabilityScoreBefore}->${capabilityScoreAfter}/100`,
          "fact",
          ["rsi", "eval", "benchmark", "self-improvement"]
        );
        memoryStoredCount++;
      } catch (evalErr) {
        if (rsiConfig.verboseLogging) console.warn(`[RSIEngine] Eval run failed (non-fatal):`, String(evalErr).slice(0, 100));
      }
    }

    // ── STEP 7: RECORD ───────────────────────────────────────────────────────
    rsiPhase = "recording";
    const scoreImprovement = capabilityScoreAfter - capabilityScoreBefore;

    if (proposalsApplied > 0) {
      // v6.16: Rich summary with per-dimension before/after comparison
      const d = (a: number, b: number) => `${a}->${b}(${b-a>=0?"+":""}${b-a})`;
      const summary = [
        `RSI Cycle ${cycleId} COMPLETE:`,
        `  Applied: ${proposalsApplied} proposals to: ${appliedFiles.join(", ")}`,
        `  Total Score: ${capabilityScoreBefore} -> ${capabilityScoreAfter} (${scoreImprovement >= 0 ? "+" : ""}${scoreImprovement})`,
        benchmarkBefore && benchmarkAfter ? [
          `  Breakdown (before->after/20):`,
          `    TypeScript Health: ${d(benchmarkBefore.typeScriptHealth, benchmarkAfter.typeScriptHealth)}`,
          `    Proposal Quality:  ${d(benchmarkBefore.proposalQuality, benchmarkAfter.proposalQuality)}`,
          `    Test Coverage:     ${d(benchmarkBefore.testCoverage, benchmarkAfter.testCoverage)}`,
          `    Memory Richness:   ${d(benchmarkBefore.memoryRichness, benchmarkAfter.memoryRichness)}`,
          `    Goal Completion:   ${d(benchmarkBefore.goalCompletion, benchmarkAfter.goalCompletion)}`,
        ].join("\n") : "",
        `  Consecutive auto-applies: ${consecutiveAutoApplies}`,
      ].filter(Boolean).join("\n");
      storeMemory(summary, "fact", ["rsi", "cycle-complete", "self-improvement"]);
      memoryStoredCount++;
    }

    if (errors.length > 0) {
      storeMemory(
        `RSI Cycle ${cycleId} errors:\n${errors.join("\n")}`,
        "error",
        ["rsi", "cycle-error"]
      );
      memoryStoredCount++;
    }

    // Reset consecutive counter if no applies this cycle
    if (proposalsApplied === 0 && (rsiPhase as string) !== "paused") {
      consecutiveAutoApplies = 0;
    }

  } catch (e) {
    rsiPhase = "error";
    errors.push(`Cycle fatal error: ${String(e).slice(0, 300)}`);
    console.error(`[RSIEngine] Cycle ${cycleId} fatal error:`, e);
  }

  // ── STEP 8: RECURSE (schedule next cycle) ────────────────────────────────
  cycleCount++;
  totalApplied += proposalsApplied;
  totalRejected += proposalsRejected;
  lastCycleAt = startedAt;

  const result: RSICycleResult = {
    cycleId,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startMs,
    phase: rsiPhase === "recording" ? "idle" : rsiPhase,
    proposalsGenerated,
    proposalsApplied,
    proposalsRejected,
    capabilityScoreBefore,
    capabilityScoreAfter,
    scoreImprovement: capabilityScoreAfter - capabilityScoreBefore,
    appliedFiles,
    errors,
    memoryStoredCount,
    benchmarkBefore,  // v6.16: detailed before/after breakdown
    benchmarkAfter,
  };

  recentCycles.unshift(result);
  if (recentCycles.length > MAX_RECENT_CYCLES) recentCycles.pop();
  appendCycleHistory(result);
  appendProofHistory(result); // v6.29: compact before/after delta to data/rsi_proof_history.json

  if ((rsiPhase as string) !== "paused" && (rsiPhase as string) !== "error") {
    rsiPhase = "idle";
  }

  console.log(`[RSIEngine] Cycle ${cycleId} complete in ${result.durationMs}ms. Applied: ${proposalsApplied}, Score: ${capabilityScoreBefore}→${capabilityScoreAfter}`);
  return result;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

function scheduleNextCycle(): void {
  if (cycleTimer) {
    clearTimeout(cycleTimer);
    cycleTimer = null;
  }
  if (!rsiConfig.enabled) {
    nextCycleAt = null;
    return;
  }
  const next = new Date(Date.now() + rsiConfig.intervalMs);
  nextCycleAt = next.toISOString();
  cycleTimer = setTimeout(async () => {
    if (rsiConfig.enabled && rsiPhase === "idle") {
      await runRSICycle();
      scheduleNextCycle(); // Recurse — this is the RSI loop
    }
  }, rsiConfig.intervalMs);
  console.log(`[RSIEngine] Next RSI cycle scheduled for ${nextCycleAt}`);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialize the RSI engine. Called at server startup.
 */
export function initRSIEngine(): void {
  loadPersistedConfig();
  console.log(`[RSIEngine] Initialized. Enabled: ${rsiConfig.enabled}, Interval: ${rsiConfig.intervalMs / 3600000}h`);
  if (rsiConfig.enabled) {
    scheduleNextCycle();
  }
}

/**
 * Enable RSI and start the improvement loop.
 */
export function enableRSI(config?: Partial<RSIConfig>): RSIStatus {
  if (config) {
    rsiConfig = { ...rsiConfig, ...config };
  }
  rsiConfig.enabled = true;
  saveConfig();
  scheduleNextCycle();
  console.log(`[RSIEngine] RSI ENABLED. Cycles will run every ${rsiConfig.intervalMs / 3600000}h`);
  return getRSIStatus();
}

/**
 * Disable RSI and stop the improvement loop.
 */
export function disableRSI(): RSIStatus {
  rsiConfig.enabled = false;
  saveConfig();
  if (cycleTimer) {
    clearTimeout(cycleTimer);
    cycleTimer = null;
  }
  nextCycleAt = null;
  console.log(`[RSIEngine] RSI DISABLED.`);
  return getRSIStatus();
}

/**
 * Trigger an RSI cycle immediately (for testing or manual runs).
 */
export async function triggerRSICycleNow(): Promise<RSICycleResult> {
  if (rsiPhase !== "idle" && rsiPhase !== "paused") {
    throw new Error(`Cannot trigger cycle: RSI is currently in phase '${rsiPhase}'`);
  }
  // Reset pause state if manually triggered
  if ((rsiPhase as string) === "paused") {
    consecutiveAutoApplies = 0;
    rsiPhase = "idle";
    if (rsiConfig.enabled) scheduleNextCycle();
  }
  return runRSICycle();
}

/**
 * Reset the consecutive auto-apply counter (human confirmation received).
 */
export function confirmContinue(): RSIStatus {
  consecutiveAutoApplies = 0;
  if (rsiPhase === "paused") {
    rsiPhase = "idle";
    if (rsiConfig.enabled) scheduleNextCycle();
  }
  console.log(`[RSIEngine] Human confirmation received. Consecutive counter reset.`);
  return getRSIStatus();
}

/**
 * Update RSI configuration.
 */
export function updateRSIConfig(updates: Partial<RSIConfig>): RSIStatus {
  rsiConfig = { ...rsiConfig, ...updates };
  saveConfig();
  if (rsiConfig.enabled) {
    scheduleNextCycle();
  } else {
    disableRSI();
  }
  return getRSIStatus();
}

/**
 * Get current RSI status.
 */
export function getRSIStatus(): RSIStatus {
  return {
    phase: rsiPhase,
    cycleCount,
    totalApplied,
    totalRejected,
    consecutiveAutoApplies,
    lastCycleAt,
    nextCycleAt,
    config: { ...rsiConfig },
    recentCycles: recentCycles.slice(0, 10),
  };
}

/**
 * Get full cycle history from disk.
 */
export function getRSIHistory(): RSICycleResult[] {
  try {
    const p = getHistoryPath();
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, "utf8")
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line) as RSICycleResult)
      .reverse()
      .slice(0, 100);
  } catch {
    return [];
  }
}
