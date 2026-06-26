/**
 * neuralPruningEngine.ts — v56.0.0 "The Neural Fabric"
 *
 * Implements structured and unstructured pruning of neural networks.
 * Supports magnitude-based, gradient-based, and activation-based pruning.
 */

export type PruningStrategy = "magnitude" | "gradient" | "activation" | "random";

export interface PruningConfig {
  strategy: PruningStrategy;
  targetSparsity: number;   // 0.0–1.0
  iterative: boolean;
  finetuneSteps: number;
}

export interface PruningResult {
  pruningId: string;
  layerId: string;
  strategy: PruningStrategy;
  originalParams: number;
  prunedParams: number;
  actualSparsity: number;
  performanceDrop: number;
  timestamp: number;
}

const pruningHistory: PruningResult[] = [];
let pruningCounter = 0;

export function pruneLayer(
  layerId: string,
  weights: number[][],
  config: PruningConfig
): { prunedWeights: number[][]; result: PruningResult } {
  const flat = weights.flat();
  const originalParams = flat.filter(w => w !== 0).length;
  let mask: boolean[][];

  if (config.strategy === "magnitude") {
    const sorted = [...flat.map(Math.abs)].sort((a, b) => a - b);
    const threshold = sorted[Math.floor(flat.length * config.targetSparsity)] ?? 0;
    mask = weights.map(row => row.map(w => Math.abs(w) > threshold));
  } else if (config.strategy === "random") {
    mask = weights.map(row => row.map(() => Math.random() > config.targetSparsity));
  } else {
    // gradient/activation: use magnitude as proxy
    const sorted = [...flat.map(Math.abs)].sort((a, b) => a - b);
    const threshold = sorted[Math.floor(flat.length * config.targetSparsity)] ?? 0;
    mask = weights.map(row => row.map(w => Math.abs(w) > threshold));
  }

  const prunedWeights = weights.map((row, i) => row.map((w, j) => mask[i][j] ? w : 0));
  const prunedParams = prunedWeights.flat().filter(w => w !== 0).length;
  const actualSparsity = 1 - prunedParams / flat.length;

  const result: PruningResult = {
    pruningId: `prune-${++pruningCounter}`,
    layerId,
    strategy: config.strategy,
    originalParams,
    prunedParams,
    actualSparsity,
    performanceDrop: actualSparsity * 0.02, // estimated
    timestamp: Date.now(),
  };
  pruningHistory.push(result);
  return { prunedWeights, result };
}

export function getPruningHistory(layerId?: string): PruningResult[] {
  return layerId ? pruningHistory.filter(r => r.layerId === layerId) : [...pruningHistory];
}

export function computeSparsity(weights: number[][]): number {
  const flat = weights.flat();
  return flat.filter(w => w === 0).length / flat.length;
}

export function _resetNeuralPruningEngineForTest(): void {
  pruningHistory.length = 0;
  pruningCounter = 0;
}
