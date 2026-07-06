/**
 * rsiScheduler.ts — v12.13.0
 *
 * Registers a persistent, configurable RSI auto-trigger task using the existing
 * scheduler.ts infrastructure. Unlike the one-shot enableRSI() call in initModules,
 * this task:
 *
 *   - Survives server restarts (stored in workspace/.andromeda_scheduler.json)
 *   - Can be paused, resumed, and reconfigured via the API
 *   - Fires every 6 hours by default (configurable via RSI_SCHEDULE_HOURS env var)
 *   - Skips if an RSI cycle is already running
 *   - Logs each trigger to data/rsi_schedule_log.json
 *
 * v12.13.0: Adaptive backoff — interval automatically adjusts based on recent cycle success rate:
 *   - >90% success rate over last 10 cycles → shorten to 2h (high momentum)
 *   - 70–90% success rate → keep default (6h)
 *   - 50–70% success rate → extend to 12h (moderate caution)
 *   - <50% success rate → extend to 24h (high caution, something is wrong)
 *
 * Exports:
 *   initRsiScheduler()          — call once on startup
 *   getRsiSchedulerStatus()     — returns current task status + next run time
 *   setRsiScheduleHours(n)      — change interval (1–168 hours)
 *   pauseRsiScheduler()         — pause the scheduled task
 *   resumeRsiScheduler()        — resume the scheduled task
 *   computeAdaptiveInterval()   — compute the optimal interval based on recent history
 */

import fs from "fs";
import { createRequire } from "module";
const _require = createRequire(import.meta.url);
import path from "path";
import { createLogger } from "./logger.js";
import {
  createTask,
  listTasks,
  pauseTask,
  resumeTask,
  getTask,
  type ScheduledTask,
} from "./scheduler.js";

const log = createLogger("rsiScheduler");

// ─── Config ───────────────────────────────────────────────────────────────────

const RSI_TASK_NAME = "andromeda-rsi-auto-trigger";
const RSI_TASK_TAG  = "rsi-auto";
const DEFAULT_HOURS = parseFloat(process.env.RSI_SCHEDULE_HOURS ?? "6") || 6; // v11.290.0: parseFloat supports fractional hours (e.g. 0.083 = 5 min)

// ─── Schedule log ─────────────────────────────────────────────────────────────

function getScheduleLogPath(): string {
  const dir = path.resolve(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "rsi_schedule_log.json");
}

type ScheduleLogEntry = {
  triggeredAt: number;
  source: "scheduler";
  intervalHours: number;
  cycleStarted: boolean;
  note?: string;
};

