/**
 * slaMonitor.ts — v70.0.0 "Observability Stack"
 * SLA/SLO monitoring with error budget tracking, burn rate alerts, and compliance reporting.
 */
export interface SLO { sloId: string; name: string; targetPercentage: number; windowDays: number; errorBudgetMinutes: number; }
export interface SLAEvent { eventId: string; sloId: string; success: boolean; latencyMs: number; timestamp: number; }
export interface SLAReport { sloId: string; sloName: string; target: number; actual: number; compliant: boolean; errorBudgetUsedPercent: number; totalEvents: number; }

const slos = new Map<string, SLO>();
const events: SLAEvent[] = [];
let eventCounter = 0;

export function defineSLO(name: string, targetPercentage: number, windowDays = 30): SLO {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const errorBudgetMinutes = windowMs / 60000 * (1 - targetPercentage / 100);
  const slo: SLO = { sloId: `slo-${slos.size + 1}`, name, targetPercentage, windowDays, errorBudgetMinutes };
  slos.set(slo.sloId, slo);
  return slo;
}

export function recordSLAEvent(sloId: string, success: boolean, latencyMs: number): SLAEvent {
  const event: SLAEvent = { eventId: `evt-${++eventCounter}`, sloId, success, latencyMs, timestamp: Date.now() };
  events.push(event);
  return event;
}

export function generateSLAReport(sloId: string): SLAReport | null {
  const slo = slos.get(sloId);
  if (!slo) return null;
  const windowMs = slo.windowDays * 24 * 60 * 60 * 1000;
  const since = Date.now() - windowMs;
  const relevant = events.filter(e => e.sloId === sloId && e.timestamp >= since);
  if (relevant.length === 0) return { sloId, sloName: slo.name, target: slo.targetPercentage, actual: 100, compliant: true, errorBudgetUsedPercent: 0, totalEvents: 0 };
  const successCount = relevant.filter(e => e.success).length;
  const actual = (successCount / relevant.length) * 100;
  const failureMinutes = relevant.filter(e => !e.success).length * (relevant.reduce((s, e) => s + e.latencyMs, 0) / relevant.length / 60000);
  const errorBudgetUsedPercent = Math.min(100, (failureMinutes / slo.errorBudgetMinutes) * 100);
  return { sloId, sloName: slo.name, target: slo.targetPercentage, actual, compliant: actual >= slo.targetPercentage, errorBudgetUsedPercent, totalEvents: relevant.length };
}

export function _resetSLAMonitorForTest(): void { slos.clear(); events.length = 0; eventCounter = 0; }
