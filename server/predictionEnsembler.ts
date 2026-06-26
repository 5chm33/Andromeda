/**
 * predictionEnsembler.ts — v59.0.0 "The Prediction Engine"
 * Combines multiple prediction models using weighted averaging and stacking.
 */

export interface ModelPrediction { modelId: string; predictions: number[]; weight: number; historicalAccuracy: number; }
export interface EnsembleResult { ensembleId: string; ensembledPredictions: number[]; modelCount: number; totalWeight: number; diversityScore: number; }
const ensembles: EnsembleResult[] = [];
let ensCounter = 0;

export function ensemblePredictions(models: ModelPrediction[]): EnsembleResult {
  if (models.length === 0) throw new Error("[PredictionEnsembler] No models provided");
  const horizon = models[0].predictions.length;
  const totalWeight = models.reduce((s, m) => s + m.weight, 0);
  const ensembledPredictions = Array.from({ length: horizon }, (_, i) =>
    models.reduce((s, m) => s + (m.predictions[i] ?? 0) * (m.weight / totalWeight), 0)
  );
  // Diversity: average pairwise correlation difference
  let diversityScore = 0;
  if (models.length > 1) {
    let pairs = 0;
    for (let i = 0; i < models.length; i++) {
      for (let j = i + 1; j < models.length; j++) {
        const diff = models[i].predictions.reduce((s, v, k) => s + Math.abs(v - (models[j].predictions[k] ?? 0)), 0) / horizon;
        diversityScore += diff;
        pairs++;
      }
    }
    diversityScore /= pairs;
  }
  const result: EnsembleResult = { ensembleId: `ens-${++ensCounter}`, ensembledPredictions, modelCount: models.length, totalWeight, diversityScore };
  ensembles.push(result);
  return result;
}

export function getEnsembles(): EnsembleResult[] { return [...ensembles]; }
export function _resetPredictionEnsemblerForTest(): void { ensembles.length = 0; ensCounter = 0; }
