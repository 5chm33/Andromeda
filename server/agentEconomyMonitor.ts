/**
 * agentEconomyMonitor.ts — v49.0.0
 *
 * Monitors the health and efficiency of the entire sub-agent economy:
 * compute utilization, task throughput, cost efficiency, and market equilibrium.
 */

export interface EconomySnapshot {
  snapshotId: string;
  timestamp: number;
  totalAgents: number;
  activeAgents: number;
  idleAgents: number;
  totalTasksCompleted: number;
  totalComputeUnitsSpent: number;
  avgTaskDurationMs: number;
  marketClearingRate: number;  // 0.0–1.0 (tasks matched / tasks submitted)
  costEfficiency: number;       // tasks per compute unit
}

export interface EconomyAlert {
  alertId: string;
  type: "underutilization" | "overload" | "market-failure" | "cost-spike" | "agent-shortage";
  description: string;
  severity: "info" | "warning" | "critical";
  timestamp: number;
}

const snapshots: EconomySnapshot[] = [];
const alerts: EconomyAlert[] = [];
let snapshotCounter = 0;
let alertCounter = 0;

export function recordSnapshot(data: Omit<EconomySnapshot, "snapshotId" | "timestamp">): EconomySnapshot {
  const snapshot: EconomySnapshot = {
    snapshotId: `econ-snap-${++snapshotCounter}`,
    timestamp: Date.now(),
    ...data,
  };
  snapshots.push(snapshot);

  // Auto-detect anomalies
  detectAnomalies(snapshot);

  return snapshot;
}

function detectAnomalies(snap: EconomySnapshot): void {
  const utilization = snap.totalAgents > 0 ? snap.activeAgents / snap.totalAgents : 0;

  if (utilization < 0.1 && snap.totalAgents > 5) {
    raiseAlert("underutilization", `Only ${(utilization * 100).toFixed(0)}% of agents are active.`, "warning");
  }
  if (utilization > 0.95) {
    raiseAlert("overload", `Agent pool at ${(utilization * 100).toFixed(0)}% capacity — risk of queue buildup.`, "critical");
  }
  if (snap.marketClearingRate < 0.5) {
    raiseAlert("market-failure", `Market clearing rate dropped to ${(snap.marketClearingRate * 100).toFixed(0)}%.`, "warning");
  }
  if (snap.costEfficiency < 0.01) {
    raiseAlert("cost-spike", `Cost efficiency critically low: ${snap.costEfficiency.toFixed(4)} tasks/unit.`, "critical");
  }
}

function raiseAlert(type: EconomyAlert["type"], description: string, severity: EconomyAlert["severity"]): void {
  alerts.push({
    alertId: `alert-${++alertCounter}`,
    type,
    description,
    severity,
    timestamp: Date.now(),
  });
  console.warn(`[EconomyMonitor] ${severity.toUpperCase()} — ${description}`);
}

export function getTrend(metric: keyof EconomySnapshot, windowSize = 5): "improving" | "degrading" | "stable" {
  if (snapshots.length < 2) return "stable";
  const window = snapshots.slice(-Math.min(windowSize, snapshots.length));
  const first = window[0][metric] as number;
  const last = window[window.length - 1][metric] as number;
  const delta = last - first;
  if (Math.abs(delta) < 0.01) return "stable";
  // For cost metrics, lower is better; for throughput, higher is better
  const lowerIsBetter = metric === "avgTaskDurationMs" || metric === "totalComputeUnitsSpent";
  return (lowerIsBetter ? delta < 0 : delta > 0) ? "improving" : "degrading";
}

export function getLatestSnapshot(): EconomySnapshot | null {
  return snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
}

export function getAlerts(severity?: EconomyAlert["severity"]): EconomyAlert[] {
  return severity ? alerts.filter(a => a.severity === severity) : [...alerts];
}

export function getEconomyHealth(): "healthy" | "degraded" | "critical" {
  const criticalAlerts = alerts.filter(a => a.severity === "critical").length;
  const warningAlerts = alerts.filter(a => a.severity === "warning").length;
  if (criticalAlerts > 0) return "critical";
  if (warningAlerts > 2) return "degraded";
  return "healthy";
}

export function _resetEconomyMonitorForTest(): void {
  snapshots.length = 0;
  alerts.length = 0;
  snapshotCounter = 0;
  alertCounter = 0;
}
