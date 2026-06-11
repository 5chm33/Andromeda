/**
 * scheduler.ts — v5.5 Tier 2
 *
 * Task Scheduler Module: Enables autonomous background execution via
 * cron-like scheduling, one-shot delayed tasks, and webhook-triggered actions.
 *
 * Features:
 * - Cron expression parsing (minute, hour, day-of-month, month, day-of-week)
 * - Recurring and one-shot tasks
 * - Webhook receiver for event-driven triggers
 * - Task history with success/failure tracking
 * - Persistent storage (survives restarts)
 * - Integration with ReAct engine for autonomous task execution
 * - Max concurrent task limit to prevent resource exhaustion
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskStatus = "scheduled" | "running" | "completed" | "failed" | "paused" | "cancelled";

export type ScheduledTask = {
  id: string;
  name: string;
  description: string;
  /** Cron expression: "min hour dom month dow" (5 fields) */
  cron?: string;
  /** One-shot: ISO timestamp to execute at */
  executeAt?: string;
  /** Interval in seconds for recurring tasks */
  intervalSeconds?: number;
  /** The prompt/instruction to execute (fed to ReAct engine or direct handler) */
  action: string;
  /** Type of action: "react" runs through agent loop, "webhook" calls a URL, "script" runs code */
  actionType: "react" | "webhook" | "script";
  /** For webhook actionType: URL to call */
  webhookUrl?: string;
  /** For webhook actionType: HTTP method */
  webhookMethod?: "GET" | "POST" | "PUT" | "DELETE";
  /** For webhook actionType: request body */
  webhookBody?: string;
  /** Whether this task repeats */
  recurring: boolean;
  /** Max number of executions (0 = unlimited) */
  maxRuns: number;
  /** Current run count */
  runCount: number;
  /** Task status */
  status: TaskStatus;
  /** When the task was created */
  createdAt: string;
  /** Last execution time */
  lastRunAt?: string;
  /** Next scheduled execution time */
  nextRunAt?: string;
  /** Last execution result */
  lastResult?: string;
  /** Last execution error */
  lastError?: string;
  /** Tags for organization */
  tags: string[];
  /** Whether to store results in memory */
  storeInMemory: boolean;
};

export type TaskExecution = {
  taskId: string;
  executionId: string;
  startedAt: string;
  completedAt?: string;
  status: "running" | "completed" | "failed";
  result?: string;
  error?: string;
  durationMs?: number;
};

type SchedulerStore = {
  tasks: ScheduledTask[];
  executions: TaskExecution[];
  webhookSecret: string;
};

// ─── Storage ──────────────────────────────────────────────────────────────────

