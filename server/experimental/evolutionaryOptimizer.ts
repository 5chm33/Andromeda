/**
 * evolutionaryOptimizer.ts — v61.0.0 "The Optimization Core"
 * Genetic algorithm with tournament selection, crossover, and mutation.
 */

export interface Individual { genes: number[]; fitness: number; }
export interface EvoResult { resultId: string; bestIndividual: Individual; generations: number; populationSize: number; converged: boolean; }
const results: EvoResult[] = [];
let rCounter = 0;

export function optimizeEvolutionary(
  fitnessFn: (genes: number[]) => number,
  geneRanges: Array<[number, number]>,
  populationSize = 50,
  generations = 100,
  mutationRate = 0.1
): EvoResult {
  let population: Individual[] = Array.from({ length: populationSize }, () => {
    const genes = geneRanges.map(([min, max]) => min + Math.random() * (max - min));
    return { genes, fitness: fitnessFn(genes) };
  });
  let converged = false;
  for (let gen = 0; gen < generations; gen++) {
    population.sort((a, b) => b.fitness - a.fitness);
    if (gen > 10 && population[0].fitness - population[populationSize - 1].fitness < 1e-6) { converged = true; break; }
    const elite = population.slice(0, Math.floor(populationSize * 0.1));
    const newPop: Individual[] = [...elite];
    while (newPop.length < populationSize) {
      const p1 = population[Math.floor(Math.random() * populationSize / 2)];
      const p2 = population[Math.floor(Math.random() * populationSize / 2)];
      const crossPoint = Math.floor(Math.random() * p1.genes.length);
      const childGenes = [...p1.genes.slice(0, crossPoint), ...p2.genes.slice(crossPoint)].map(
        (g, i) => Math.random() < mutationRate ? geneRanges[i][0] + Math.random() * (geneRanges[i][1] - geneRanges[i][0]) : g
      );
      newPop.push({ genes: childGenes, fitness: fitnessFn(childGenes) });
    }
    population = newPop;
  }
  population.sort((a, b) => b.fitness - a.fitness);
  const result: EvoResult = { resultId: `evo-${++rCounter}`, bestIndividual: population[0], generations, populationSize, converged };
  results.push(result);
  return result;
}

export function _resetEvolutionaryOptimizerForTest(): void { results.length = 0; rCounter = 0; }
