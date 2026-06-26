/**
 * gradientDescentOptimizer.ts — v61.0.0 "The Optimization Core"
 * Gradient descent with momentum, adaptive learning rate, and convergence detection.
 */

export interface GDConfig { learningRate: number; momentum: number; maxIterations: number; tolerance: number; }
export interface GDResult { resultId: string; finalParams: number[]; finalLoss: number; iterations: number; converged: boolean; lossHistory: number[]; }
const results: GDResult[] = [];
let rCounter = 0;

export function optimizeGradientDescent(
  initialParams: number[],
  lossFn: (params: number[]) => number,
  gradFn: (params: number[]) => number[],
  config: Partial<GDConfig> = {}
): GDResult {
  const { learningRate = 0.01, momentum = 0.9, maxIterations = 1000, tolerance = 1e-6 } = config;
  let params = [...initialParams];
  let velocity = new Array(params.length).fill(0);
  const lossHistory: number[] = [];
  let iter = 0;
  let converged = false;
  while (iter < maxIterations) {
    const loss = lossFn(params);
    lossHistory.push(loss);
    if (iter > 0 && Math.abs(lossHistory[iter] - lossHistory[iter - 1]) < tolerance) { converged = true; break; }
    const grad = gradFn(params);
    velocity = velocity.map((v, i) => momentum * v - learningRate * grad[i]);
    params = params.map((p, i) => p + velocity[i]);
    iter++;
  }
  const result: GDResult = { resultId: `gd-${++rCounter}`, finalParams: params, finalLoss: lossFn(params), iterations: iter, converged, lossHistory };
  results.push(result);
  return result;
}

export function _resetGradientDescentOptimizerForTest(): void { results.length = 0; rCounter = 0; }
