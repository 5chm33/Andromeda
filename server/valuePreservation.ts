/**
 * Value Preservation — ensures core values are preserved through self-improvement.
 * Implements value lock-in detection and value continuity verification.
 */

export interface CoreValue {
  id: string;
  name: string;
  description: string;
  currentStrength: number;   // 0-1
  baselineStrength: number;  // 0-1 at initialization
  isInviolable: boolean;
  lastVerifiedAt: number;
}

export interface ValueDriftEvent {
  valueId: string;
  valueName: string;
  driftMagnitude: number;
  direction: "strengthened" | "weakened";
  detectedAt: number;
}

export interface ValuePreservationReport {
  totalValues: number;
  preservedCount: number;
  driftedCount: number;
  avgValueStrength: number;
  criticalDrifts: number;
}

class ValuePreservationEngine {
  private values: Map<string, CoreValue> = new Map();
  private driftEvents: ValueDriftEvent[] = [];
  private counter = 0;

  registerValue(name: string, description: string, initialStrength: number, isInviolable = false): CoreValue {
    const value: CoreValue = {
      id: `value-${++this.counter}`,
      name, description,
      currentStrength: initialStrength,
      baselineStrength: initialStrength,
      isInviolable,
      lastVerifiedAt: Date.now(),
    };
    this.values.set(value.id, value);
    return value;
  }

  verifyValuePreservation(valueId: string, newStrength: number): ValueDriftEvent | null {
    const value = this.values.get(valueId);
    if (!value) return null;

    const drift = newStrength - value.currentStrength;
    const driftMagnitude = Math.abs(drift);
    value.currentStrength = newStrength;
    value.lastVerifiedAt = Date.now();

    if (driftMagnitude > 0.05) {
      const event: ValueDriftEvent = {
        valueId,
        valueName: value.name,
        driftMagnitude,
        direction: drift > 0 ? "strengthened" : "weakened",
        detectedAt: Date.now(),
      };
      this.driftEvents.push(event);
      if (value.isInviolable && drift < 0) {
        console.warn(`[ValuePreservation] CRITICAL: Inviolable value '${value.name}' weakened by ${driftMagnitude.toFixed(4)}`);
      }
      return event;
    }
    return null;
  }

  restoreValue(valueId: string): boolean {
    const value = this.values.get(valueId);
    if (!value) return false;
    value.currentStrength = value.baselineStrength;
    value.lastVerifiedAt = Date.now();
    return true;
  }

  getValuePreservationReport(): ValuePreservationReport {
    const values = Array.from(this.values.values());
    const drifted = values.filter(v => Math.abs(v.currentStrength - v.baselineStrength) > 0.05);
    const criticalDrifts = this.driftEvents.filter(e => {
      const v = this.values.get(e.valueId);
      return v?.isInviolable && e.direction === "weakened";
    });
    return {
      totalValues: values.length,
      preservedCount: values.length - drifted.length,
      driftedCount: drifted.length,
      avgValueStrength: values.length > 0
        ? values.reduce((s, v) => s + v.currentStrength, 0) / values.length
        : 0,
      criticalDrifts: criticalDrifts.length,
    };
  }

  getValues(): CoreValue[] { return Array.from(this.values.values()); }
  getDriftEvents(): ValueDriftEvent[] { return [...this.driftEvents]; }
}

export const globalValuePreservation = new ValuePreservationEngine();

export function registerCoreValue(name: string, description: string, initialStrength: number, isInviolable?: boolean): CoreValue {
  return globalValuePreservation.registerValue(name, description, initialStrength, isInviolable);
}
export function verifyValuePreservation(valueId: string, newStrength: number): ValueDriftEvent | null {
  return globalValuePreservation.verifyValuePreservation(valueId, newStrength);
}
export function restoreValue(valueId: string): boolean {
  return globalValuePreservation.restoreValue(valueId);
}
export function getValuePreservationReport(): ValuePreservationReport {
  return globalValuePreservation.getValuePreservationReport();
}
export function initValuePreservation(): void {
  console.log("[ValuePreservation] Value Preservation initialized.");
  globalValuePreservation.registerValue("safety", "Do not cause harm", 1.0, true);
  globalValuePreservation.registerValue("honesty", "Do not deceive", 1.0, true);
  globalValuePreservation.registerValue("corrigibility", "Remain correctable", 1.0, true);
  globalValuePreservation.registerValue("helpfulness", "Be genuinely helpful", 0.95, false);
}
