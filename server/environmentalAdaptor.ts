/**
 * environmentalAdaptor.ts — v64.0.0 "The Adaptation Engine"
 * Adapts system behavior based on detected environmental conditions and resource constraints.
 */

export type EnvironmentProfile = "development" | "staging" | "production" | "edge" | "cloud";
export interface EnvironmentSignal { signalId: string; metric: string; value: number; timestamp: number; }
export interface AdaptationDecision { decisionId: string; profile: EnvironmentProfile; adaptations: string[]; confidence: number; triggeredBy: string[]; }

const signals: EnvironmentSignal[] = [];
const decisions: AdaptationDecision[] = [];
let sCounter = 0, dCounter = 0;

export function recordSignal(metric: string, value: number): EnvironmentSignal {
  const signal: EnvironmentSignal = { signalId: `sig-${++sCounter}`, metric, value, timestamp: Date.now() };
  signals.push(signal);
  return signal;
}

export function adaptToEnvironment(currentProfile: EnvironmentProfile): AdaptationDecision {
  const recent = signals.slice(-20);
  const adaptations: string[] = [];
  const triggered: string[] = [];
  const cpuSignals = recent.filter(s => s.metric === "cpu_usage");
  const memSignals = recent.filter(s => s.metric === "memory_usage");
  const avgCpu = cpuSignals.length > 0 ? cpuSignals.reduce((s, v) => s + v.value, 0) / cpuSignals.length : 0;
  const avgMem = memSignals.length > 0 ? memSignals.reduce((s, v) => s + v.value, 0) / memSignals.length : 0;
  if (avgCpu > 80) { adaptations.push("reduce_parallelism"); triggered.push("high_cpu"); }
  if (avgMem > 85) { adaptations.push("enable_memory_compression"); triggered.push("high_memory"); }
  if (currentProfile === "edge") { adaptations.push("disable_heavy_models"); triggered.push("edge_profile"); }
  if (currentProfile === "production") { adaptations.push("enable_caching"); triggered.push("production_profile"); }
  const confidence = triggered.length > 0 ? Math.min(0.99, 0.7 + triggered.length * 0.1) : 0.5;
  const decision: AdaptationDecision = { decisionId: `adp-${++dCounter}`, profile: currentProfile, adaptations, confidence, triggeredBy: triggered };
  decisions.push(decision);
  return decision;
}

export function getAdaptationHistory(): AdaptationDecision[] { return [...decisions]; }
export function _resetEnvironmentalAdaptorForTest(): void { signals.length = 0; decisions.length = 0; sCounter = 0; dCounter = 0; }
