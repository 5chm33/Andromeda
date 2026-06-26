/**
 * agentEvolutionTracker.ts — v50.0.0
 *
 * Tracks the evolutionary trajectory of agents over generations,
 * measuring fitness improvements, mutation rates, and selection pressure.
 */

export interface Generation {
  generationId: number;
  agents: string[];
  avgFitness: number;
  maxFitness: number;
  minFitness: number;
  mutationRate: number;
  selectionPressure: number;
  timestamp: number;
}

export interface AgentFitnessRecord {
  agentId: string;
  fitnessHistory: number[];
  currentFitness: number;
  generationBorn: number;
  mutations: number;
}

const generations: Generation[] = [];
const fitnessRecords = new Map<string, AgentFitnessRecord>();
let currentGeneration = 0;

export function recordGeneration(
  agents: string[],
  fitnessMap: Map<string, number>,
  mutationRate: number,
  selectionPressure: number
): Generation {
  const fitnesses = agents.map(a => fitnessMap.get(a) ?? 0);
  const avg = fitnesses.reduce((s, f) => s + f, 0) / (fitnesses.length || 1);
  const max = Math.max(...fitnesses, 0);
  const min = Math.min(...fitnesses, 1);

  const gen: Generation = {
    generationId: ++currentGeneration,
    agents,
    avgFitness: avg,
    maxFitness: max,
    minFitness: min,
    mutationRate,
    selectionPressure,
    timestamp: Date.now(),
  };
  generations.push(gen);

  // Update per-agent records
  for (const agentId of agents) {
    const fitness = fitnessMap.get(agentId) ?? 0;
    const existing = fitnessRecords.get(agentId);
    if (existing) {
      existing.fitnessHistory.push(fitness);
      existing.currentFitness = fitness;
    } else {
      fitnessRecords.set(agentId, {
        agentId,
        fitnessHistory: [fitness],
        currentFitness: fitness,
        generationBorn: currentGeneration,
        mutations: 0,
      });
    }
  }

  return gen;
}

export function recordMutation(agentId: string): void {
  const record = fitnessRecords.get(agentId);
  if (record) record.mutations++;
}

export function getEvolutionTrend(): "improving" | "stagnating" | "declining" {
  if (generations.length < 3) return "stagnating";
  const recent = generations.slice(-3);
  const first = recent[0].avgFitness;
  const last = recent[recent.length - 1].avgFitness;
  const delta = last - first;
  if (delta > 0.02) return "improving";
  if (delta < -0.02) return "declining";
  return "stagnating";
}

export function getTopAgents(limit = 5): string[] {
  return Array.from(fitnessRecords.values())
    .sort((a, b) => b.currentFitness - a.currentFitness)
    .slice(0, limit)
    .map(r => r.agentId);
}

export function getGenerationHistory(): Generation[] {
  return [...generations];
}

export function _resetEvolutionTrackerForTest(): void {
  generations.length = 0;
  fitnessRecords.clear();
  currentGeneration = 0;
}
