/**
 * adaptiveGoalHierarchy.ts — v55.0.0 "The Grand Unification"
 *
 * Manages a dynamic, self-adjusting hierarchy of goals. Goals can be
 * decomposed, reprioritized, and adapted based on context and outcomes.
 */

export type GoalStatus = "pending" | "active" | "completed" | "failed" | "suspended" | "adapted";
export type GoalPriority = "critical" | "high" | "medium" | "low";

export interface Goal {
  goalId: string;
  name: string;
  description: string;
  priority: GoalPriority;
  status: GoalStatus;
  parentGoalId?: string;
  subGoalIds: string[];
  successCriteria: string[];
  progress: number;   // 0.0–1.0
  createdAt: number;
  updatedAt: number;
  deadline?: number;
  adaptations: string[];
}

const goals = new Map<string, Goal>();
let goalCounter = 0;

export function createGoal(
  name: string,
  description: string,
  priority: GoalPriority,
  successCriteria: string[],
  parentGoalId?: string,
  deadline?: number
): Goal {
  const goal: Goal = {
    goalId: `goal-${++goalCounter}`,
    name,
    description,
    priority,
    status: "pending",
    parentGoalId,
    subGoalIds: [],
    successCriteria,
    progress: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deadline,
    adaptations: [],
  };
  goals.set(goal.goalId, goal);
  if (parentGoalId) {
    const parent = goals.get(parentGoalId);
    if (parent) parent.subGoalIds.push(goal.goalId);
  }
  return goal;
}

export function updateGoalProgress(goalId: string, progress: number): boolean {
  const goal = goals.get(goalId);
  if (!goal) return false;
  goal.progress = Math.max(0, Math.min(1, progress));
  goal.updatedAt = Date.now();
  if (goal.progress >= 1.0) goal.status = "completed";
  else if (goal.progress > 0) goal.status = "active";
  return true;
}

export function adaptGoal(goalId: string, adaptation: string, newPriority?: GoalPriority): boolean {
  const goal = goals.get(goalId);
  if (!goal) return false;
  goal.adaptations.push(adaptation);
  goal.status = "adapted";
  if (newPriority) goal.priority = newPriority;
  goal.updatedAt = Date.now();
  return true;
}

export function getGoalHierarchy(rootGoalId?: string): Goal[] {
  if (rootGoalId) {
    const root = goals.get(rootGoalId);
    if (!root) return [];
    return collectSubtree(root);
  }
  return Array.from(goals.values()).filter(g => !g.parentGoalId);
}

export function getActiveGoals(): Goal[] {
  return Array.from(goals.values()).filter(g => g.status === "active" || g.status === "pending");
}

export function reprioritizeGoals(): Goal[] {
  const active = getActiveGoals();
  const now = Date.now();
  for (const goal of active) {
    if (goal.deadline && goal.deadline - now < 3600000 && goal.priority !== "critical") {
      goal.priority = "critical";
      goal.adaptations.push(`Auto-escalated to critical: deadline in ${Math.round((goal.deadline - now) / 60000)}min`);
      goal.updatedAt = now;
    }
  }
  return active.sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority));
}

function priorityWeight(p: GoalPriority): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[p];
}

function collectSubtree(goal: Goal): Goal[] {
  const result: Goal[] = [goal];
  for (const subId of goal.subGoalIds) {
    const sub = goals.get(subId);
    if (sub) result.push(...collectSubtree(sub));
  }
  return result;
}

export function _resetGoalHierarchyForTest(): void {
  goals.clear();
  goalCounter = 0;
}
