/**
 * optimizationEnsembler.ts — v61.0.0 "The Optimization Core"
 * Combines results from multiple optimization algorithms and selects the best.
 */

export interface OptimizerResult { optimizerId: string; bestValue: number; bestParams: number[]; runtime: number; }
export interface EnsembledOptimization { ensembleId: string; winner: OptimizerResult; allResults: OptimizerResult[]; improvementOverBaseline: number; consensusParams: number[]; }

const ensembles: EnsembledOptimization[] = [];
let eCounter = 0;

export function ensembleOptimizers(results: OptimizerResult[], baseline: number): EnsembledOptimization {
  if (results.length === 0) throw new Error("[OptimizationEnsembler] No results provided");
  const winner = results.reduce((b, r) => r.bestValue > b.bestValue ? r : b);
  const improvementOverBaseline = winner.bestValue - baseline;
  const dim = winner.bestParams.length;
  const consensusParams = Array.from({ length: dim }, (_, i) =>
    results.reduce((s, r) => s + (r.bestParams[i] ?? 0), 0) / results.length
  );
  const ensemble: EnsembledOptimization = { ensembleId: `ens-${++eCounter}`, winner, allResults: results, improvementOverBaseline, consensusParams };
  ensembles.push(ensemble);
  return ensemble;
}

export function getEnsembles(): EnsembledOptimization[] { return [...ensembles]; }
export function _resetOptimizationEnsemblerForTest(): void { ensembles.length = 0; eCounter = 0; }
