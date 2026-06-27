/**
 * systemHealthMonitor.ts — v100.0.0 "Andromeda: The Complete Autonomous AI System"
 * Holistic system health monitoring across all Andromeda subsystems.
 */
export type HealthStatus = "healthy" | "warning" | "critical" | "unknown";
export interface SubsystemHealth {
  subsystemId: string;
  name: string;
  status: HealthStatus;
  score: number;
  metrics: Record<string, number>;
  lastCheckedAt: number;
  consecutiveFailures: number;
  alerts: string[];
}

export interface SystemHealthReport {
  reportId: string;
  overallStatus: HealthStatus;
  overallScore: number;
  subsystems: SubsystemHealth[];
  criticalCount: number;
  warningCount: number;
  healthyCount: number;
  recommendations: string[];
  generatedAt: number;
}

const subsystems = new Map<string, SubsystemHealth>();
const reports: SystemHealthReport[] = [];
let subsystemCounter = 0;
let reportCounter = 0;

export function registerSubsystem(name: string): SubsystemHealth {
  const sub: SubsystemHealth = { subsystemId: `sub-${++subsystemCounter}`, name, status: "unknown", score: 1.0, metrics: {}, lastCheckedAt: Date.now(), consecutiveFailures: 0, alerts: [] };
  subsystems.set(sub.subsystemId, sub);
  return sub;
}

export function updateHealth(subsystemId: string, score: number, metrics: Record<string, number> = {}, alerts: string[] = []): SubsystemHealth | null {
  const sub = subsystems.get(subsystemId);
  if (!sub) return null;
  sub.score = Math.max(0, Math.min(1, score));
  sub.metrics = { ...sub.metrics, ...metrics };
  sub.alerts = alerts;
  sub.lastCheckedAt = Date.now();
  if (score >= 0.8) { sub.status = "healthy"; sub.consecutiveFailures = 0; }
  else if (score >= 0.5) { sub.status = "warning"; }
  else { sub.status = "critical"; sub.consecutiveFailures++; }
  return sub;
}

export function generateReport(): SystemHealthReport {
  const allSubs = [...subsystems.values()];
  const criticalCount = allSubs.filter(s => s.status === "critical").length;
  const warningCount = allSubs.filter(s => s.status === "warning").length;
  const healthyCount = allSubs.filter(s => s.status === "healthy").length;
  const overallScore = allSubs.length > 0 ? allSubs.reduce((s, sub) => s + sub.score, 0) / allSubs.length : 1.0;

  let overallStatus: HealthStatus;
  if (criticalCount > 0) overallStatus = "critical";
  else if (warningCount > 0) overallStatus = "warning";
  else if (healthyCount > 0) overallStatus = "healthy";
  else overallStatus = "unknown";

  const recommendations: string[] = [];
  if (criticalCount > 0) recommendations.push(`${criticalCount} subsystem(s) critical — immediate attention required`);
  if (warningCount > 0) recommendations.push(`${warningCount} subsystem(s) in warning state — monitor closely`);
  if (overallScore > 0.9) recommendations.push("System performing optimally — no action required");

  const report: SystemHealthReport = { reportId: `hr-${++reportCounter}`, overallStatus, overallScore, subsystems: allSubs.map(s => ({ ...s })), criticalCount, warningCount, healthyCount, recommendations, generatedAt: Date.now() };
  reports.push(report);
  return report;
}

export function getSubsystem(subsystemId: string): SubsystemHealth | undefined { return subsystems.get(subsystemId); }
export function getReports(): SystemHealthReport[] { return [...reports]; }
export function _resetSystemHealthMonitorForTest(): void { subsystems.clear(); reports.length = 0; subsystemCounter = 0; reportCounter = 0; }
