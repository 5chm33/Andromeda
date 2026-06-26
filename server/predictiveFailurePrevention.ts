import fs from "fs";
import path from "path";

const PREDICTOR_STATE_FILE = path.join(process.cwd(), ".andromeda_failure_predictor.json");

export interface PredictorState {
  fileFailureCounts: Record<string, number>;
  fileSuccessCounts: Record<string, number>;
  totalPredictions: number;
  correctPredictions: number;
}

export function initFailurePredictor(): void {
  if (!fs.existsSync(PREDICTOR_STATE_FILE)) {
    const defaultState: PredictorState = {
      fileFailureCounts: {},
      fileSuccessCounts: {},
      totalPredictions: 0,
      correctPredictions: 0
    };
    fs.writeFileSync(PREDICTOR_STATE_FILE, JSON.stringify(defaultState, null, 2));
  }
}

export function getPredictorState(): PredictorState {
  try {
    return JSON.parse(fs.readFileSync(PREDICTOR_STATE_FILE, "utf-8"));
  } catch {
    return { fileFailureCounts: {}, fileSuccessCounts: {}, totalPredictions: 0, correctPredictions: 0 };
  }
}

export function savePredictorState(state: PredictorState): void {
  fs.writeFileSync(PREDICTOR_STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Predicts whether an RSI attempt on a specific file is likely to fail.
 * Uses a simple Bayesian-inspired heuristic based on historical success/failure ratios.
 * @returns true if predicted to fail (should skip), false if safe to proceed.
 */
export function predictFailure(filePath: string): boolean {
  const state = getPredictorState();
  const failures = state.fileFailureCounts[filePath] || 0;
  const successes = state.fileSuccessCounts[filePath] || 0;
  const total = failures + successes;
  
  // Need at least 3 attempts to form a prediction
  if (total < 3) return false;
  
  // If failure rate is > 80%, predict failure
  const failureRate = failures / total;
  return failureRate > 0.8;
}

/**
 * Records the actual outcome of an RSI attempt to train the predictor.
 */
export function recordRsiOutcome(filePath: string, success: boolean, wasPredictedToFail: boolean): void {
  const state = getPredictorState();
  
  if (success) {
    state.fileSuccessCounts[filePath] = (state.fileSuccessCounts[filePath] || 0) + 1;
  } else {
    state.fileFailureCounts[filePath] = (state.fileFailureCounts[filePath] || 0) + 1;
  }
  
  // Track accuracy if a prediction was actionable
  const total = (state.fileFailureCounts[filePath] || 0) + (state.fileSuccessCounts[filePath] || 0);
  if (total >= 3) {
    state.totalPredictions++;
    if ((success && !wasPredictedToFail) || (!success && wasPredictedToFail)) {
      state.correctPredictions++;
    }
  }
  
  savePredictorState(state);
}
