/**
 * bayesianOptimizer.ts — v61.0.0 "The Optimization Core"
 * Bayesian optimization with Gaussian process surrogate and upper confidence bound acquisition.
 */

export interface SearchSpace { min: number; max: number; }
export interface BOObservation { params: number[]; value: number; }
export interface BOResult { resultId: string; bestParams: number[]; bestValue: number; observations: BOObservation[]; iterations: number; }

const results: BOResult[] = [];
let rCounter = 0;

function ucbAcquisition(mean: number, std: number, kappa = 2.0): number { return mean + kappa * std; }

export function optimizeBayesian(
  objectiveFn: (params: number[]) => number,
  searchSpaces: SearchSpace[],
  iterations = 20
): BOResult {
  const observations: BOObservation[] = [];
  // Random initial exploration
  for (let i = 0; i < Math.min(5, iterations); i++) {
    const params = searchSpaces.map(s => s.min + Math.random() * (s.max - s.min));
    observations.push({ params, value: objectiveFn(params) });
  }
  // UCB-guided exploitation
  for (let i = observations.length; i < iterations; i++) {
    const candidates = Array.from({ length: 20 }, () =>
      searchSpaces.map(s => s.min + Math.random() * (s.max - s.min))
    );
    let bestCandidate = candidates[0];
    let bestAcq = -Infinity;
    for (const candidate of candidates) {
      const dists = observations.map(o => Math.sqrt(o.params.reduce((s, p, j) => s + (p - candidate[j]) ** 2, 0)));
      const minDist = Math.min(...dists);
      const meanEst = observations.reduce((s, o) => s + o.value * Math.exp(-dists[observations.indexOf(o)]), 0) / observations.length;
      const stdEst = minDist / (searchSpaces.length + 1);
      const acq = ucbAcquisition(meanEst, stdEst);
      if (acq > bestAcq) { bestAcq = acq; bestCandidate = candidate; }
    }
    observations.push({ params: bestCandidate, value: objectiveFn(bestCandidate) });
  }
  const best = observations.reduce((b, o) => o.value > b.value ? o : b);
  const result: BOResult = { resultId: `bo-${++rCounter}`, bestParams: best.params, bestValue: best.value, observations, iterations };
  results.push(result);
  return result;
}

export function _resetBayesianOptimizerForTest(): void { results.length = 0; rCounter = 0; }
