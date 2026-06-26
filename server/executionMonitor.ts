/**
 * Execution Monitor — monitors the execution of plans and detects deviations.
 * Implements plan deviation detection, recovery triggering, and execution telemetry.
 */

export interface ExecutionTrace {
  id: string;
  planId: string;
  stepName: string;
  expectedDurationMs: number;
  actualDurationMs: number;
  expectedOutcome: string;
  actualOutcome: string;
  deviation: number;  // 0-1, 0 = perfect, 1 = complete failure
  status: "success" | "deviation" | "failure";
  timestamp: number;
}

export interface ExecutionStatus {
  planId: string;
  completedSteps: number;
  totalSteps: number;
  overallDeviation: number;
  needsRecovery: boolean;
  estimatedCompletionMs: number;
}

export interface ExecutionReport {
  totalTraces: number;
  successRate: number;
  avgDeviation: number;
  recoveryTriggered: number;
}

class ExecutionMonitorEngine {
  private traces: ExecutionTrace[] = [];
  private planStatuses: Map<string, ExecutionStatus> = new Map();
  private counter = 0;
  private recoveryTriggered = 0;

  startPlan(planId: string, totalSteps: number): ExecutionStatus {
    const status: ExecutionStatus = {
      planId, completedSteps: 0, totalSteps,
      overallDeviation: 0, needsRecovery: false,
      estimatedCompletionMs: totalSteps * 1000,
    };
    this.planStatuses.set(planId, status);
    return status;
  }

  recordStep(
    planId: string, stepName: string,
    expectedDurationMs: number, actualDurationMs: number,
    expectedOutcome: string, actualOutcome: string
  ): ExecutionTrace {
    const deviation = expectedOutcome === actualOutcome
      ? Math.min(1, Math.abs(actualDurationMs - expectedDurationMs) / (expectedDurationMs + 1))
      : 0.8;

    const status = deviation < 0.2 ? "success" : deviation < 0.6 ? "deviation" : "failure";

    const trace: ExecutionTrace = {
      id: `trace-${++this.counter}`,
      planId, stepName, expectedDurationMs, actualDurationMs,
      expectedOutcome, actualOutcome, deviation, status,
      timestamp: Date.now(),
    };
    this.traces.push(trace);

    // Update plan status
    const planStatus = this.planStatuses.get(planId);
    if (planStatus) {
      planStatus.completedSteps++;
      planStatus.overallDeviation = (planStatus.overallDeviation * (planStatus.completedSteps - 1) + deviation) / planStatus.completedSteps;
      planStatus.needsRecovery = planStatus.overallDeviation > 0.5;
      if (planStatus.needsRecovery) this.recoveryTriggered++;
    }

    return trace;
  }

  getPlanStatus(planId: string): ExecutionStatus | null {
    return this.planStatuses.get(planId) ?? null;
  }

  getExecutionReport(): ExecutionReport {
    const successful = this.traces.filter(t => t.status === "success");
    return {
      totalTraces: this.traces.length,
      successRate: this.traces.length > 0 ? successful.length / this.traces.length : 1,
      avgDeviation: this.traces.length > 0 ? this.traces.reduce((s, t) => s + t.deviation, 0) / this.traces.length : 0,
      recoveryTriggered: this.recoveryTriggered,
    };
  }
}

export const globalExecutionMonitor = new ExecutionMonitorEngine();

export function startPlanExecution(planId: string, totalSteps: number): ExecutionStatus {
  return globalExecutionMonitor.startPlan(planId, totalSteps);
}
export function recordExecutionStep(
  planId: string, stepName: string,
  expectedDurationMs: number, actualDurationMs: number,
  expectedOutcome: string, actualOutcome: string
): ExecutionTrace {
  return globalExecutionMonitor.recordStep(planId, stepName, expectedDurationMs, actualDurationMs, expectedOutcome, actualOutcome);
}
export function getPlanStatus(planId: string): ExecutionStatus | null {
  return globalExecutionMonitor.getPlanStatus(planId);
}
export function getExecutionReport(): ExecutionReport {
  return globalExecutionMonitor.getExecutionReport();
}
export function initExecutionMonitor(): void {
  console.log("[ExecutionMonitor] Execution Monitor initialized.");
}
