/**
 * nasEngine.ts — v21.0.0
 * 
 * Self-Modifying Architecture Search (NAS).
 * Evolutionary search over RSI hyperparameters to find the optimal configuration.
 */

import * as fs from "fs";
import * as path from "path";

export interface RSIHyperparameters {
  debateRounds: number;
  critiquePasses: number;
  concurrencyLevel: number;
  temperature: number;
  fitnessScore: number;
}

function getNasFile(): string {
  return path.join(process.cwd(), "rsi_hyperparameters.json");
}

const DEFAULT_PARAMS: RSIHyperparameters = {
  debateRounds: 3,
  critiquePasses: 1,
  concurrencyLevel: 8,
  temperature: 0.7,
  fitnessScore: 0
};

export function initNasEngine(): void {
  const file = getNasFile();
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify([DEFAULT_PARAMS], null, 2));
  }
}

export function getActiveHyperparameters(): RSIHyperparameters {
  initNasEngine();
  try {
    const history = JSON.parse(fs.readFileSync(getNasFile(), "utf-8")) as RSIHyperparameters[];
    // Return the one with the highest fitness, or the most recent if fitness is equal
    return history.sort((a, b) => b.fitnessScore - a.fitnessScore)[0] || DEFAULT_PARAMS;
  } catch {
    return DEFAULT_PARAMS;
  }
}

/**
 * Records the fitness of the current configuration (e.g., acceptance rate of the cycle).
 */
export function recordFitness(fitness: number): void {
  const file = getNasFile();
  const history = JSON.parse(fs.readFileSync(file, "utf-8")) as RSIHyperparameters[];
  const active = history[history.length - 1];
  active.fitnessScore = fitness;
  fs.writeFileSync(file, JSON.stringify(history, null, 2));
}

/**
 * Mutates the best configuration to explore the hyperparameter space.
 */
export function mutateHyperparameters(): RSIHyperparameters {
  const best = getActiveHyperparameters();
  
  const mutated: RSIHyperparameters = {
    debateRounds: Math.max(1, best.debateRounds + (Math.random() > 0.5 ? 1 : -1)),
    critiquePasses: Math.max(0, best.critiquePasses + (Math.random() > 0.5 ? 1 : -1)),
    concurrencyLevel: Math.max(2, Math.min(16, best.concurrencyLevel + (Math.random() > 0.5 ? 2 : -2))),
    temperature: Math.max(0.1, Math.min(1.0, best.temperature + (Math.random() * 0.2 - 0.1))),
    fitnessScore: 0
  };

  const file = getNasFile();
  const history = JSON.parse(fs.readFileSync(file, "utf-8")) as RSIHyperparameters[];
  history.push(mutated);
  fs.writeFileSync(file, JSON.stringify(history, null, 2));

  return mutated;
}
