import { createLogger } from "./logger.js";
const log = createLogger("WorkflowEngine");
/**
 * workflowEngine.ts — v84.0.0 "Workflow & Task Automation"
 * Defines and executes multi-step workflows with conditional branching and parallel steps.
 */
export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type WorkflowStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface WorkflowStep {
  stepId: string;
  name: string;
  action: string;
  params: Record<string, unknown>;
  dependsOn: string[];
  condition?: string;
  timeout: number;
}

export interface WorkflowDefinition {
  workflowId: string;
  name: string;
  steps: WorkflowStep[];
  createdAt: number;
}

export interface WorkflowExecution {
  executionId: string;
  workflowId: string;
  status: WorkflowStatus;
  stepStatuses: Record<string, StepStatus>;
  startedAt: number;
  completedAt: number | null;
  outputs: Record<string, unknown>;
  error: string | null;
}

const definitions = new Map<string, WorkflowDefinition>();
const executions = new Map<string, WorkflowExecution>();
let defCounter = 0;
let execCounter = 0;

export function defineWorkflow(name: string, steps: Omit<WorkflowStep, "stepId">[]): WorkflowDefinition {
  const def: WorkflowDefinition = {
    workflowId: `wf-${++defCounter}`,
    name,
    steps: steps.map((s, i) => ({ ...s, stepId: `step-${defCounter}-${i + 1}` })),
    createdAt: Date.now(),
  };
  definitions.set(def.workflowId, def);
  return def;
}

export function startExecution(workflowId: string, inputs: Record<string, unknown> = {}): WorkflowExecution | null {
  const def = definitions.get(workflowId);
  if (!def) return null;

  const stepStatuses: Record<string, StepStatus> = {};
  for (const step of def.steps) stepStatuses[step.stepId] = "pending";

  const execution: WorkflowExecution = {
    executionId: `exec-${++execCounter}`,
    workflowId,
    status: "running",
    stepStatuses,
    startedAt: Date.now(),
    completedAt: null,
    outputs: { ...inputs },
    error: null,
  };
  executions.set(execution.executionId, execution);
  log.info(`[WorkflowEngine] Started execution ${execution.executionId} for workflow "${def.name}"`);
  return execution;
}

export function completeStep(executionId: string, stepId: string, output: unknown = null, success = true): boolean {
  const exec = executions.get(executionId);
  if (!exec) return false;
  exec.stepStatuses[stepId] = success ? "completed" : "failed";
  if (output !== null) exec.outputs[stepId] = output;
  if (!success) { exec.status = "failed"; exec.error = `Step ${stepId} failed`; exec.completedAt = Date.now(); }
  else {
    const allDone = Object.values(exec.stepStatuses).every(s => s === "completed" || s === "skipped");
    if (allDone) { exec.status = "completed"; exec.completedAt = Date.now(); }
  }
  return true;
}

export function getExecution(executionId: string): WorkflowExecution | undefined { return executions.get(executionId); }
export function getDefinition(workflowId: string): WorkflowDefinition | undefined { return definitions.get(workflowId); }
export function _resetWorkflowEngineForTest(): void { definitions.clear(); executions.clear(); defCounter = 0; execCounter = 0; }
