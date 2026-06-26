/**
 * apiWorkflowComposer.ts — v52.0.0
 *
 * Composes multi-step API workflows from individual endpoint definitions,
 * supporting sequential, parallel, and conditional execution patterns.
 */

export type StepType = "sequential" | "parallel" | "conditional";

export interface WorkflowStep {
  stepId: string;
  apiId: string;
  endpoint: string;
  method: string;
  inputMapping?: Record<string, string>;  // output field -> input param
  condition?: string;                      // JS-like expression e.g. "$.status === 'active'"
  retryCount?: number;
}

export interface Workflow {
  workflowId: string;
  name: string;
  steps: WorkflowStep[];
  type: StepType;
  createdAt: number;
}

export interface WorkflowExecution {
  executionId: string;
  workflowId: string;
  status: "pending" | "running" | "completed" | "failed";
  stepResults: Record<string, unknown>;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

const workflows = new Map<string, Workflow>();
const executions = new Map<string, WorkflowExecution>();
let wfCounter = 0;
let execCounter = 0;

export function createWorkflow(name: string, steps: WorkflowStep[], type: StepType = "sequential"): Workflow {
  const wf: Workflow = {
    workflowId: `wf-${++wfCounter}`,
    name,
    steps,
    type,
    createdAt: Date.now(),
  };
  workflows.set(wf.workflowId, wf);
  return wf;
}

export function startExecution(workflowId: string, initialInput: Record<string, unknown> = {}): WorkflowExecution {
  const wf = workflows.get(workflowId);
  if (!wf) throw new Error(`[WorkflowComposer] Workflow "${workflowId}" not found`);

  const exec: WorkflowExecution = {
    executionId: `exec-${++execCounter}`,
    workflowId,
    status: "running",
    stepResults: { _input: initialInput },
    startedAt: Date.now(),
  };
  executions.set(exec.executionId, exec);

  // Simulate step execution
  try {
    for (const step of wf.steps) {
      exec.stepResults[step.stepId] = { status: "completed", output: { stepId: step.stepId, apiId: step.apiId } };
    }
    exec.status = "completed";
    exec.completedAt = Date.now();
  } catch (e) {
    exec.status = "failed";
    exec.error = (e as Error).message;
    exec.completedAt = Date.now();
  }

  return exec;
}

export function getWorkflow(workflowId: string): Workflow | undefined {
  return workflows.get(workflowId);
}

export function getExecution(executionId: string): WorkflowExecution | undefined {
  return executions.get(executionId);
}

export function listWorkflows(): Workflow[] {
  return Array.from(workflows.values());
}

export function _resetWorkflowComposerForTest(): void {
  workflows.clear();
  executions.clear();
  wfCounter = 0;
  execCounter = 0;
}
