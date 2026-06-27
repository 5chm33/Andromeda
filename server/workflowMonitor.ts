/**
 * workflowMonitor.ts — v84.0.0 "Workflow & Task Automation"
 * Monitors workflow executions, tracks SLAs, and emits alerts for stuck or failed workflows.
 */
export type AlertSeverity = "info" | "warning" | "critical";

export interface WorkflowAlert {
  alertId: string;
  executionId: string;
  workflowId: string;
  severity: AlertSeverity;
  message: string;
  triggeredAt: number;
  resolved: boolean;
}

export interface WorkflowSLA {
  workflowId: string;
  maxDurationMs: number;
  warningThresholdMs: number;
}

export interface MonitoringStats {
  totalExecutions: number;
  completedCount: number;
  failedCount: number;
  runningCount: number;
  slaBreaches: number;
  averageDurationMs: number;
}

const alerts: WorkflowAlert[] = [];
const slas = new Map<string, WorkflowSLA>();
const executionLog: Array<{ executionId: string; workflowId: string; status: string; startedAt: number; completedAt: number | null; durationMs: number | null }> = [];
let alertCounter = 0;

export function registerSLA(workflowId: string, maxDurationMs: number, warningThresholdMs: number): WorkflowSLA {
  const sla: WorkflowSLA = { workflowId, maxDurationMs, warningThresholdMs };
  slas.set(workflowId, sla);
  return sla;
}

export function recordExecution(executionId: string, workflowId: string, status: string, startedAt: number, completedAt: number | null): void {
  const durationMs = completedAt ? completedAt - startedAt : null;
  executionLog.push({ executionId, workflowId, status, startedAt, completedAt, durationMs });

  const sla = slas.get(workflowId);
  if (sla && durationMs !== null) {
    if (durationMs > sla.maxDurationMs) {
      emitAlert(executionId, workflowId, "critical", `SLA breach: execution took ${durationMs}ms (max: ${sla.maxDurationMs}ms)`);
    } else if (durationMs > sla.warningThresholdMs) {
      emitAlert(executionId, workflowId, "warning", `SLA warning: execution took ${durationMs}ms (threshold: ${sla.warningThresholdMs}ms)`);
    }
  }

  if (status === "failed") {
    emitAlert(executionId, workflowId, "critical", `Workflow execution ${executionId} failed`);
  }
}

export function emitAlert(executionId: string, workflowId: string, severity: AlertSeverity, message: string): WorkflowAlert {
  const alert: WorkflowAlert = {
    alertId: `alert-${++alertCounter}`,
    executionId, workflowId, severity, message,
    triggeredAt: Date.now(),
    resolved: false,
  };
  alerts.push(alert);
  console.log(`[WorkflowMonitor] ${severity.toUpperCase()}: ${message}`);
  return alert;
}

export function resolveAlert(alertId: string): boolean {
  const alert = alerts.find(a => a.alertId === alertId);
  if (!alert) return false;
  alert.resolved = true;
  return true;
}

export function getStats(): MonitoringStats {
  const completed = executionLog.filter(e => e.status === "completed");
  const durations = completed.map(e => e.durationMs ?? 0);
  const avgDuration = durations.length > 0 ? durations.reduce((s, v) => s + v, 0) / durations.length : 0;
  const slaBreaches = alerts.filter(a => a.message.includes("SLA breach")).length;

  return {
    totalExecutions: executionLog.length,
    completedCount: completed.length,
    failedCount: executionLog.filter(e => e.status === "failed").length,
    runningCount: executionLog.filter(e => e.status === "running").length,
    slaBreaches,
    averageDurationMs: avgDuration,
  };
}

export function getActiveAlerts(): WorkflowAlert[] { return alerts.filter(a => !a.resolved); }
export function _resetWorkflowMonitorForTest(): void { alerts.length = 0; slas.clear(); executionLog.length = 0; alertCounter = 0; }
