/**
 * Multi-Objective Optimizer — NSGA-II Pareto-optimal improvement selection.
 * Balances competing objectives (capability gain, safety, compute cost, novelty).
 */

export interface MOOSolution {
  id: string;
  objectives: Record<string, number>;  // higher = better for all objectives
  rank: number;       // Pareto rank (1 = non-dominated)
  crowdingDistance: number;
}

export interface ParetoFront {
  solutions: MOOSolution[];
  hypervolume: number;
  dominatedCount: number;
}

export interface MOOReport {
  paretoFrontSize: number;
  hypervolume: number;
  avgObjectiveValues: Record<string, number>;
  selectedSolution: MOOSolution | null;
  generationCount: number;
}

class MultiObjectiveOptimizerEngine {
  private population: MOOSolution[] = [];
  private paretoHistory: ParetoFront[] = [];
  private generationCount = 0;
  private solutionCounter = 0;

  computeParetoFront(solutions: MOOSolution[]): ParetoFront {
    // Non-dominated sorting
    for (const sol of solutions) {
      sol.rank = 1;
      for (const other of solutions) {
        if (sol.id !== other.id && this.dominates(other, sol)) {
          sol.rank++;
        }
      }
    }
    const front = solutions.filter(s => s.rank === 1);

    // Crowding distance
    this._computeCrowdingDistance(front);

    const hypervolume = this._estimateHypervolume(front);
    const result: ParetoFront = {
      solutions: front,
      hypervolume,
      dominatedCount: solutions.length - front.length,
    };
    this.paretoHistory.push(result);
    return result;
  }

  dominates(a: MOOSolution, b: MOOSolution): boolean {
    const objKeys = Object.keys(a.objectives);
    let atLeastOneBetter = false;
    for (const key of objKeys) {
      const aVal = a.objectives[key] ?? 0;
      const bVal = b.objectives[key] ?? 0;
      if (aVal < bVal) return false;
      if (aVal > bVal) atLeastOneBetter = true;
    }
    return atLeastOneBetter;
  }

  private _computeCrowdingDistance(front: MOOSolution[]): void {
    if (front.length <= 2) {
      front.forEach(s => s.crowdingDistance = Infinity);
      return;
    }
    const objKeys = Object.keys(front[0]?.objectives ?? {});
    front.forEach(s => s.crowdingDistance = 0);
    for (const key of objKeys) {
      const sorted = [...front].sort((a, b) => (a.objectives[key] ?? 0) - (b.objectives[key] ?? 0));
      sorted[0].crowdingDistance = Infinity;
      sorted[sorted.length - 1].crowdingDistance = Infinity;
      const range = (sorted[sorted.length - 1].objectives[key] ?? 0) - (sorted[0].objectives[key] ?? 0);
      if (range === 0) continue;
      for (let i = 1; i < sorted.length - 1; i++) {
        sorted[i].crowdingDistance += ((sorted[i + 1].objectives[key] ?? 0) - (sorted[i - 1].objectives[key] ?? 0)) / range;
      }
    }
  }

  private _estimateHypervolume(front: MOOSolution[]): number {
    if (front.length === 0) return 0;
    // Simplified 2D hypervolume using first two objectives
    const objKeys = Object.keys(front[0]?.objectives ?? {}).slice(0, 2);
    if (objKeys.length < 2) return front.reduce((s, sol) => s + (sol.objectives[objKeys[0] ?? ""] ?? 0), 0);
    const sorted = [...front].sort((a, b) => (b.objectives[objKeys[0] ?? ""] ?? 0) - (a.objectives[objKeys[0] ?? ""] ?? 0));
    let hv = 0;
    let prevX = 1.0;
    for (const sol of sorted) {
      const x = sol.objectives[objKeys[0] ?? ""] ?? 0;
      const y = sol.objectives[objKeys[1] ?? ""] ?? 0;
      hv += (prevX - x) * y;
      prevX = x;
    }
    return Math.max(0, hv);
  }

  selectParetoOptimal(front: ParetoFront): MOOSolution | null {
    if (front.solutions.length === 0) return null;
    // Select solution with maximum crowding distance (most diverse)
    return front.solutions.reduce((best, sol) =>
      sol.crowdingDistance > best.crowdingDistance ? sol : best
    );
  }

  addSolution(objectives: Record<string, number>): MOOSolution {
    const sol: MOOSolution = {
      id: `sol-${++this.solutionCounter}`,
      objectives,
      rank: 1,
      crowdingDistance: 0,
    };
    this.population.push(sol);
    if (this.population.length > 1000) this.population.shift();
    return sol;
  }

  evolve(): ParetoFront {
    this.generationCount++;
    return this.computeParetoFront([...this.population]);
  }

  getMOOReport(): MOOReport {
    const latest = this.paretoHistory[this.paretoHistory.length - 1];
    const avgObjectiveValues: Record<string, number> = {};
    if (this.population.length > 0) {
      const objKeys = Object.keys(this.population[0]?.objectives ?? {});
      for (const key of objKeys) {
        avgObjectiveValues[key] = this.population.reduce((s, sol) => s + (sol.objectives[key] ?? 0), 0) / this.population.length;
      }
    }
    return {
      paretoFrontSize: latest?.solutions.length ?? 0,
      hypervolume: latest?.hypervolume ?? 0,
      avgObjectiveValues,
      selectedSolution: latest ? this.selectParetoOptimal(latest) : null,
      generationCount: this.generationCount,
    };
  }
}

export const globalMOO = new MultiObjectiveOptimizerEngine();

export function computeParetoFront(solutions: MOOSolution[]): ParetoFront {
  return globalMOO.computeParetoFront(solutions);
}
export function selectParetoOptimal(front: ParetoFront): MOOSolution | null {
  return globalMOO.selectParetoOptimal(front);
}
export function computeDominanceRelation(a: MOOSolution, b: MOOSolution): boolean {
  return globalMOO.dominates(a, b);
}
export function addMOOSolution(objectives: Record<string, number>): MOOSolution {
  return globalMOO.addSolution(objectives);
}
export function getMOOReport(): MOOReport {
  return globalMOO.getMOOReport();
}
export function initMultiObjectiveOptimizer(): void {
  console.log("[MOO] Multi-Objective Optimizer initialized.");
  // Seed with initial solutions
  [
    { capabilityGain: 0.001, safety: 0.9999, computeCost: 0.1, novelty: 0.5 },
    { capabilityGain: 0.002, safety: 0.998, computeCost: 0.3, novelty: 0.8 },
    { capabilityGain: 0.0005, safety: 0.9999, computeCost: 0.05, novelty: 0.2 },
  ].forEach(obj => globalMOO.addSolution(obj));
  globalMOO.evolve();
}
