/**
 * particleSwarmOptimizer.ts — v61.0.0 "The Optimization Core"
 * PSO with inertia weight, cognitive and social components.
 */

export interface Particle { position: number[]; velocity: number[]; bestPosition: number[]; bestFitness: number; }
export interface PSOResult { resultId: string; globalBestPosition: number[]; globalBestFitness: number; iterations: number; swarmSize: number; }
const results: PSOResult[] = [];
let rCounter = 0;

export function optimizePSO(
  fitnessFn: (pos: number[]) => number,
  bounds: Array<[number, number]>,
  swarmSize = 30,
  iterations = 100
): PSOResult {
  const w = 0.7, c1 = 1.5, c2 = 1.5;
  let particles: Particle[] = Array.from({ length: swarmSize }, () => {
    const position = bounds.map(([min, max]) => min + Math.random() * (max - min));
    const velocity = bounds.map(([min, max]) => (Math.random() - 0.5) * (max - min) * 0.1);
    const fitness = fitnessFn(position);
    return { position, velocity, bestPosition: [...position], bestFitness: fitness };
  });
  let globalBest = particles.reduce((b, p) => p.bestFitness > b.bestFitness ? p : b);
  let gBestPos = [...globalBest.bestPosition];
  let gBestFit = globalBest.bestFitness;
  for (let iter = 0; iter < iterations; iter++) {
    for (const p of particles) {
      p.velocity = p.velocity.map((v, i) =>
        w * v + c1 * Math.random() * (p.bestPosition[i] - p.position[i]) + c2 * Math.random() * (gBestPos[i] - p.position[i])
      );
      p.position = p.position.map((pos, i) => Math.max(bounds[i][0], Math.min(bounds[i][1], pos + p.velocity[i])));
      const fitness = fitnessFn(p.position);
      if (fitness > p.bestFitness) { p.bestFitness = fitness; p.bestPosition = [...p.position]; }
      if (fitness > gBestFit) { gBestFit = fitness; gBestPos = [...p.position]; }
    }
  }
  const result: PSOResult = { resultId: `pso-${++rCounter}`, globalBestPosition: gBestPos, globalBestFitness: gBestFit, iterations, swarmSize };
  results.push(result);
  return result;
}

export function _resetParticleSwarmOptimizerForTest(): void { results.length = 0; rCounter = 0; }
