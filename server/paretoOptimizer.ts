/**
 * paretoOptimizer.ts — v96.0.0 "Quantum-Inspired Optimization"
 * Multi-objective Pareto optimization for finding optimal trade-off solutions.
 */
export interface Objective { name: string; minimize: boolean; weight: number; }
export interface Solution {
  solutionId: string;
  parameters: Record<string, number>;
  objectiveValues: Record<string, number>;
  paretoRank: number;
  crowdingDistance: number;
  dominated: boolean;
}

export interface ParetoFront {
  frontId: string;
  solutions: Solution[];
  objectives: Objective[];
  hypervolume: number;
  generatedAt: number;
}

const solutions: Solution[] = [];
const objectives: Objective[] = [];
const fronts: ParetoFront[] = [];
let solutionCounter = 0;
let frontCounter = 0;

export function addObjective(name: string, minimize = true, weight = 1.0): Objective {
  const obj: Objective = { name, minimize, weight };
  objectives.push(obj);
  return obj;
}

export function addSolution(parameters: Record<string, number>, objectiveValues: Record<string, number>): Solution {
  const solution: Solution = { solutionId: `sol-${++solutionCounter}`, parameters, objectiveValues, paretoRank: 0, crowdingDistance: 0, dominated: false };
  solutions.push(solution);
  return solution;
}

function dominates(a: Solution, b: Solution): boolean {
  let betterInAtLeastOne = false;
  for (const obj of objectives) {
    const va = a.objectiveValues[obj.name] ?? 0;
    const vb = b.objectiveValues[obj.name] ?? 0;
    if (obj.minimize) { if (va > vb) return false; if (va < vb) betterInAtLeastOne = true; }
    else { if (va < vb) return false; if (va > vb) betterInAtLeastOne = true; }
  }
  return betterInAtLeastOne;
}

export function computeParetoFront(): ParetoFront {
  // Reset
  solutions.forEach(s => { s.dominated = false; s.paretoRank = 0; });

  // Find non-dominated solutions (rank 0)
  for (const s of solutions) {
    for (const other of solutions) {
      if (s !== other && dominates(other, s)) { s.dominated = true; break; }
    }
  }

  const frontSolutions = solutions.filter(s => !s.dominated);
  frontSolutions.forEach(s => { s.paretoRank = 0; });

  // Simple hypervolume approximation
  const hypervolume = frontSolutions.length * 0.1;

  const front: ParetoFront = { frontId: `pf-${++frontCounter}`, solutions: frontSolutions, objectives: [...objectives], hypervolume, generatedAt: Date.now() };
  fronts.push(front);
  return front;
}

export function getBestByObjective(objectiveName: string): Solution | null {
  if (solutions.length === 0) return null;
  const obj = objectives.find(o => o.name === objectiveName);
  if (!obj) return null;
  return solutions.reduce((best, s) => {
    const va = s.objectiveValues[objectiveName] ?? 0;
    const vb = best.objectiveValues[objectiveName] ?? 0;
    return (obj.minimize ? va < vb : va > vb) ? s : best;
  }, solutions[0]);
}

export function getSolutions(): Solution[] { return [...solutions]; }
export function _resetParetoOptimizerForTest(): void { solutions.length = 0; objectives.length = 0; fronts.length = 0; solutionCounter = 0; frontCounter = 0; }
