/**
 * planExecutor.ts — v89.0.0 "Autonomous Planning & Goal Management"
 * Executes plans step-by-step with precondition checking and effect application.
 */
export type ExecutionStatus = "idle" | "executing" | "paused" | "completed" | "failed" | "aborted";

export interface ExecutionStep {
  stepId: string;
  taskId: string;
  taskName: string;
  action: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt: number | null;
  completedAt: number | null;
  result: unknown;
  error: string | null;
}

export interface PlanExecution {
  executionId: string;
  planId: string;
  steps: ExecutionStep[];
  currentStepIndex: number;
  status: ExecutionStatus;
  worldState: Set<string>;
  startedAt: number;
  completedAt: number | null;
  failureReason: string | null;
}

const executions = new Map<string, PlanExecution>();
let execCounter = 0;
let stepCounter = 0;

export function startPlanExecution(planId: string, tasks: Array<{ taskId: string; name: string; action: string; preconditions: string[]; effects: string[] }>, initialState: string[]): PlanExecution {
  const steps: ExecutionStep[] = tasks.map(t => ({
    stepId: `step-${++stepCounter}`,
    taskId: t.taskId, taskName: t.name, action: t.action,
    status: "pending",
    startedAt: null, completedAt: null,
    result: null, error: null,
  }));

  const execution: PlanExecution = {
    executionId: `exec-${++execCounter}`,
    planId, steps,
    currentStepIndex: 0,
    status: "executing",
    worldState: new Set(initialState),
    startedAt: Date.now(),
    completedAt: null,
    failureReason: null,
  };
  executions.set(execution.executionId, execution);
  return execution;
}

export function executeNextStep(executionId: string, taskPreconditions: string[], taskEffects: string[]): ExecutionStep | null {
  const exec = executions.get(executionId);
  if (!exec || exec.status !== "executing") return null;
  if (exec.currentStepIndex >= exec.steps.length) { exec.status = "completed"; exec.completedAt = Date.now(); return null; }

  const step = exec.steps[exec.currentStepIndex];
  // Check preconditions
  const preconditionsMet = taskPreconditions.every(p => exec.worldState.has(p));
  if (!preconditionsMet) {
    step.status = "failed";
    step.error = `Preconditions not met: ${taskPreconditions.filter(p => !exec.worldState.has(p)).join(", ")}`;
    exec.status = "failed";
    exec.failureReason = step.error;
    return step;
  }

  step.status = "running";
  step.startedAt = Date.now();
  // Simulate execution
  step.status = "completed";
  step.completedAt = Date.now();
  step.result = `${step.action} completed successfully`;
  // Apply effects
  for (const effect of taskEffects) exec.worldState.add(effect);
  exec.currentStepIndex++;

  if (exec.currentStepIndex >= exec.steps.length) { exec.status = "completed"; exec.completedAt = Date.now(); }
  return step;
}

export function abortExecution(executionId: string, reason: string): boolean {
  const exec = executions.get(executionId);
  if (!exec) return false;
  exec.status = "aborted";
  exec.failureReason = reason;
  exec.completedAt = Date.now();
  return true;
}

export function getExecution(executionId: string): PlanExecution | undefined { return executions.get(executionId); }
export function getCompletedSteps(executionId: string): ExecutionStep[] { return executions.get(executionId)?.steps.filter(s => s.status === "completed") ?? []; }
export function _resetPlanExecutorForTest(): void { executions.clear(); execCounter = 0; stepCounter = 0; }
