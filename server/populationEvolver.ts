/**
 * populationEvolver.ts — v96.0.0 "Quantum-Inspired Optimization"
 * Evolutionary algorithm engine for population-based optimization.
 */
export interface Individual {
  id: string;
  genes: number[];
  fitness: number;
  generation: number;
}

export interface EvolutionConfig {
  populationSize: number;
  mutationRate: number;
  crossoverRate: number;
  elitismCount: number;
  maxGenerations: number;
}

export interface EvolutionState {
  stateId: string;
  generation: number;
  population: Individual[];
  bestIndividual: Individual | null;
  averageFitness: number;
  diversityScore: number;
  converged: boolean;
}

const states = new Map<string, EvolutionState>();
const evoConfigs = new Map<string, EvolutionConfig>();
let stateCounter = 0;
let individualCounter = 0;

export function initializePopulation(config: EvolutionConfig, geneLength: number, fitnessFunction: (genes: number[]) => number): EvolutionState {
  const stateId = `evo-${++stateCounter}`;
  evoConfigs.set(stateId, config);
  const population: Individual[] = [];
  for (let i = 0; i < config.populationSize; i++) {
    const genes = Array.from({ length: geneLength }, () => Math.random());
    population.push({ id: `ind-${++individualCounter}`, genes, fitness: fitnessFunction(genes), generation: 0 });
  }
  population.sort((a, b) => b.fitness - a.fitness);
  const avgFitness = population.reduce((s, ind) => s + ind.fitness, 0) / population.length;
  const state: EvolutionState = { stateId, generation: 0, population, bestIndividual: population[0], averageFitness: avgFitness, diversityScore: 1.0, converged: false };
  states.set(stateId, state);
  return state;
}

export function evolveGeneration(stateId: string, fitnessFunction: (genes: number[]) => number): EvolutionState | null {
  const state = states.get(stateId);
  const config = evoConfigs.get(stateId);
  if (!state || !config) return null;

  const newPopulation: Individual[] = [];

  // Elitism
  for (let i = 0; i < config.elitismCount && i < state.population.length; i++) {
    newPopulation.push({ ...state.population[i], generation: state.generation + 1 });
  }

  while (newPopulation.length < config.populationSize) {
    // Tournament selection
    const parent1 = state.population[Math.floor(Math.random() * Math.min(5, state.population.length))];
    const parent2 = state.population[Math.floor(Math.random() * Math.min(5, state.population.length))];

    // Crossover
    let childGenes = parent1.genes.map((g, i) => Math.random() < config.crossoverRate ? g : parent2.genes[i]);

    // Mutation
    childGenes = childGenes.map(g => Math.random() < config.mutationRate ? g + (Math.random() - 0.5) * 0.2 : g);
    childGenes = childGenes.map(g => Math.max(0, Math.min(1, g)));

    newPopulation.push({ id: `ind-${++individualCounter}`, genes: childGenes, fitness: fitnessFunction(childGenes), generation: state.generation + 1 });
  }

  newPopulation.sort((a, b) => b.fitness - a.fitness);
  state.population = newPopulation;
  state.generation++;
  state.bestIndividual = newPopulation[0];
  state.averageFitness = newPopulation.reduce((s, ind) => s + ind.fitness, 0) / newPopulation.length;
  state.converged = state.generation >= config.maxGenerations;
  return state;
}

export function getState(stateId: string): EvolutionState | undefined { return states.get(stateId); }
export function _resetPopulationEvolverForTest(): void { states.clear(); evoConfigs.clear(); stateCounter = 0; individualCounter = 0; }
