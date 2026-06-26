/**
 * transcendentSelfModel.ts — v55.0.0 "The Grand Unification"
 *
 * Maintains a comprehensive self-model of Andromeda's own capabilities,
 * limitations, state, and trajectory. The agent's "self-awareness" layer.
 */

export interface CapabilityAssessment {
  capabilityId: string;
  name: string;
  domain: string;
  proficiencyLevel: number;   // 0.0–1.0
  confidenceInAssessment: number;
  lastDemonstrated?: number;
  improvementRate: number;    // per-cycle delta
  limitations: string[];
}

export interface SelfModelSnapshot {
  snapshotId: string;
  version: string;
  totalCapabilities: number;
  avgProficiency: number;
  topCapabilities: CapabilityAssessment[];
  weakestCapabilities: CapabilityAssessment[];
  overallHealthScore: number;
  trajectory: "improving" | "stable" | "degrading";
  capturedAt: number;
}

const capabilities = new Map<string, CapabilityAssessment>();
const snapshots: SelfModelSnapshot[] = [];
let capCounter = 0;
let snapCounter = 0;

export function registerCapability(
  name: string,
  domain: string,
  initialProficiency = 0.5,
  limitations: string[] = []
): CapabilityAssessment {
  const cap: CapabilityAssessment = {
    capabilityId: `cap-${++capCounter}`,
    name,
    domain,
    proficiencyLevel: initialProficiency,
    confidenceInAssessment: 0.5,
    improvementRate: 0,
    limitations,
  };
  capabilities.set(cap.capabilityId, cap);
  return cap;
}

export function updateCapabilityProficiency(capabilityId: string, newProficiency: number, confidence = 0.8): boolean {
  const cap = capabilities.get(capabilityId);
  if (!cap) return false;
  const delta = newProficiency - cap.proficiencyLevel;
  cap.improvementRate = (cap.improvementRate * 0.9) + (delta * 0.1); // EMA
  cap.proficiencyLevel = Math.max(0, Math.min(1, newProficiency));
  cap.confidenceInAssessment = confidence;
  cap.lastDemonstrated = Date.now();
  return true;
}

export function captureSnapshot(version: string): SelfModelSnapshot {
  const all = Array.from(capabilities.values());
  const avgProficiency = all.length > 0 ? all.reduce((s, c) => s + c.proficiencyLevel, 0) / all.length : 0;
  const sorted = [...all].sort((a, b) => b.proficiencyLevel - a.proficiencyLevel);
  const avgImprovement = all.reduce((s, c) => s + c.improvementRate, 0) / Math.max(all.length, 1);
  const trajectory: SelfModelSnapshot["trajectory"] = avgImprovement > 0.01 ? "improving" : avgImprovement < -0.01 ? "degrading" : "stable";

  const snapshot: SelfModelSnapshot = {
    snapshotId: `snap-${++snapCounter}`,
    version,
    totalCapabilities: all.length,
    avgProficiency,
    topCapabilities: sorted.slice(0, 3),
    weakestCapabilities: sorted.slice(-3).reverse(),
    overallHealthScore: avgProficiency * 0.7 + (avgImprovement > 0 ? 0.3 : 0),
    trajectory,
    capturedAt: Date.now(),
  };
  snapshots.push(snapshot);
  return snapshot;
}

export function getCapabilityByName(name: string): CapabilityAssessment | undefined {
  return Array.from(capabilities.values()).find(c => c.name === name);
}

export function getSnapshotHistory(): SelfModelSnapshot[] {
  return [...snapshots];
}

export function _resetSelfModelForTest(): void {
  capabilities.clear();
  snapshots.length = 0;
  capCounter = 0;
  snapCounter = 0;
}
