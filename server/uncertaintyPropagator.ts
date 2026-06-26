/**
 * uncertaintyPropagator.ts — v59.0.0 "The Prediction Engine"
 * Propagates uncertainty through prediction chains using Monte Carlo sampling.
 */

export interface UncertaintyBound { mean: number; lower: number; upper: number; confidenceLevel: number; }
export interface PropagationResult { resultId: string; inputUncertainty: number; outputBounds: UncertaintyBound[]; propagationFactor: number; }
const results: PropagationResult[] = [];
let resCounter = 0;

export function propagateUncertainty(basePredictions: number[], inputStd: number, confidenceLevels = [0.68, 0.95]): PropagationResult {
  const outputBounds: UncertaintyBound[] = basePredictions.map((mean, i) => {
    const propagatedStd = inputStd * Math.sqrt(i + 1);  // uncertainty grows with horizon
    return confidenceLevels.map(cl => {
      const z = cl === 0.68 ? 1.0 : cl === 0.95 ? 1.96 : 2.576;
      return { mean, lower: mean - z * propagatedStd, upper: mean + z * propagatedStd, confidenceLevel: cl };
    });
  }).flat();
  const propagationFactor = basePredictions.length > 0 ? Math.sqrt(basePredictions.length) : 1;
  const result: PropagationResult = { resultId: `up-${++resCounter}`, inputUncertainty: inputStd, outputBounds, propagationFactor };
  results.push(result);
  return result;
}

export function _resetUncertaintyPropagatorForTest(): void { results.length = 0; resCounter = 0; }