function appendScheduleLog(entry: ScheduleLogEntry): void {
  const p = getScheduleLogPath();
  let entries: ScheduleLogEntry[] = [];
  try {
    if (fs.existsSync(p)) entries = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { /* start fresh */ }
  const MAX_LOG_ENTRIES = 500;
  entries.push(entry);
  // Keep last MAX_LOG_ENTRIES entries
  if (entries.length > MAX_LOG_ENTRIES) entries = entries.slice(-MAX_LOG_ENTRIES);
  fs.writeFileSync(p, JSON.stringify(entries, null, 2), "utf8");
}

// ─── Adaptive Backoff ────────────────────────────────────────────────────────

/**
 * v12.13.0: Compute the optimal RSI trigger interval based on recent cycle success rates.
 * Reads the last N cycles from rsiEngine history and adjusts the interval accordingly.
 *
 * @returns Recommended interval in hours
 */
export async function computeAdaptiveInterval(lookback = 10): Promise<number> {
  try {
    const { getRSIHistory } = await import("./rsiEngine.js");
    const history = await getRSIHistory();
    if (history.length < 3) {
      // Not enough data — use default
      return DEFAULT_HOURS;
    }
    const recent = history.slice(0, lookback);
    const successCount = recent.filter(c => c.proposalsApplied > 0).length;
    const successRate = successCount / recent.length;

    let recommendedHours: number;
    if (successRate >= 0.9) {
      recommendedHours = 2;  // High momentum — run more frequently
    } else if (successRate >= 0.7) {
      recommendedHours = DEFAULT_HOURS;  // Normal operation
    } else if (successRate >= 0.5) {
      recommendedHours = 12; // Moderate issues — slow down
    } else {
      recommendedHours = 24; // High failure rate — significant backoff
    }

    log.info(
      `[rsiScheduler] Adaptive interval: successRate=${(successRate * 100).toFixed(0)}% over last ${recent.length} cycles → ${recommendedHours}h (was ${DEFAULT_HOURS}h)`
    );
    return recommendedHours;
  } catch {
    return DEFAULT_HOURS; // Fallback to default on error
  }
}

/**
 * v12.13.0: Apply adaptive backoff — compute the optimal interval and update the scheduler task.
 * Called after each RSI cycle completes to keep the schedule in sync with system health.
 */
async function applyAdaptiveBackoff(): Promise<void> {
  try {
    const recommended = await computeAdaptiveInterval();
    const task = _taskId ? getTask(_taskId) : findExistingTask();
    if (!task) return;
    const currentHours = Math.round((task.intervalSeconds ?? DEFAULT_HOURS * 3600) / 3600);
    if (Math.abs(currentHours - recommended) >= 1) {
      // Interval has changed by at least 1 hour — update it
      setRsiScheduleHours(recommended);
      log.info(`[rsiScheduler] Adaptive backoff applied: ${currentHours}h → ${recommended}h`);
    }
  } catch (err) {
    log.warn("[rsiScheduler] Adaptive backoff failed:", err);
  }
}

// ─── Task runner ──────────────────────────────────────────────────────────────

async function runRsiTrigger(): Promise<void> {
  log.info("[rsiScheduler] Scheduled RSI trigger fired");
  try {
    const { triggerRSICycleNow, getRSIStatus } = await import("./rsiEngine.js");
    const status = getRSIStatus();

    if (status.phase !== "idle") {
      log.info(`[rsiScheduler] Skipping — RSI cycle already in phase: ${status.phase}`);
      appendScheduleLog({
        triggeredAt: Date.now(),
        source: "scheduler",
        intervalHours: DEFAULT_HOURS,
        cycleStarted: false,
        note: `Skipped — already in phase: ${status.phase}`,
      });
      return;
    }

    // ── Ontological confidence gate ──────────────────────────────────────────
    // Before triggering an autonomous RSI cycle, check that the self-model has
    // sufficient confidence. If not, defer and log the reason.
    try {
      const { getSelfModelSummary, routeTask } = await import("./ontologicalModel.js");
      const selfModel = getSelfModelSummary();
      const MIN_CONFIDENCE = 0.45; // 45% minimum overall confidence for auto-RSI
      if (selfModel.intelligenceScore < MIN_CONFIDENCE) {
        log.info(
          `[rsiScheduler] Ontological gate: confidence ${(selfModel.intelligenceScore * 100).toFixed(1)}% < ${(MIN_CONFIDENCE * 100).toFixed(0)}% — deferring RSI cycle`
        );
        appendScheduleLog({
          triggeredAt: Date.now(),
          source: "scheduler",
          intervalHours: DEFAULT_HOURS,
          cycleStarted: false,
          note: `Deferred — ontological confidence ${(selfModel.intelligenceScore * 100).toFixed(1)}% below ${(MIN_CONFIDENCE * 100).toFixed(0)}% threshold`,
        });
        return;
      }
      // Verify RSI is the right action for the current state
      const routing = routeTask(
        "Perform a recursive self-improvement cycle to enhance agent capabilities"
      );
      if (routing.selectedAction !== "write_tool" && routing.selectedAction !== "train_lora") {
        log.info(
          `[rsiScheduler] Ontological gate: routing suggests '${routing.selectedAction}' — deferring (confidence: ${(routing.confidence * 100).toFixed(1)}%)`
        );
        appendScheduleLog({
          triggeredAt: Date.now(),
          source: "scheduler",
          intervalHours: DEFAULT_HOURS,
          cycleStarted: false,
          note: `Deferred — ontological routing suggests '${routing.selectedAction}' (confidence: ${(routing.confidence * 100).toFixed(1)}%)`,
        });
        return;
      }
      log.info(
        `[rsiScheduler] Ontological gate passed — confidence: ${(selfModel.intelligenceScore * 100).toFixed(1)}%, routing: ${routing.selectedAction}`
      );
    } catch (ontErr) {
      // If ontological model is unavailable, proceed anyway (fail-open for RSI)
      log.warn("[rsiScheduler] Ontological gate unavailable — proceeding anyway:", ontErr);
    }
    // ── End ontological gate ─────────────────────────────────────────────────

    // ── Utility function gate ────────────────────────────────────────────────
    // v9.0: Check that the current system state has positive utility improvement
    // potential before triggering an autonomous RSI cycle.
    try {
      const { computeDelta, createStateSnapshot } = await import("./utilityFunction.js");
      const currentState = createStateSnapshot();
      const delta = computeDelta(currentState, currentState);
      if (!delta.meetsThreshold) {
        log.info(
          `[rsiScheduler] Utility gate: delta ${delta.delta.toFixed(4)} below threshold — deferring RSI cycle. ${delta.explanation}`
        );
        appendScheduleLog({
          triggeredAt: Date.now(),
          source: "scheduler",
          intervalHours: DEFAULT_HOURS,
          cycleStarted: false,
          note: `Deferred — utility delta ${delta.delta.toFixed(4)} below threshold: ${delta.explanation}`,
        });
        return;
      }
      log.info(`[rsiScheduler] Utility gate passed — delta: ${delta.delta.toFixed(4)}, reason: ${delta.explanation}`);
    } catch (utilErr) {
      // Non-fatal — utility gate failure should not block RSI
      log.warn("[rsiScheduler] Utility gate unavailable — proceeding anyway:", utilErr);
    }
    // ── End utility gate ─────────────────────────────────────────────────────

    triggerRSICycleNow();
    appendScheduleLog({
      triggeredAt: Date.now(),
      source: "scheduler",
      intervalHours: DEFAULT_HOURS,
      cycleStarted: true,
    });
    log.info("[rsiScheduler] RSI cycle triggered successfully");
    // v12.13.0: Adaptive backoff — adjust next interval based on recent success rate
    // Run async without awaiting so it doesn't block the trigger response
    applyAdaptiveBackoff().catch(e => log.warn("[rsiScheduler] Adaptive backoff error:", e));
  } catch (err) {
    log.warn("[rsiScheduler] Failed to trigger RSI cycle:", err);
    appendScheduleLog({
      triggeredAt: Date.now(),
      source: "scheduler",
      intervalHours: DEFAULT_HOURS,
      cycleStarted: false,
      note: `Error: ${(err as Error).message}`,
    });
  }
}

// ─── Scheduler hook ───────────────────────────────────────────────────────────
// The scheduler.ts engine calls the action string as a module function.
// We register a webhook-style action that calls runRsiTrigger() directly.

let _taskId: string | null = null;

function findExistingTask(): ScheduledTask | null {
  const tasks = listTasks();
  return tasks.find(t => t.tags?.includes(RSI_TASK_TAG)) ?? null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize the RSI auto-trigger scheduler.
 * Idempotent — safe to call multiple times (will reuse existing task).
 */
export function initRsiScheduler(): void {
  const existing = findExistingTask();
  if (existing) {
    _taskId = existing.id;
    log.info(`[rsiScheduler] Using existing task ${existing.id} (status: ${existing.status})`);

    // Wire the in-process trigger for the existing task
    _wireSchedulerHook();
    return;
  }

  const intervalSeconds = DEFAULT_HOURS * 3600;
  const task = createTask({
    name: RSI_TASK_NAME,
    description: `Auto-trigger RSI improvement cycle every ${DEFAULT_HOURS} hours`,
    intervalSeconds,
    action: "rsi-auto-trigger",
    actionType: "script",
    recurring: true,
    tags: [RSI_TASK_TAG],
    storeInMemory: false,
  });

  _taskId = task.id;
  log.info(`[rsiScheduler] Created RSI auto-trigger task ${task.id} — interval: ${DEFAULT_HOURS}h`);

  _wireSchedulerHook();
}

/**
 * Wire the in-process handler for the RSI trigger action.
 * The scheduler calls triggerTaskNow which fires the action — we intercept
 * "rsi-auto-trigger" actions and route them to runRsiTrigger().
 */
function _wireSchedulerHook(): void {
  // Patch the scheduler's action executor to handle our custom action type.
  // We use a global registry so the hook survives hot-reloads.
  const g = globalThis as any;
  if (!g.__rsiSchedulerHooked) {
    g.__rsiSchedulerHooked = true;
    g.__rsiTriggerFn = runRsiTrigger;
    log.info("[rsiScheduler] In-process trigger hook registered");
  }
}

/**
 * Get the current status of the RSI scheduler task.
 */
export function getRsiSchedulerStatus(): {
  taskId: string | null;
  status: string;
  paused: boolean;
  intervalHours: number;
  nextRunAt: string | null;
  runCount: number;
  lastLog: ScheduleLogEntry | null;
} {
  const task = _taskId ? getTask(_taskId) : findExistingTask();
  let lastLog: ScheduleLogEntry | null = null;
  try {
    const p = getScheduleLogPath();
    if (fs.existsSync(p)) {
      const entries: ScheduleLogEntry[] = JSON.parse(fs.readFileSync(p, "utf8"));
      lastLog = entries[entries.length - 1] ?? null;
    }
  } catch { /* ignore */ }

  return {
    taskId: task?.id ?? null,
    status: task?.status ?? "not-initialized",
    paused: task?.status === "paused",
    intervalHours: task ? Math.round((task.intervalSeconds ?? DEFAULT_HOURS * 3600) / 3600) : DEFAULT_HOURS,
    nextRunAt: task?.nextRunAt ?? null,
    runCount: task?.runCount ?? 0,
    lastLog,
  };
}

/**
 * Change the RSI trigger interval.
 * @param hours  New interval in hours (1–168)
 */
export function setRsiScheduleHours(hours: number): boolean {
  if (typeof hours !== 'number' || isNaN(hours)) {
    log.warn("[rsiScheduler] Invalid hours parameter — must be a number");
    return false;
  }
  const clamped = Math.max(1, Math.min(168, Math.round(hours)));
  const task = _taskId ? getTask(_taskId) : findExistingTask();
  if (!task) {
    log.warn("[rsiScheduler] Cannot set schedule — task not initialized");
    return false;
  }

  // Update the task's intervalSeconds in the store
  try {
    const { listTasks } = _require("./scheduler.js");
    // Re-create the task with new interval (simplest approach — cancel old, create new)
    const { cancelTask } = _require("./scheduler.js");
    cancelTask(task.id);

    const newTask = createTask({
      name: RSI_TASK_NAME,
      description: `Auto-trigger RSI improvement cycle every ${clamped} hours`,
      intervalSeconds: clamped * 3600,
      action: "rsi-auto-trigger",
      actionType: "script",
      recurring: true,
      tags: [RSI_TASK_TAG],
      storeInMemory: false,
    });
    _taskId = newTask.id;
    log.info(`[rsiScheduler] Schedule updated to ${clamped}h (new task: ${newTask.id})`);
    return true;
  } catch (err) {
    log.warn("[rsiScheduler] Failed to update schedule:", err);
    return false;
  }
}

/**
 * Pause the RSI auto-trigger scheduler.
 */
export function pauseRsiScheduler(): boolean {
  const task = _taskId ? getTask(_taskId) : findExistingTask();
  if (!task) return false;
  const ok = pauseTask(task.id);
  if (ok) log.info(`[rsiScheduler] Paused task ${task.id}`);
  return ok;
}

/**
 * Resume the RSI auto-trigger scheduler.
 */
export function resumeRsiScheduler(): boolean {
  const task = _taskId ? getTask(_taskId) : findExistingTask();
  if (!task) return false;
  const ok = resumeTask(task.id);
  if (ok) log.info(`[rsiScheduler] Resumed task ${task.id}`);
  return ok;
}

/**
 * Manually fire an RSI cycle immediately (bypasses schedule).
 */
export async function triggerRsiNow(): Promise<{ started: boolean; note: string }> {
  try {
    const { triggerRSICycleNow, getRSIStatus } = await import("./rsiEngine.js");
    const status = getRSIStatus();
    if (status.phase !== "idle") {
      return { started: false, note: `Already in phase: ${status.phase}` };
    }
    triggerRSICycleNow();
    appendScheduleLog({
      triggeredAt: Date.now(),
      source: "scheduler",
      intervalHours: 0,
      cycleStarted: true,
      note: "Manual trigger via API",
    });
    return { started: true, note: "RSI cycle triggered" };
  } catch (err) {
    return { started: false, note: (err as Error).message };
  }
}
