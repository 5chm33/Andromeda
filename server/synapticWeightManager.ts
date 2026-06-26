/**
 * synapticWeightManager.ts — v56.0.0 "The Neural Fabric"
 *
 * Manages synaptic weight matrices for neural-inspired processing.
 * Supports weight initialization, update, regularization, and serialization.
 */

export interface WeightMatrix {
  matrixId: string;
  fromLayer: string;
  toLayer: string;
  weights: number[][];
  biases: number[];
  l2Norm: number;
  updateCount: number;
  lastUpdatedAt: number;
}

export interface WeightUpdateResult {
  matrixId: string;
  prevL2Norm: number;
  newL2Norm: number;
  updateMagnitude: number;
}

const matrices = new Map<string, WeightMatrix>();
let matrixCounter = 0;

export function initializeWeights(fromLayer: string, toLayer: string, inputDim: number, outputDim: number): WeightMatrix {
  // Xavier initialization
  const scale = Math.sqrt(2.0 / (inputDim + outputDim));
  const weights: number[][] = Array.from({ length: outputDim }, () =>
    Array.from({ length: inputDim }, () => (Math.random() * 2 - 1) * scale)
  );
  const biases = new Array(outputDim).fill(0);
  const l2Norm = computeL2Norm(weights);
  const matrix: WeightMatrix = {
    matrixId: `wm-${++matrixCounter}`,
    fromLayer,
    toLayer,
    weights,
    biases,
    l2Norm,
    updateCount: 0,
    lastUpdatedAt: Date.now(),
  };
  matrices.set(matrix.matrixId, matrix);
  return matrix;
}

export function applyWeightUpdate(matrixId: string, gradients: number[][], learningRate: number): WeightUpdateResult {
  const matrix = matrices.get(matrixId);
  if (!matrix) throw new Error(`[SynapticWeightManager] Matrix "${matrixId}" not found`);
  const prevNorm = matrix.l2Norm;
  let totalUpdate = 0;
  for (let i = 0; i < matrix.weights.length; i++) {
    for (let j = 0; j < matrix.weights[i].length; j++) {
      const grad = gradients[i]?.[j] ?? 0;
      matrix.weights[i][j] -= learningRate * grad;
      totalUpdate += Math.abs(learningRate * grad);
    }
  }
  matrix.l2Norm = computeL2Norm(matrix.weights);
  matrix.updateCount++;
  matrix.lastUpdatedAt = Date.now();
  return { matrixId, prevL2Norm: prevNorm, newL2Norm: matrix.l2Norm, updateMagnitude: totalUpdate };
}

export function applyL2Regularization(matrixId: string, lambda: number): void {
  const matrix = matrices.get(matrixId);
  if (!matrix) return;
  for (let i = 0; i < matrix.weights.length; i++) {
    for (let j = 0; j < matrix.weights[i].length; j++) {
      matrix.weights[i][j] *= (1 - lambda);
    }
  }
  matrix.l2Norm = computeL2Norm(matrix.weights);
}

export function getWeightMatrix(matrixId: string): WeightMatrix | undefined {
  return matrices.get(matrixId);
}

export function getWeightStats(matrixId: string): { mean: number; std: number; sparsity: number } | null {
  const matrix = matrices.get(matrixId);
  if (!matrix) return null;
  const flat = matrix.weights.flat();
  const mean = flat.reduce((s, v) => s + v, 0) / flat.length;
  const variance = flat.reduce((s, v) => s + (v - mean) ** 2, 0) / flat.length;
  const sparsity = flat.filter(v => Math.abs(v) < 1e-6).length / flat.length;
  return { mean, std: Math.sqrt(variance), sparsity };
}

function computeL2Norm(weights: number[][]): number {
  return Math.sqrt(weights.flat().reduce((s, v) => s + v * v, 0));
}

export function _resetSynapticWeightManagerForTest(): void {
  matrices.clear();
  matrixCounter = 0;
}
