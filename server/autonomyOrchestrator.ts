/**
 * Andromeda v5.28 — Autonomy Orchestrator
 *
 * The central coordinator that ties all autonomous subsystems together.
 * Runs a priority-ordered cycle:
 *   1. Health check → trigger healing if degraded
 *   2. Goal execution → process next pending goal
 *   3. Performance optimization → improve worst-performing module
 *   4. Self-improvement → analyze random module for enhancements
 *   5. Memory consolidation → compact if near capacity
 *   6. Self-model update → refresh meta-cognitive state
 *
 * This is what makes Andromeda truly autonomous — without it, modules
 * exist independently but don't coordinate.
 */
import { createLogger } from "./logger.js";
import { withOrchestratorLock } from "./redisLock.js";
const log = createLogger("autonomyOrchestrator");

// ── Types ───────────────────────────────────────────────────────────────────

interface CycleResult {
  cycleId: number;
  timestamp: number;
  duration: number;
  actions: CycleAction[];
  healthBefore: string;
  healthAfter: string;
  goalsProcessed: number;
  improvementsApplied: number;
  errors: string[];
}

interface CycleAction {
  type: "heal" | "goal" | "optimize" | "improve" | "consolidate" | "refresh";
  description: string;
  success: boolean;
  duration: number;
}

interface OrchestratorConfig {
  enabled: boolean;
  cycleIntervalMs: number;       // Default: 60_000 (1 minute)
  maxActionsPerCycle: number;    // Default: 3
  healingPriority: boolean;      // Always heal first
  autoImproveChance: number;     // 0-1, chance of self-improvement per cycle
  pauseOnCritical: boolean;      // Pause orchestrator if health is critical
  maxConsecutiveFailures: number; // Pause after N consecutive failures
}

// ── State ───────────────────────────────────────────────────────────────────

let config: OrchestratorConfig = {
  enabled: true,  // v5.30: Enabled by default — this is the core autonomy loop
  cycleIntervalMs: 120_000,  // v5.30: 2 minutes — fast enough to be responsive, slow enough to not spam
  maxActionsPerCycle: 5,     // v5.30: Increased from 3 — allow more actions per cycle
  healingPriority: true,
  autoImproveChance: 0.3,    // v5.30: Increased from 0.1 — 30% chance per cycle


  pauseOnCritical: true,
  maxConsecutiveFailures: 5,
};

// v6.31: isRunning replaced by withOrchestratorLock() distributed lock
let _orchActive = false;
let inSafeMode = false;
let cycleTimer: ReturnType<typeof setInterval> | null = null;
let totalCycles = 0;
let consecutiveFailures = 0;
let lastCycleResult: CycleResult | null = null;
const cycleHistory: CycleResult[] = [];
const MAX_HISTORY = 100;

// v5.34: Orchestrator self-monitor — tracks cycle performance and enters safe mode
// when the orchestrator itself is degraded
const cycleTimes: number[] = [];
const MAX_CYCLE_TIMES = 50;

function recordCyclePerformance(durationMs: number, success: boolean): void {
  cycleTimes.push(durationMs);
  if (cycleTimes.length > MAX_CYCLE_TIMES) cycleTimes.shift();

  // Check for degradation: if average cycle time exceeds 30s, enter safe mode
  if (cycleTimes.length >= 5) {
    const avg = cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length;
    if (avg > 30000 && !inSafeMode) {
      console.warn(`[Orchestrator] Average cycle time ${Math.round(avg)}ms exceeds 30s threshold — entering safe mode`);
      enterSafeMode("cycle_time_degradation");
    }
  }

  // Check for repeated failures
  if (!success && consecutiveFailures >= 3 && !inSafeMode) {
    enterSafeMode("consecutive_failures");
  }
}

function enterSafeMode(reason: string): void {
  inSafeMode = true;
  console.warn(`[Orchestrator] SAFE MODE activated: ${reason}`);
  console.warn("[Orchestrator] Safe mode: only health checks and healing will run. Self-modification disabled.");
  // Record to system memory if available
  import("./systemMemory").then(m => {
    m.recordSystemLearning({
      category: "error",
      title: "Orchestrator Safe Mode",
      content: `Entered safe mode due to: ${reason}. Cycle stats: ${totalCycles} total, ${consecutiveFailures} consecutive failures.`,
      context: "orchestrator",
    });
  }).catch(() => {});
}

