/**
 * agentOrchestrationEngine.ts — v48.0.0
 *
 * Top-level orchestration engine that combines load balancing, fault tolerance,
 * and coordination to execute complex multi-agent workflows end-to-end.
 */

export interface WorkflowDefinition {
  workflowId: string;
  name: string;
  stages: WorkflowStage[];
  parallelism: number;    // max concurrent stages
  timeoutMs: number;
}

export interface WorkflowStage {
  stageId: string;
  name: string;
  requiredCapabilities: string[];
  inputFrom?: string;     // stageId to get input from
  retries: number;
  timeoutMs: number;
}

export interface WorkflowExecution {
  executionId: string;
  workflowId: string;
  status: "running" | "completed" | "failed" | "timed-out";
  stageResults: Map<string, { output: unknown; durationMs: number; attempts: number }>;
  startedAt: number;
  completedAt?: number;
}

const workflows = new Map<string, WorkflowDefinition>();
const executions = new Map<string, WorkflowExecution>();
let executionCounter = 0;

export function registerWorkflow(def: WorkflowDefinition): void {
  workflows.set(def.workflowId, { ...def });
  console.log(`[Orchestration] Workflow "${def.name}" registered with ${def.stages.length} stages.`);
}

export function startExecution(workflowId: string): WorkflowExecution | null {
  const workflow = workflows.get(workflowId);
  if (!workflow) return null;

  const execution: WorkflowExecution = {
    executionId: `exec-${++executionCounter}-${Date.now()}`,
    workflowId,
    status: "running",
    stageResults: new Map(),
    startedAt: Date.now(),
  };
  executions.set(execution.executionId, execution);
  return execution;
}

export function recordStageResult(
  executionId: string,
  stageId: string,
  output: unknown,
  durationMs: number,
  attempts: number
): void {
  const execution = executions.get(executionId);
  if (!execution) return;
  execution.stageResults.set(stageId, { output, durationMs, attempts });
}

export function finalizeExecution(executionId: string, success: boolean): void {
  const execution = executions.get(executionId);
  if (!execution) return;
  execution.status = success ? "completed" : "failed";
  execution.completedAt = Date.now();
}

export function checkTimeout(executionId: string): boolean {
  const execution = executions.get(executionId);
  if (!execution) return false;
  const workflow = workflows.get(execution.workflowId);
  if (!workflow) return false;
  const elapsed = Date.now() - execution.startedAt;
  if (elapsed > workflow.timeoutMs) {
    execution.status = "timed-out";
    execution.completedAt = Date.now();
    return true;
  }
  return false;
}

export function getExecution(executionId: string): WorkflowExecution | undefined {
  return executions.get(executionId);
}

export function getExecutionSummary(executionId: string): {
  stagesCompleted: number;
  totalStages: number;
  elapsedMs: number;
  status: string;
} | null {
  const execution = executions.get(executionId);
  if (!execution) return null;
  const workflow = workflows.get(execution.workflowId);
  return {
    stagesCompleted: execution.stageResults.size,
    totalStages: workflow?.stages.length ?? 0,
    elapsedMs: (execution.completedAt ?? Date.now()) - execution.startedAt,
    status: execution.status,
  };
}

export function _resetOrchestrationEngineForTest(): void {
  workflows.clear();
  executions.clear();
  executionCounter = 0;
}
