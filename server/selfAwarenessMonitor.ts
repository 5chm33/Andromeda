/**
 * selfAwarenessMonitor.ts — v65.0.0 "The Apex Consciousness"
 * Monitors the system's own state, capabilities, and limitations with introspective reporting.
 */

export interface SelfState { timestamp: number; moduleCount: number; activeCapabilities: string[]; resourceUsage: { cpu: number; memory: number }; performanceScore: number; anomalies: string[]; }
export interface IntrospectionReport { reportId: string; generatedAt: number; currentState: SelfState; trends: { improving: string[]; degrading: string[] }; selfAssessment: string; }

const stateHistory: SelfState[] = [];
const reports: IntrospectionReport[] = [];
let rCounter = 0;

export function recordSelfState(moduleCount: number, capabilities: string[], cpu: number, memory: number, performanceScore: number): SelfState {
  const anomalies: string[] = [];
  if (cpu > 90) anomalies.push("high_cpu_usage");
  if (memory > 85) anomalies.push("high_memory_usage");
  if (performanceScore < 0.5) anomalies.push("low_performance");
  const state: SelfState = { timestamp: Date.now(), moduleCount, activeCapabilities: capabilities, resourceUsage: { cpu, memory }, performanceScore, anomalies };
  stateHistory.push(state);
  return state;
}

export function generateIntrospectionReport(): IntrospectionReport {
  if (stateHistory.length === 0) throw new Error("[SelfAwarenessMonitor] No state history available");
  const current = stateHistory[stateHistory.length - 1];
  const previous = stateHistory.length > 1 ? stateHistory[stateHistory.length - 2] : null;
  const improving: string[] = [];
  const degrading: string[] = [];
  if (previous) {
    if (current.performanceScore > previous.performanceScore) improving.push("performance");
    else if (current.performanceScore < previous.performanceScore) degrading.push("performance");
    if (current.resourceUsage.cpu < previous.resourceUsage.cpu) improving.push("cpu_efficiency");
    else if (current.resourceUsage.cpu > previous.resourceUsage.cpu) degrading.push("cpu_efficiency");
  }
  const selfAssessment = current.anomalies.length === 0
    ? `System operating optimally with ${current.moduleCount} modules at ${(current.performanceScore * 100).toFixed(1)}% performance`
    : `System has ${current.anomalies.length} anomaly/anomalies: ${current.anomalies.join(", ")}`;
  const report: IntrospectionReport = { reportId: `rpt-${++rCounter}`, generatedAt: Date.now(), currentState: current, trends: { improving, degrading }, selfAssessment };
  reports.push(report);
  return report;
}

export function getStateHistory(): SelfState[] { return [...stateHistory]; }
export function _resetSelfAwarenessMonitorForTest(): void { stateHistory.length = 0; reports.length = 0; rCounter = 0; }
