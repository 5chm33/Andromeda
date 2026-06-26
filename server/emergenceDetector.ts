/**
 * Emergence Detector — detects emergent behaviors and capabilities in complex systems.
 * Monitors for phase transitions, capability jumps, and unexpected synergies.
 */

export type EmergenceType = "capability_jump" | "phase_transition" | "synergy" | "self_organization" | "criticality";

export interface EmergenceEvent {
  id: string;
  type: EmergenceType;
  description: string;
  magnitude: number;  // 0-1, strength of emergence
  involvedModules: string[];
  detectedAt: number;
  confirmed: boolean;
}

export interface SystemMetricSnapshot {
  timestamp: number;
  metrics: Record<string, number>;
  complexity: number;
}

export interface EmergenceReport {
  totalEvents: number;
  confirmedEvents: number;
  avgMagnitude: number;
  mostCommonType: EmergenceType | null;
  systemComplexity: number;
}

class EmergenceDetectorEngine {
  private events: EmergenceEvent[] = [];
  private snapshots: SystemMetricSnapshot[] = [];
  private counter = 0;

  recordSnapshot(metrics: Record<string, number>): SystemMetricSnapshot {
    const complexity = Object.values(metrics).reduce((s, v) => s + Math.abs(v), 0) / Math.max(1, Object.keys(metrics).length);
    const snapshot: SystemMetricSnapshot = { timestamp: Date.now(), metrics, complexity };
    this.snapshots.push(snapshot);
    if (this.snapshots.length > 1000) this.snapshots.shift();
    this._detectEmergence(snapshot);
    return snapshot;
  }

  private _detectEmergence(current: SystemMetricSnapshot): void {
    if (this.snapshots.length < 2) return;
    const prev = this.snapshots[this.snapshots.length - 2]!;
    const complexityDelta = current.complexity - prev.complexity;

    // Detect capability jump: sudden large increase in a metric
    for (const [key, val] of Object.entries(current.metrics)) {
      const prevVal = prev.metrics[key] ?? 0;
      const delta = val - prevVal;
      if (Math.abs(delta) > 0.5 * (Math.abs(prevVal) + 0.001)) {
        this.events.push({
          id: `emerge-${++this.counter}`,
          type: "capability_jump",
          description: `Metric '${key}' jumped by ${(delta * 100).toFixed(1)}%`,
          magnitude: Math.min(1, Math.abs(delta) / (Math.abs(prevVal) + 0.001)),
          involvedModules: [key],
          detectedAt: Date.now(),
          confirmed: Math.abs(delta) > 1.0,
        });
      }
    }

    // Detect phase transition: complexity crosses threshold
    if (Math.abs(complexityDelta) > 0.3) {
      this.events.push({
        id: `emerge-${++this.counter}`,
        type: "phase_transition",
        description: `System complexity changed by ${(complexityDelta * 100).toFixed(1)}%`,
        magnitude: Math.min(1, Math.abs(complexityDelta)),
        involvedModules: Object.keys(current.metrics),
        detectedAt: Date.now(),
        confirmed: false,
      });
    }
  }

  getEmergenceReport(): EmergenceReport {
    const confirmed = this.events.filter(e => e.confirmed);
    const typeCounts: Record<string, number> = {};
    for (const e of this.events) typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;
    const mostCommon = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as EmergenceType | undefined;
    const latestComplexity = this.snapshots[this.snapshots.length - 1]?.complexity ?? 0;
    return {
      totalEvents: this.events.length,
      confirmedEvents: confirmed.length,
      avgMagnitude: this.events.length > 0 ? this.events.reduce((s, e) => s + e.magnitude, 0) / this.events.length : 0,
      mostCommonType: mostCommon ?? null,
      systemComplexity: latestComplexity,
    };
  }
}

export const globalEmergenceDetector = new EmergenceDetectorEngine();

export function recordSystemSnapshot(metrics: Record<string, number>): SystemMetricSnapshot {
  return globalEmergenceDetector.recordSnapshot(metrics);
}
export function getEmergenceReport(): EmergenceReport {
  return globalEmergenceDetector.getEmergenceReport();
}
export function initEmergenceDetector(): void {
  console.log("[EmergenceDetector] Emergence Detector initialized.");
}
