/**
 * hierarchicalPlanner.ts — v89.0.0 "Autonomous Planning & Goal Management"
 * Hierarchical Task Network (HTN) planner that decomposes high-level goals into primitive tasks.
 */
export type TaskType = "primitive" | "compound";
export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";

export interface PrimitiveTask {
  taskId: string;
  name: string;
  type: "primitive";
  action: string;
  parameters: Record<string, unknown>;
  preconditions: string[];
  effects: string[];
  estimatedDurationMs: number;
}

export interface CompoundTask {
  taskId: string;
  name: string;
  type: "compound";
  methods: Array<{ methodId: string; name: string; subtasks: string[] }>;
  preconditions: string[];
}

export interface HierarchicalPlan {
  planId: string;
  goalId: string;
  rootTask: string;
  orderedTasks: PrimitiveTask[];
  totalEstimatedDurationMs: number;
  decompositionDepth: number;
  createdAt: number;
}

const primitiveTasks = new Map<string, PrimitiveTask>();
const compoundTasks = new Map<string, CompoundTask>();
const plans: HierarchicalPlan[] = [];
let taskCounter = 0;
let planCounter = 0;

export function definePrimitiveTask(name: string, action: string, parameters: Record<string, unknown>, preconditions: string[], effects: string[], estimatedDurationMs = 1000): PrimitiveTask {
  const task: PrimitiveTask = { taskId: `pt-${++taskCounter}`, name, type: "primitive", action, parameters, preconditions, effects, estimatedDurationMs };
  primitiveTasks.set(task.taskId, task);
  return task;
}

export function defineCompoundTask(name: string, methods: Array<{ methodId: string; name: string; subtasks: string[] }>, preconditions: string[] = []): CompoundTask {
  const task: CompoundTask = { taskId: `ct-${++taskCounter}`, name, type: "compound", methods, preconditions };
  compoundTasks.set(task.taskId, task);
  return task;
}

export function decompose(compoundTaskId: string, worldState: Set<string>, depth = 0): PrimitiveTask[] {
  if (depth > 10) return [];
  const compound = compoundTasks.get(compoundTaskId);
  if (!compound) {
    const primitive = primitiveTasks.get(compoundTaskId);
    return primitive ? [primitive] : [];
  }

  for (const method of compound.methods) {
    const allPreconditionsMet = compound.preconditions.every(p => worldState.has(p));
    if (!allPreconditionsMet) continue;

    const subtasks: PrimitiveTask[] = [];
    let valid = true;
    for (const subtaskId of method.subtasks) {
      const resolved = decompose(subtaskId, worldState, depth + 1);
      if (resolved.length === 0 && primitiveTasks.has(subtaskId) === false && compoundTasks.has(subtaskId) === false) { valid = false; break; }
      subtasks.push(...resolved);
      // Apply effects to world state
      for (const t of resolved) for (const effect of t.effects) worldState.add(effect);
    }
    if (valid) return subtasks;
  }
  return [];
}

export function createPlan(goalId: string, rootTaskId: string, worldState: string[]): HierarchicalPlan {
  const state = new Set(worldState);
  const orderedTasks = decompose(rootTaskId, state);
  const totalDuration = orderedTasks.reduce((s, t) => s + t.estimatedDurationMs, 0);

  const plan: HierarchicalPlan = {
    planId: `plan-${++planCounter}`,
    goalId, rootTask: rootTaskId,
    orderedTasks, totalEstimatedDurationMs: totalDuration,
    decompositionDepth: 0,
    createdAt: Date.now(),
  };
  plans.push(plan);
  return plan;
}

export function getPlan(planId: string): HierarchicalPlan | undefined { return plans.find(p => p.planId === planId); }
export function _resetHierarchicalPlannerForTest(): void { primitiveTasks.clear(); compoundTasks.clear(); plans.length = 0; taskCounter = 0; planCounter = 0; }
