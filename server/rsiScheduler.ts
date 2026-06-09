/**
 * rsiScheduler.ts — v6.32
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
 * Exports:
 *   initRsiScheduler()          — call once on startup
 *   getRsiSchedulerStatus()     — returns current task status + next run time
 *   setRsiScheduleHours(n)      — change interval (1–168 hours)
 *   pauseRsiScheduler()         — pause the scheduled task
 *   resumeRsiScheduler()        — resume the scheduled task
 */

import fs from "fs";
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
const DEFAULT_HOURS = parseInt(process.env.RSI_SCHEDULE_HOURS ?? "6", 10) || 6;

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
  entries.push(entry);
  // Keep last 500 entries
  if (entries.length > 500) entries = entries.slice(-500);
  fs.writeFileSync(p, JSON.stringify(entries, null, 2), "utf8");
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
      if (selfModel.overallConfidence < MIN_CONFIDENCE) {
        log.info(
          `[rsiScheduler] Ontological gate: confidence ${(selfModel.overallConfidence * 100).toFixed(1)}% < ${(MIN_CONFIDENCE * 100).toFixed(0)}% — deferring RSI cycle`
        );
        appendScheduleLog({
          triggeredAt: Date.now(),
          source: "scheduler",
          intervalHours: DEFAULT_HOURS,
          cycleStarted: false,
          note: `Deferred — ontological confidence ${(selfModel.overallConfidence * 100).toFixed(1)}% below ${(MIN_CONFIDENCE * 100).toFixed(0)}% threshold`,
        });
        return;
      }
      // Verify RSI is the right action for the current state
      const routing = routeTask(
        "Perform a recursive self-improvement cycle to enhance agent capabilities",
        { urgency: "low", complexity: "high" }
      );
      if (routing.action !== "write_tool" && routing.action !== "train_lora") {
        log.info(
          `[rsiScheduler] Ontological gate: routing suggests '${routing.action}' — deferring (confidence: ${(routing.confidence * 100).toFixed(1)}%)`
        );
        appendScheduleLog({
          triggeredAt: Date.now(),
          source: "scheduler",
          intervalHours: DEFAULT_HOURS,
          cycleStarted: false,
          note: `Deferred — ontological routing suggests '${routing.action}' (confidence: ${(routing.confidence * 100).toFixed(1)}%)`,
        });
        return;
      }
      log.info(
        `[rsiScheduler] Ontological gate passed — confidence: ${(selfModel.overallConfidence * 100).toFixed(1)}%, routing: ${routing.action}`
      );
    } catch (ontErr) {
      // If ontological model is unavailable, proceed anyway (fail-open for RSI)
      log.warn("[rsiScheduler] Ontological gate unavailable — proceeding anyway:", ontErr);
    }
    // ── End ontological gate ─────────────────────────────────────────────────

    triggerRSICycleNow();
    appendScheduleLog({
      triggeredAt: Date.now(),
      source: "scheduler",
      intervalHours: DEFAULT_HOURS,
      cycleStarted: true,
    });
    log.info("[rsiScheduler] RSI cycle triggered successfully");
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
  const clamped = Math.max(1, Math.min(168, Math.round(hours)));
  const task = _taskId ? getTask(_taskId) : findExistingTask();
  if (!task) {
    log.warn("[rsiScheduler] Cannot set schedule — task not initialized");
    return false;
  }

  // Update the task's intervalSeconds in the store
  try {
    const { listTasks } = require("./scheduler.js");
    // Re-create the task with new interval (simplest approach — cancel old, create new)
    const { cancelTask } = require("./scheduler.js");
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