function getDataDir(): string {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getStorePath(): string {
  return path.join(getDataDir(), "scheduler.json");
}

function loadStore(): SchedulerStore {
  const p = getStorePath();
  if (!fs.existsSync(p)) {
    return {
      tasks: [],
      executions: [],
      webhookSecret: `whsec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    };
  }
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch { return { tasks: [], executions: [], webhookSecret: `whsec_${Date.now().toString(36)}` }; }
}

function saveStore(store: SchedulerStore): void {
  // Keep only last 500 executions to prevent unbounded growth
  if (store.executions.length > 500) {
    store.executions = store.executions.slice(-500);
  }
  fs.writeFileSync(getStorePath(), JSON.stringify(store, null, 2), "utf-8");
}

// ─── Cron Parser ──────────────────────────────────────────────────────────────

function parseCronField(field: string, min: number, max: number): number[] {
  const values: number[] = [];
  for (const part of field.split(",")) {
    if (part === "*") {
      for (let i = min; i <= max; i++) values.push(i);
    } else if (part.includes("/")) {
      const [range, stepStr] = part.split("/");
      const step = parseInt(stepStr, 10);
      const start = range === "*" ? min : parseInt(range, 10);
      for (let i = start; i <= max; i += step) values.push(i);
    } else if (part.includes("-")) {
      const [lo, hi] = part.split("-").map(Number);
      for (let i = lo; i <= hi; i++) values.push(i);
    } else {
      values.push(parseInt(part, 10));
    }
  }
  return values.filter(v => v >= min && v <= max);
}

function getNextCronTime(cron: string, after: Date = new Date()): Date | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const minutes = parseCronField(parts[0], 0, 59);
  const hours = parseCronField(parts[1], 0, 23);
  const doms = parseCronField(parts[2], 1, 31);
  const months = parseCronField(parts[3], 1, 12);
  const dows = parseCronField(parts[4], 0, 6);

  // Search forward up to 366 days
  const candidate = new Date(after.getTime() + 60000); // start 1 minute after
  candidate.setSeconds(0, 0);

  for (let dayOffset = 0; dayOffset < 366; dayOffset++) {
    const d = new Date(candidate.getTime() + dayOffset * 86400000);
    if (!months.includes(d.getMonth() + 1)) continue;
    if (!doms.includes(d.getDate()) && !dows.includes(d.getDay())) continue;

    for (const h of hours) {
      for (const m of minutes) {
        const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0);
        if (t.getTime() > after.getTime()) return t;
      }
    }
  }
  return null;
}

// ─── Timer Management ─────────────────────────────────────────────────────────

const activeTimers = new Map<string, ReturnType<typeof setTimeout>>();
const MAX_CONCURRENT = 5;
let runningCount = 0;

function clearTaskTimer(taskId: string): void {
  const timer = activeTimers.get(taskId);
  if (timer) {
    clearTimeout(timer);
    activeTimers.delete(taskId);
  }
}

function scheduleNextRun(task: ScheduledTask): void {
  clearTaskTimer(task.id);

  if (task.status === "paused" || task.status === "cancelled") return;
  if (task.maxRuns > 0 && task.runCount >= task.maxRuns) {
    task.status = "completed";
    return;
  }

  let nextTime: Date | null = null;

  if (task.cron) {
    nextTime = getNextCronTime(task.cron);
  } else if (task.executeAt && task.runCount === 0) {
    nextTime = new Date(task.executeAt);
  } else if (task.intervalSeconds && task.recurring) {
    nextTime = new Date(Date.now() + task.intervalSeconds * 1000);
  }

  if (!nextTime || nextTime.getTime() <= Date.now()) return;

  task.nextRunAt = nextTime.toISOString();
  const delay = nextTime.getTime() - Date.now();

  // Cap timer at 24 hours; re-schedule after that
  const maxDelay = 24 * 60 * 60 * 1000;
  const actualDelay = Math.min(delay, maxDelay);

  const timer = setTimeout(() => {
    if (actualDelay < delay) {
      // Re-schedule — we haven't reached the target time yet
      scheduleNextRun(task);
    } else {
      executeTask(task.id);
    }
  }, actualDelay);

  activeTimers.set(task.id, timer);
}

// ─── Task Execution ───────────────────────────────────────────────────────────

async function executeTask(taskId: string): Promise<void> {
  const store = loadStore();
  const task = store.tasks.find(t => t.id === taskId);
  if (!task) return;

  if (runningCount >= MAX_CONCURRENT) {
    // Queue it for 30 seconds later
    const timer = setTimeout(() => executeTask(taskId), 30000);
    activeTimers.set(taskId, timer);
    return;
  }

  runningCount++;
  task.status = "running";
  task.lastRunAt = new Date().toISOString();
  task.runCount++;

  const execution: TaskExecution = {
    taskId,
    executionId: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    startedAt: new Date().toISOString(),
    status: "running",
  };
  store.executions.push(execution);
  saveStore(store);

  const startMs = Date.now();

  try {
    let result: string;

    switch (task.actionType) {
      case "webhook": {
        const resp = await fetch(task.webhookUrl ?? "", {
          method: task.webhookMethod ?? "POST",
          headers: { "Content-Type": "application/json" },
          body: task.webhookBody ?? JSON.stringify({ taskId, action: task.action, timestamp: new Date().toISOString() }),
          signal: AbortSignal.timeout(30000),
        });
        result = `HTTP ${resp.status}: ${(await resp.text()).slice(0, 500)}`;
        break;
      }
      case "script": {
        // v6.17 SECURITY FIX: Prevent shell injection by validating task.action
        // before passing to execSync. Only allow alphanumeric, spaces, dashes,
        // underscores, dots, forward slashes, and equals signs (for env vars).
        // Reject any string containing shell metacharacters: ; & | ` $ ( ) { } < > \ ! *
        const SAFE_SCRIPT_PATTERN = /^[a-zA-Z0-9 _.\-/=:@]+$/;
        if (!SAFE_SCRIPT_PATTERN.test(task.action)) {
          result = `[BLOCKED] Script task rejected: action contains unsafe shell characters. ` +
            `Only alphanumeric, spaces, dashes, underscores, dots, slashes, colons, @ and = are allowed. ` +
            `Got: ${task.action.slice(0, 100)}`;
          console.warn(`[Scheduler] v6.17 SECURITY: Blocked unsafe script task ${taskId}: ${task.action.slice(0, 100)}`);
          break;
        }
        const output = execSync(task.action, {
          timeout: 60000,
          encoding: "utf-8",
          cwd: path.resolve(process.cwd(), "workspace"),
        });
        result = output.slice(0, 2000);
        break;
      }
      case "react":
      default: {
        // For ReAct tasks, we store the instruction — actual execution happens
        // when the ReAct engine picks it up from the task queue
        result = `Task queued for ReAct engine: ${task.action}`;
        break;
      }
    }

    execution.status = "completed";
    execution.result = result;
    task.lastResult = result;
    task.lastError = undefined;
    task.status = task.recurring ? "scheduled" : "completed";
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    execution.status = "failed";
    execution.error = errMsg;
    task.lastError = errMsg;
    task.status = task.recurring ? "scheduled" : "failed";
  } finally {
    runningCount--;
    execution.completedAt = new Date().toISOString();
    execution.durationMs = Date.now() - startMs;
    saveStore(store);

    // Schedule next run if recurring
    if (task.recurring && task.status === "scheduled") {
      scheduleNextRun(task);
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function createTask(input: {
  name: string;
  description?: string;
  cron?: string;
  executeAt?: string;
  intervalSeconds?: number;
  action: string;
  actionType?: "react" | "webhook" | "script";
  webhookUrl?: string;
  webhookMethod?: "GET" | "POST" | "PUT" | "DELETE";
  webhookBody?: string;
  recurring?: boolean;
  maxRuns?: number;
  tags?: string[];
  storeInMemory?: boolean;
}): ScheduledTask {
  const store = loadStore();

  const task: ScheduledTask = {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    description: input.description ?? "",
    cron: input.cron,
    executeAt: input.executeAt,
    intervalSeconds: input.intervalSeconds,
    action: input.action,
    actionType: input.actionType ?? "react",
    webhookUrl: input.webhookUrl,
    webhookMethod: input.webhookMethod,
    webhookBody: input.webhookBody,
    recurring: input.recurring ?? false,
    maxRuns: input.maxRuns ?? 0,
    runCount: 0,
    status: "scheduled",
    createdAt: new Date().toISOString(),
    tags: input.tags ?? [],
    storeInMemory: input.storeInMemory ?? false,
  };

  store.tasks.push(task);
  saveStore(store);
  scheduleNextRun(task);

  return task;
}

export function getTask(taskId: string): ScheduledTask | undefined {
  return loadStore().tasks.find(t => t.id === taskId);
}

export function listTasks(statusFilter?: TaskStatus): ScheduledTask[] {
  const store = loadStore();
  const tasks = statusFilter ? store.tasks.filter(t => t.status === statusFilter) : store.tasks;
  return tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function pauseTask(taskId: string): boolean {
  const store = loadStore();
  const task = store.tasks.find(t => t.id === taskId);
  if (!task || task.status === "cancelled") return false;
  task.status = "paused";
  clearTaskTimer(taskId);
  saveStore(store);
  return true;
}

export function resumeTask(taskId: string): boolean {
  const store = loadStore();
  const task = store.tasks.find(t => t.id === taskId);
  if (!task || task.status !== "paused") return false;
  task.status = "scheduled";
  saveStore(store);
  scheduleNextRun(task);
  return true;
}

export function cancelTask(taskId: string): boolean {
  const store = loadStore();
  const task = store.tasks.find(t => t.id === taskId);
  if (!task) return false;
  task.status = "cancelled";
  clearTaskTimer(taskId);
  saveStore(store);
  return true;
}

export function deleteTask(taskId: string): boolean {
  const store = loadStore();
  const idx = store.tasks.findIndex(t => t.id === taskId);
  if (idx === -1) return false;
  clearTaskTimer(store.tasks[idx].id);
  store.tasks.splice(idx, 1);
  store.executions = store.executions.filter(e => e.taskId !== taskId);
  saveStore(store);
  return true;
}

export function getTaskExecutions(taskId: string, limit = 20): TaskExecution[] {
  return loadStore().executions
    .filter(e => e.taskId === taskId)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, limit);
}

export function triggerTaskNow(taskId: string): boolean {
  const task = loadStore().tasks.find(t => t.id === taskId);
  if (!task || task.status === "cancelled") return false;
  executeTask(taskId);
  return true;
}

// ─── Webhook Receiver ─────────────────────────────────────────────────────────

export function handleWebhook(
  eventType: string,
  payload: Record<string, unknown>,
  secret?: string
): { triggered: string[]; skipped: string[] } {
  const store = loadStore();

  // Verify secret if provided
  if (secret && secret !== store.webhookSecret) {
    return { triggered: [], skipped: ["Invalid webhook secret"] };
  }

  const triggered: string[] = [];
  const skipped: string[] = [];

  // Find tasks tagged with this event type
  for (const task of store.tasks) {
    if (task.status !== "scheduled" && task.status !== "paused") continue;
    if (task.tags.includes(`webhook:${eventType}`) || task.tags.includes("webhook:*")) {
      // Inject payload into action
      const enrichedAction = `${task.action}\n\nWebhook event: ${eventType}\nPayload: ${JSON.stringify(payload).slice(0, 1000)}`;
      task.action = enrichedAction;
      executeTask(task.id);
      triggered.push(task.id);
    } else {
      skipped.push(task.id);
    }
  }

  return { triggered, skipped };
}

export function getWebhookSecret(): string {
  return loadStore().webhookSecret;
}

// ─── Scheduler Stats ──────────────────────────────────────────────────────────

export function getSchedulerStats(): {
  totalTasks: number;
  activeTasks: number;
  pausedTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalExecutions: number;
  recentExecutions: TaskExecution[];
  activeTimerCount: number;
} {
  const store = loadStore();
  return {
    totalTasks: store.tasks.length,
    activeTasks: store.tasks.filter(t => t.status === "scheduled" || t.status === "running").length,
    pausedTasks: store.tasks.filter(t => t.status === "paused").length,
    completedTasks: store.tasks.filter(t => t.status === "completed").length,
    failedTasks: store.tasks.filter(t => t.status === "failed").length,
    totalExecutions: store.executions.length,
    recentExecutions: store.executions.slice(-10).reverse(),
    activeTimerCount: activeTimers.size,
  };
}

// ─── Startup: Restore Timers ──────────────────────────────────────────────────

export function initScheduler(): void {
  const store = loadStore();
  let restored = 0;
  for (const task of store.tasks) {
    if (task.status === "scheduled" || task.status === "running") {
      // Reset any "running" tasks that were interrupted by a restart
      if (task.status === "running") task.status = "scheduled";
      scheduleNextRun(task);
      restored++;
    }
  }
  if (restored > 0) saveStore(store);
  console.log(`[Scheduler] Initialized: ${store.tasks.length} tasks, ${restored} timers restored`);
}
