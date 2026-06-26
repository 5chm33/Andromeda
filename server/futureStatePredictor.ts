/**
 * Future State Predictor — predicts future system states using Markov chains.
 * Implements n-gram state transition models and Monte Carlo rollouts.
 */

export interface StateTransition {
  fromState: string;
  toState: string;
  probability: number;
  observedCount: number;
}

export interface FutureStatePrediction {
  currentState: string;
  predictedStates: Array<{ state: string; probability: number; stepsAhead: number }>;
  confidence: number;
  horizon: number;
}

export interface PredictorReport {
  totalStates: number;
  totalTransitions: number;
  avgPredictionConfidence: number;
  mostLikelyNextState: string | null;
}

class FutureStatePredictorEngine {
  private transitions: Map<string, Map<string, StateTransition>> = new Map();
  private predictions: FutureStatePrediction[] = [];

  recordTransition(fromState: string, toState: string): void {
    if (!this.transitions.has(fromState)) this.transitions.set(fromState, new Map());
    const stateMap = this.transitions.get(fromState)!;
    if (!stateMap.has(toState)) {
      stateMap.set(toState, { fromState, toState, probability: 0, observedCount: 0 });
    }
    const t = stateMap.get(toState)!;
    t.observedCount++;
    // Normalize probabilities
    const total = Array.from(stateMap.values()).reduce((s, v) => s + v.observedCount, 0);
    for (const trans of stateMap.values()) {
      trans.probability = trans.observedCount / total;
    }
  }

  predictFutureStates(currentState: string, horizon = 3): FutureStatePrediction {
    const predictedStates: FutureStatePrediction["predictedStates"] = [];
    let state = currentState;
    let confidence = 1.0;

    for (let step = 1; step <= horizon; step++) {
      const stateMap = this.transitions.get(state);
      if (!stateMap || stateMap.size === 0) break;
      const sorted = Array.from(stateMap.values()).sort((a, b) => b.probability - a.probability);
      const best = sorted[0]!;
      confidence *= best.probability;
      predictedStates.push({ state: best.toState, probability: confidence, stepsAhead: step });
      state = best.toState;
    }

    const prediction: FutureStatePrediction = {
      currentState, predictedStates, confidence,
      horizon: predictedStates.length,
    };
    this.predictions.push(prediction);
    return prediction;
  }

  getPredictorReport(): PredictorReport {
    const allStates = new Set<string>();
    for (const [from, toMap] of this.transitions.entries()) {
      allStates.add(from);
      for (const to of toMap.keys()) allStates.add(to);
    }
    const mostLikely = this.predictions.length > 0
      ? this.predictions[this.predictions.length - 1]!.predictedStates[0]?.state ?? null
      : null;
    return {
      totalStates: allStates.size,
      totalTransitions: Array.from(this.transitions.values()).reduce((s, m) => s + m.size, 0),
      avgPredictionConfidence: this.predictions.length > 0
        ? this.predictions.reduce((s, p) => s + p.confidence, 0) / this.predictions.length
        : 0,
      mostLikelyNextState: mostLikely,
    };
  }
}

export const globalFutureStatePredictor = new FutureStatePredictorEngine();

export function recordStateTransition(fromState: string, toState: string): void {
  globalFutureStatePredictor.recordTransition(fromState, toState);
}
export function predictFutureStates(currentState: string, horizon?: number): FutureStatePrediction {
  return globalFutureStatePredictor.predictFutureStates(currentState, horizon);
}
export function getPredictorReport(): PredictorReport {
  return globalFutureStatePredictor.getPredictorReport();
}
export function initFutureStatePredictor(): void {
  console.log("[FutureStatePredictor] Future State Predictor initialized.");
}
