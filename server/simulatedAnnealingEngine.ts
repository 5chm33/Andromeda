/**
 * simulatedAnnealingEngine.ts — v61.0.0 "The Optimization Core"
 * Simulated annealing with exponential cooling schedule.
 */

export interface SAResult { resultId: string; bestSolution: number[]; bestEnergy: number; iterations: number; finalTemperature: number; acceptanceRate: number; }
const results: SAResult[] = [];
let rCounter = 0;

export function optimizeSimulatedAnnealing(
  energyFn: (solution: number[]) => number,
  initialSolution: number[],
  neighborFn: (solution: number[]) => number[],
  initialTemp = 100,
  coolingRate = 0.995,
  maxIterations = 1000
): SAResult {
  let current = [...initialSolution];
  let currentEnergy = energyFn(current);
  let best = [...current];
  let bestEnergy = currentEnergy;
  let temp = initialTemp;
  let accepted = 0;
  for (let i = 0; i < maxIterations; i++) {
    const neighbor = neighborFn(current);
    const neighborEnergy = energyFn(neighbor);
    const delta = neighborEnergy - currentEnergy;
    if (delta < 0 || Math.random() < Math.exp(-delta / temp)) {
      current = neighbor;
      currentEnergy = neighborEnergy;
      accepted++;
      if (currentEnergy < bestEnergy) { best = [...current]; bestEnergy = currentEnergy; }
    }
    temp *= coolingRate;
  }
  const result: SAResult = { resultId: `sa-${++rCounter}`, bestSolution: best, bestEnergy, iterations: maxIterations, finalTemperature: temp, acceptanceRate: accepted / maxIterations };
  results.push(result);
  return result;
}

export function _resetSimulatedAnnealingEngineForTest(): void { results.length = 0; rCounter = 0; }
