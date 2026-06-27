import { createLogger } from "./logger.js";
const log = createLogger("SloTracker");
/**
 * sloTracker.ts — v75.0.0 "Incident Management & SRE"
 * Tracks Service Level Objectives (SLOs) and computes compliance against targets.
 */
export type SloType = "availability" | "latency" | "error_rate" | "throughput";

export interface SloDefinition {
  sloId: string;
  name: string;
  service: string;
  sloType: SloType;
  targetPercent: number;
  windowDays: number;
}

export interface SloMeasurement {
  measurementId: string;
  sloId: string;
  timestamp: number;
  goodEvents: number;
  totalEvents: number;
  compliancePercent: number;
  withinTarget: boolean;
}

export interface SloStatus {
  sloId: string;
  name: string;
  targetPercent: number;
  currentCompliancePercent: number;
  withinTarget: boolean;
  measurementCount: number;
}

const slos = new Map<string, SloDefinition>();
const measurements: SloMeasurement[] = [];
let measurementCounter = 0;

export function registerSlo(slo: SloDefinition): void {
  slos.set(slo.sloId, slo);
  log.info(`[SloTracker] Registered SLO: ${slo.name} (target: ${slo.targetPercent}%)`);
}

export function recordMeasurement(sloId: string, goodEvents: number, totalEvents: number): SloMeasurement | null {
  const slo = slos.get(sloId);
  if (!slo) return null;
  const compliancePercent = totalEvents > 0 ? (goodEvents / totalEvents) * 100 : 100;
  const measurement: SloMeasurement = {
    measurementId: `meas-${++measurementCounter}`,
    sloId, timestamp: Date.now(),
    goodEvents, totalEvents, compliancePercent,
    withinTarget: compliancePercent >= slo.targetPercent,
  };
  measurements.push(measurement);
  return measurement;
}

export function getSloStatus(sloId: string): SloStatus | null {
  const slo = slos.get(sloId);
  if (!slo) return null;
  const sloMeasurements = measurements.filter(m => m.sloId === sloId);
  if (sloMeasurements.length === 0) return { sloId, name: slo.name, targetPercent: slo.targetPercent, currentCompliancePercent: 100, withinTarget: true, measurementCount: 0 };
  const avgCompliance = sloMeasurements.reduce((sum, m) => sum + m.compliancePercent, 0) / sloMeasurements.length;
  return { sloId, name: slo.name, targetPercent: slo.targetPercent, currentCompliancePercent: avgCompliance, withinTarget: avgCompliance >= slo.targetPercent, measurementCount: sloMeasurements.length };
}

export function getAllSloStatuses(): SloStatus[] { return [...slos.keys()].map(id => getSloStatus(id)!).filter(Boolean); }
export function getMeasurements(): SloMeasurement[] { return [...measurements]; }
export function _resetSloTrackerForTest(): void { slos.clear(); measurements.length = 0; measurementCounter = 0; }