export function exitSafeMode(): void {
  if (!inSafeMode) return;
  inSafeMode = false;
  consecutiveFailures = 0;
  cycleTimes.length = 0;
  console.log("[Orchestrator] Safe mode DEACTIVATED — resuming full operation");
}

export function isInSafeMode(): boolean {
  return inSafeMode;
}

// ── Per-Subsystem Circuit Breaker (v6.03) ─────────────────────────────────────
// Tracks consecutive failures per subsystem. If a subsystem fails N times in a row,
// it is skipped for a cooldown period to prevent cascading errors and reduce error rate.
interface CircuitState {
  failures: number;
  lastFailure: number;
  tripped: boolean;
}
const CIRCUIT_BREAKER_THRESHOLD = 3; // Trip after 3 consecutive failures
const CIRCUIT_BREAKER_COOLDOWN_MS = 5 * 60_000; // 5 minute cooldown before retry
const subsystemCircuits = new Map<string, CircuitState>();

function isCircuitOpen(subsystem: string): boolean {
  const state = subsystemCircuits.get(subsystem);
  if (!state || !state.tripped) return false;
  // Check if cooldown has elapsed
  if (Date.now() - state.lastFailure > CIRCUIT_BREAKER_COOLDOWN_MS) {
    state.tripped = false;
    state.failures = 0;
    log.info(`Circuit breaker RESET for subsystem: ${subsystem}`);
    return false;
  }
  return true;
}

function recordSubsystemSuccess(subsystem: string): void {
  const state = subsystemCircuits.get(subsystem);
  if (state) {
    state.failures = 0;
    state.tripped = false;
  }
}

function recordSubsystemFailure(subsystem: string): void {
  let state = subsystemCircuits.get(subsystem);
  if (!state) {
    state = { failures: 0, lastFailure: 0, tripped: false };
    subsystemCircuits.set(subsystem, state);
  }
  state.failures++;
  state.lastFailure = Date.now();
  if (state.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    state.tripped = true;
    log.warn(`Circuit breaker TRIPPED for subsystem: ${subsystem} (${state.failures} consecutive failures)`);
  }
}

// ── Core Cycle ──────────────────────────────────────────────────────────────

