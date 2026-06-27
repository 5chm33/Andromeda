/**
 * planMonitor.ts — v89.0.0 "Autonomous Planning & Goal Management"
 * Monitors plan execution progress, detects deviations, and triggers re-planning signals.
 */
export type DeviationType = "timeout" | "precondition_failure" | "unexpected_state" | "resource_exhaustion" | "goal_drift";

export interface PlanDeviation {
  deviationId: string;
  executionId: string;
  type: DeviationType;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  detectedAt: number;
  requiresReplanning: boolean;
}

export interface MonitoringCheckpoint {
  checkpointId: string;
  executionId: string;
  stepIndex: number;
  expectedState: string[];
  actualState: string[];
  stateMatch: boolean;
  checkedAt: number;
}

const deviations: PlanDeviation[] = [];
const checkpoints: MonitoringCheckpoint[] = [];
let devCounter = 0;
let cpCounter = 0;

export function checkStateDeviation(executionId: string, stepIndex: number, expectedState: string[], actualState: string[]): MonitoringCheckpoint {
  const actualSet = new Set(actualState);
  const missing = expectedState.filter(s => !actualSet.has(s));
  const stateMatch = missing.length === 0;

  const checkpoint: MonitoringCheckpoint = {
    checkpointId: `cp-${++cpCounter}`,
    executionId, stepIndex,
    expectedState, actualState,
    stateMatch,
    checkedAt: Date.now(),
  };
  checkpoints.push(checkpoint);

  if (!stateMatch) {
    recordDeviation(executionId, "unexpected_state", `Missing expected states: ${missing.join(", ")}`, "medium", true);
  }
  return checkpoint;
}

export function recordDeviation(executionId: string, type: DeviationType, description: string, severity: PlanDeviation["severity"], requiresReplanning: boolean): PlanDeviation {
  const deviation: PlanDeviation = {
    deviationId: `dev-${++devCounter}`,
    executionId, type, description, severity,
    detectedAt: Date.now(),
    requiresReplanning,
  };
  deviations.push(deviation);
  return deviation;
}

export function checkTimeout(executionId: string, startedAt: number, maxDurationMs: number): boolean {
  const elapsed = Date.now() - startedAt;
  if (elapsed > maxDurationMs) {
    recordDeviation(executionId, "timeout", `Execution exceeded ${maxDurationMs}ms timeout (elapsed: ${elapsed}ms)`, "high", true);
    return true;
  }
  return false;
}

export function getDeviations(executionId?: string): PlanDeviation[] {
  return executionId ? deviations.filter(d => d.executionId === executionId) : [...deviations];
}

export function requiresReplanning(executionId: string): boolean {
  return deviations.some(d => d.executionId === executionId && d.requiresReplanning);
}

export function getCheckpoints(executionId: string): MonitoringCheckpoint[] { return checkpoints.filter(c => c.executionId === executionId); }
export function _resetPlanMonitorForTest(): void { deviations.length = 0; checkpoints.length = 0; devCounter = 0; cpCounter = 0; }
