/**
 * conceptDriftHandler.ts — v64.0.0 "The Adaptation Engine"
 * Detects and handles concept drift using ADWIN-inspired sliding window error tracking.
 */

export type DriftType = "sudden" | "gradual" | "recurring" | "incremental";
export interface DriftEvent { driftId: string; detectedAt: number; driftType: DriftType; errorRateBefore: number; errorRateAfter: number; windowSize: number; }

const errorWindow: number[] = [];
const driftEvents: DriftEvent[] = [];
let dCounter = 0;
const WINDOW_SIZE = 50;
const DRIFT_THRESHOLD = 0.15;

export function recordPredictionError(error: number): void {
  errorWindow.push(error);
  if (errorWindow.length > WINDOW_SIZE * 2) errorWindow.shift();
}

export function checkForDrift(): DriftEvent | null {
  if (errorWindow.length < WINDOW_SIZE) return null;
  const firstHalf = errorWindow.slice(0, Math.floor(errorWindow.length / 2));
  const secondHalf = errorWindow.slice(Math.floor(errorWindow.length / 2));
  const errBefore = firstHalf.reduce((s, e) => s + e, 0) / firstHalf.length;
  const errAfter = secondHalf.reduce((s, e) => s + e, 0) / secondHalf.length;
  const delta = Math.abs(errAfter - errBefore);
  if (delta < DRIFT_THRESHOLD) return null;
  const driftType: DriftType = delta > 0.5 ? "sudden" : delta > 0.3 ? "gradual" : "incremental";
  const event: DriftEvent = { driftId: `drift-${++dCounter}`, detectedAt: Date.now(), driftType, errorRateBefore: errBefore, errorRateAfter: errAfter, windowSize: errorWindow.length };
  driftEvents.push(event);
  errorWindow.length = 0; // Reset after detection
  return event;
}

export function getDriftHistory(): DriftEvent[] { return [...driftEvents]; }
export function _resetConceptDriftHandlerForTest(): void { errorWindow.length = 0; driftEvents.length = 0; dCounter = 0; }