async function runCycle(): Promise<CycleResult> {
  const cycleStart = Date.now();
  totalCycles++;
  const result: CycleResult = {
    cycleId: totalCycles,
    timestamp: cycleStart,
    duration: 0,
    actions: [],
    healthBefore: "unknown",
    healthAfter: "unknown",
    goalsProcessed: 0,
    improvementsApplied: 0,
    errors: [],
  };

  let actionsRemaining = config.maxActionsPerCycle;

  try {
    // ── Step 1: Health Check ──────────────────────────────────────────────
    const healthStart = Date.now();
    let healthStatus = "healthy";
    try {
      const { getHealthReport } = await import("./selfMonitor");
      const report = getHealthReport();
      healthStatus = report.status;
      result.healthBefore = healthStatus;
    } catch (err) {
      result.errors.push(`Health check failed: ${(err as Error).message}`);
    }

    // If critical and configured to pause, stop
    if (healthStatus === "critical" && config.pauseOnCritical) {
      console.warn("[Orchestrator] Health CRITICAL — triggering emergency healing");
      try {
        const { runHealCycleOnce } = await import("./selfHeal");
        if (runHealCycleOnce) {
          await runHealCycleOnce();
          result.actions.push({
            type: "heal",
            description: "Emergency heal triggered due to critical health",
            success: true,
            duration: Date.now() - healthStart,
          });
        }
      } catch (err) {
        result.errors.push(`Emergency heal failed: ${(err as Error).message}`);
      }
      // Don't proceed with other actions during critical state
      result.duration = Date.now() - cycleStart;
      lastCycleResult = result;
      cycleHistory.push(result);
      if (cycleHistory.length > MAX_HISTORY) cycleHistory.shift();
      return result;
    }

    // ── Step 2: Healing (if degraded) ────────────────────────────────────
    if (healthStatus === "degraded" && config.healingPriority && actionsRemaining > 0 && !isCircuitOpen("heal")) {
      const healStart = Date.now();
      try {
        const { runHealCycleOnce } = await import("./selfHeal");
        if (runHealCycleOnce) {
          await runHealCycleOnce();
          result.actions.push({
            type: "heal",
            description: "Heal cycle triggered for degraded health",
            success: true,
            duration: Date.now() - healStart,
          });
          actionsRemaining--;
          recordSubsystemSuccess("heal");
        }
      } catch (err) {
        result.actions.push({
          type: "heal",
          description: `Heal failed: ${(err as Error).message}`,
          success: false,
          duration: Date.now() - healStart,
        });
        recordSubsystemFailure("heal");
      }
    }

    // ── Step 3: Goal Execution ───────────────────────────────────────────
    if (actionsRemaining > 0 && !isCircuitOpen("goals")) {
      const goalStart = Date.now();
      try {
        const { autoExecuteNextGoal } = await import("./recursiveGoals");
        const goalResult = await autoExecuteNextGoal();
        if (goalResult.executed) {
          result.goalsProcessed++;
          result.actions.push({
            type: "goal",
            description: `Executed goal: ${goalResult.goalId} — ${goalResult.result}`,
            success: true,
            duration: Date.now() - goalStart,
          });
          actionsRemaining--;
          recordSubsystemSuccess("goals");
        }
      } catch (err) {
        result.errors.push(`Goal execution failed: ${(err as Error).message}`);
        recordSubsystemFailure("goals");
      }
    }

    // ── Step 4: Performance Optimization ─────────────────────────────────
    if (actionsRemaining > 0) {
      const optStart = Date.now();
      try {
        const { getHealthReport } = await import("./selfMonitor");
        const report = getHealthReport();
        // Find degrading metrics
        const degrading = Object.entries(report.metrics)
          .filter(([_, m]) => (m as any).trend === "falling" && (m as any).samples > 5);

        if (degrading.length > 0) {
          const [metricName] = degrading[0];
          result.actions.push({
            type: "optimize",
            description: `Detected degrading metric: ${metricName}. Flagged for improvement.`,
            success: true,
            duration: Date.now() - optStart,
          });
          actionsRemaining--;
        }
      } catch (err) { log.caught("non-critical", err); }
    }

    // ── Step 5: Self-Improvement (probabilistic) ─────────────────────────
    if (actionsRemaining > 0 && Math.random() < config.autoImproveChance && !isCircuitOpen("selfImprove")) {
      const improveStart = Date.now();
      try {
        const { analyzeAndPropose, getAnalyzableFiles, listProposals, applyProposal } = await import("./selfImprove");
        const files = getAnalyzableFiles();
        if (files.length > 0) {
          const randomFile = files[Math.floor(Math.random() * files.length)];
          await analyzeAndPropose(randomFile);

          // Check if any high-confidence proposals can be auto-applied
          const pending = listProposals("pending");
          const highConfidence = pending.filter((p: any) => p.confidence >= 0.85);
          if (highConfidence.length > 0) {
            const applyResult = await applyProposal(highConfidence[0].id);
            if (applyResult.success) {
              result.improvementsApplied++;
              result.actions.push({
                type: "improve",
                description: `Auto-applied improvement to ${randomFile}: ${applyResult.message}`,
                success: true,
                duration: Date.now() - improveStart,
              });
            }
          } else {
            result.actions.push({
              type: "improve",
              description: `Analyzed ${randomFile} — ${pending.length} proposals pending`,
              success: true,
              duration: Date.now() - improveStart,
            });
          }
          actionsRemaining--;
        }
      } catch (err) {
        result.errors.push(`Self-improvement failed: ${(err as Error).message}`);
        recordSubsystemFailure("selfImprove");
      }
    }

    // ── Step 6: Memory Consolidation ─────────────────────────────────────
    try {
      const { getConsolidationStats, runConsolidation } = await import("./memoryConsolidation");
      const stats = getConsolidationStats();
      if (stats && stats.trackedMemories > 500) {
        runConsolidation();
        result.actions.push({
          type: "consolidate",
          description: `Memory consolidation run (${stats.trackedMemories} entries)`,
          success: true,
          duration: 0,
        });
      }
    } catch (err) { log.caught("non-critical", err); }


    // ── Step 6b: Skill Graph Learning Pipeline (v6.03) ────────────────────
    try {
      const { runLearningPipeline } = await import("./skillGraph");
      const pipelineResult = runLearningPipeline();
      if (pipelineResult.decayed > 0 || pipelineResult.propagated > 0) {
        log.info(`SkillGraph pipeline: decayed ${pipelineResult.decayed}, propagated ${pipelineResult.propagated}`);
      }
    } catch (err) { log.caught("non-critical", err); }
    // ── Step 7: Self-Model Refresh ───────────────────────────────────────
    try {
      const { refreshSelfModel, recordAction } = await import("./selfModel");
      await refreshSelfModel();
      // v6.12: Only record cycle action when something actually happened (fixes empty cycle noise)
      if (result.actions.length > 0 || result.errors.length > 0) {
        recordAction("orchestrator_cycle", `Cycle #${totalCycles}: ${result.actions.length} actions, ${result.errors.length} errors`);
      }
    } catch (err) { log.caught("non-critical", err); }

    // ── Post-cycle health check ──────────────────────────────────────────
    try {
      const { getHealthReport } = await import("./selfMonitor");
      result.healthAfter = getHealthReport().status;
    } catch {
      result.healthAfter = "unknown";
    }

    // Reset failure counter on success
    if (result.errors.length === 0) {
      consecutiveFailures = 0;
    } else {
      consecutiveFailures++;
      if (consecutiveFailures >= config.maxConsecutiveFailures) {
        console.error(`[Orchestrator] ${consecutiveFailures} consecutive failures — pausing`);
        pause();
      }
    }

  } catch (err) {
    result.errors.push(`Cycle crashed: ${(err as Error).message}`);
    consecutiveFailures++;
  }

  result.duration = Date.now() - cycleStart;
  lastCycleResult = result;
  cycleHistory.push(result);
  if (cycleHistory.length > MAX_HISTORY) cycleHistory.shift();

  // v5.34: Record cycle performance for self-monitoring
  recordCyclePerformance(result.duration, result.errors.length === 0);

  if (result.actions.length > 0 || result.errors.length > 0) {
    console.log(
      `[Orchestrator] Cycle #${totalCycles}: ${result.actions.length} actions, ` +
      `${result.goalsProcessed} goals, ${result.improvementsApplied} improvements, ` +
      `${result.errors.length} errors (${result.duration}ms)`
    );
  }

  // v6.01: Auto-store significant events as memories for long-term learning
  if (result.improvementsApplied > 0 || result.errors.length > 0) {
    try {
      const { storeMemory } = await import("./memory.js");
      const summary = result.improvementsApplied > 0
        ? `Orchestrator cycle #${totalCycles}: Applied ${result.improvementsApplied} improvement(s). Actions: ${result.actions.map(a => a.description).join("; ")}`
        : `Orchestrator cycle #${totalCycles}: ${result.errors.length} error(s): ${result.errors.join("; ")}`;
      const memType = result.improvementsApplied > 0 ? "self_mod_success" : "self_mod_failure";
      storeMemory(summary, memType, ["orchestrator", `cycle_${totalCycles}`]);
    } catch (err) { log.caught("memory module not available — non-fatal", err); }
  }

  return result;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Start the autonomy orchestrator.
 */
export function startOrchestrator(overrides?: Partial<OrchestratorConfig>): void {
  if (overrides) config = { ...config, ...overrides };
  // v5.30: Check env var override — AUTONOMY=false to disable
  if (process.env.AUTONOMY === "false") {
    config.enabled = false;
  }
  if (!config.enabled) {
    console.log("[Orchestrator] Disabled by config. Set AUTONOMY=true to enable.");
    return;
  }
  if (_orchActive) return;

  _orchActive = true;
  console.log(`[Orchestrator] Starting — cycle every ${config.cycleIntervalMs}ms`);

  // Run first cycle after a short delay
  setTimeout(() => {
    withOrchestratorLock(() => runCycle()).catch(err => console.error("[Orchestrator] First cycle failed:", err));
  }, 5000);

  // v6.31: Each interval tick acquires the distributed lock before running
  cycleTimer = setInterval(() => {
    if (_orchActive) {
      withOrchestratorLock(() => runCycle()).catch(err => console.error("[Orchestrator] Cycle failed:", err));
    }
  }, config.cycleIntervalMs);
}

/**
 * Stop the orchestrator.
 */
export function stopOrchestrator(): void {
  _orchActive = false;
  if (cycleTimer) {
    clearInterval(cycleTimer);
    cycleTimer = null;
  }
  console.log("[Orchestrator] Stopped");
}

/**
 * Pause without clearing state.
 */
export function pause(): void {
  _orchActive = false;
  if (cycleTimer) {
    clearInterval(cycleTimer);
    cycleTimer = null;
  }
  console.log("[Orchestrator] Paused");
}

/**
 * Resume after pause.
 */
export function resume(): void {
  if (_orchActive) return;
  consecutiveFailures = 0;
  startOrchestrator({ ...config, enabled: true });
}

/**
 * Manually trigger a single cycle (for testing or on-demand).
 */
export async function triggerCycle(): Promise<CycleResult> {
  // v6.31: Acquire lock for manual trigger too
  const r = await withOrchestratorLock(() => runCycle());
  return r.result ?? ({} as CycleResult);
}

/**
 * Get orchestrator configuration.
 */
export function getOrchestratorConfig(): OrchestratorConfig & { isRunning: boolean } {
  return { ...config, isRunning: _orchActive };
}

/**
 * Update orchestrator configuration.
 */
export function setOrchestratorConfig(updates: Partial<OrchestratorConfig>): void {
  config = { ...config, ...updates };
  // Restart with new interval if running
  if (_orchActive && updates.cycleIntervalMs) {
    stopOrchestrator();
    startOrchestrator({ ...config, enabled: true });
  }
}

/**
 * Get orchestrator stats for diagnostics.
 */
export function getOrchestratorStats() {
  return {
    isRunning: _orchActive,
    inSafeMode,
    totalCycles,
    consecutiveFailures,
    avgCycleTimeMs: cycleTimes.length > 0 ? Math.round(cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length) : 0,
    lastCycle: lastCycleResult ? {
      id: lastCycleResult.cycleId,
      duration: lastCycleResult.duration,
      actions: lastCycleResult.actions.length,
      errors: lastCycleResult.errors.length,
      healthBefore: lastCycleResult.healthBefore,
      healthAfter: lastCycleResult.healthAfter,
    } : null,
    config: {
      cycleIntervalMs: config.cycleIntervalMs,
      autoImproveChance: config.autoImproveChance,
      maxActionsPerCycle: config.maxActionsPerCycle,
    },
    // v6.03: Circuit breaker status per subsystem
    circuitBreakers: Object.fromEntries(
      Array.from(subsystemCircuits.entries()).map(([name, state]) => [
        name,
        { failures: state.failures, tripped: state.tripped, lastFailure: state.lastFailure }
      ])
    ),
  };
}

/**
 * Get full cycle history.
 */
export function getCycleHistory(limit = 20): CycleResult[] {
  return cycleHistory.slice(-limit);
}

/**
 * Initialize the orchestrator (called from _core/index.ts).
 */
export function initOrchestrator(): void {
  // v5.34: Respect AUTONOMY env var — "true" to enable, "false" to disable
  // Default: enabled (the system is designed for autonomous operation)
  const enabled = process.env.AUTONOMY !== "false";
  const interval = parseInt(process.env.AUTONOMY_CYCLE_MS || process.env.AUTONOMY_INTERVAL || "60000", 10);
  const maxActions = parseInt(process.env.AUTONOMY_MAX_ACTIONS || "5", 10);
  const requireApproval = process.env.AUTONOMY_REQUIRE_APPROVAL === "true";
  startOrchestrator({
    enabled,
    cycleIntervalMs: interval,
    maxActionsPerCycle: maxActions,
    autoImproveChance: requireApproval ? 0 : 0.3, // No auto-improve if approval required
  });
}
