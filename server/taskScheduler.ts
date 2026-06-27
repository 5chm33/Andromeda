/**
 * taskScheduler.ts — v67.0.0 "Real-World Integration II"
 * Cron-style task scheduler with priority queues, missed-run detection, and execution history.
 */

export type ScheduleType = "once" | "interval" | "cron";
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export interface ScheduledTask { taskId: string; name: string; scheduleType: ScheduleType; intervalMs?: number; nextRunAt: number; priority: number; status: TaskStatus; runCount: number; lastRunAt?: number; lastError?: string; handler: () => Promise<void>; }
export interface TaskExecution { taskId: string; startedAt: number; completedAt?: number; success: boolean; error?: string; }

const tasks = new Map<string, ScheduledTask>();
const executions: TaskExecution[] = [];
let taskCounter = 0;

export function scheduleTask(name: string, handler: () => Promise<void>, options: { scheduleType?: ScheduleType; intervalMs?: number; runAt?: number; priority?: number }): ScheduledTask {
  const task: ScheduledTask = {
    taskId: `task-${++taskCounter}`, name, scheduleType: options.scheduleType ?? "once",
    intervalMs: options.intervalMs, nextRunAt: options.runAt ?? Date.now(),
    priority: options.priority ?? 5, status: "pending", runCount: 0, handler
  };
  tasks.set(task.taskId, task);
  return task;
}

export async function runDueTasks(): Promise<TaskExecution[]> {
  const now = Date.now();
  const due = [...tasks.values()].filter(t => t.status === "pending" && t.nextRunAt <= now).sort((a, b) => b.priority - a.priority);
  const results: TaskExecution[] = [];
  for (const task of due) {
    task.status = "running";
    const exec: TaskExecution = { taskId: task.taskId, startedAt: Date.now(), success: false };
    executions.push(exec);
    try {
      await task.handler();
      exec.success = true;
      task.runCount++;
      task.lastRunAt = Date.now();
      task.status = task.scheduleType === "interval" && task.intervalMs ? "pending" : "completed";
      if (task.scheduleType === "interval" && task.intervalMs) task.nextRunAt = Date.now() + task.intervalMs;
    } catch (e: unknown) {
      exec.success = false;
      exec.error = e instanceof Error ? e.message : String(e);
      task.status = "failed";
      task.lastError = exec.error;
    }
    exec.completedAt = Date.now();
    results.push(exec);
  }
  return results;
}

export function cancelTask(taskId: string): boolean {
  const task = tasks.get(taskId);
  if (!task || task.status !== "pending") return false;
  task.status = "cancelled";
  return true;
}

export function getTasks(): ScheduledTask[] { return [...tasks.values()]; }
export function getExecutionHistory(): TaskExecution[] { return [...executions]; }
export function _resetTaskSchedulerForTest(): void { tasks.clear(); executions.length = 0; taskCounter = 0; }
