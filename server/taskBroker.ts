/**
 * taskBroker.ts — v46.0.0
 *
 * Intermediary that decomposes high-level goals into atomic tasks,
 * routes them to the marketplace, and aggregates results.
 */

export interface BrokerTask {
  taskId: string;
  parentGoalId: string;
  description: string;
  requiredCapabilities: string[];
  estimatedCredits: number;
  priority: number;
  status: "pending" | "assigned" | "completed" | "failed";
  result?: unknown;
  assignedAgent?: string;
  createdAt: number;
  completedAt?: number;
}

export interface BrokerGoal {
  goalId: string;
  description: string;
  tasks: BrokerTask[];
  status: "in-progress" | "completed" | "failed";
  createdAt: number;
}

const goals = new Map<string, BrokerGoal>();
const taskIndex = new Map<string, BrokerTask>();

let taskCounter = 0;

export function createGoal(goalId: string, description: string): BrokerGoal {
  const goal: BrokerGoal = {
    goalId,
    description,
    tasks: [],
    status: "in-progress",
    createdAt: Date.now(),
  };
  goals.set(goalId, goal);
  return goal;
}

export function addTask(
  goalId: string,
  description: string,
  requiredCapabilities: string[],
  estimatedCredits: number,
  priority = 5
): BrokerTask | null {
  const goal = goals.get(goalId);
  if (!goal) return null;

  const task: BrokerTask = {
    taskId: `task-${++taskCounter}-${Date.now()}`,
    parentGoalId: goalId,
    description,
    requiredCapabilities,
    estimatedCredits,
    priority,
    status: "pending",
    createdAt: Date.now(),
  };

  goal.tasks.push(task);
  taskIndex.set(task.taskId, task);
  return task;
}

export function assignTask(taskId: string, agentId: string): boolean {
  const task = taskIndex.get(taskId);
  if (!task || task.status !== "pending") return false;
  task.status = "assigned";
  task.assignedAgent = agentId;
  return true;
}

export function completeTask(taskId: string, result: unknown, success: boolean): void {
  const task = taskIndex.get(taskId);
  if (!task) return;

  task.status = success ? "completed" : "failed";
  task.result = result;
  task.completedAt = Date.now();

  // Update parent goal status
  const goal = goals.get(task.parentGoalId);
  if (!goal) return;

  const allDone = goal.tasks.every(t => t.status === "completed" || t.status === "failed");
  if (allDone) {
    const anyFailed = goal.tasks.some(t => t.status === "failed");
    goal.status = anyFailed ? "failed" : "completed";
  }
}

export function getGoalProgress(goalId: string): {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  progressPct: number;
} | null {
  const goal = goals.get(goalId);
  if (!goal) return null;

  const total = goal.tasks.length;
  const completed = goal.tasks.filter(t => t.status === "completed").length;
  const failed = goal.tasks.filter(t => t.status === "failed").length;
  const pending = goal.tasks.filter(t => t.status === "pending" || t.status === "assigned").length;

  return {
    total,
    completed,
    failed,
    pending,
    progressPct: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}

export function getPendingTasks(): BrokerTask[] {
  return Array.from(taskIndex.values()).filter(t => t.status === "pending");
}

export function getGoal(goalId: string): BrokerGoal | undefined {
  return goals.get(goalId);
}

export function _resetBrokerForTest(): void {
  goals.clear();
  taskIndex.clear();
  taskCounter = 0;
}
