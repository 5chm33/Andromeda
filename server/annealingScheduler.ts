/**
 * annealingScheduler.ts — v96.0.0 "Quantum-Inspired Optimization"
 * Simulated annealing scheduler for combinatorial optimization problems.
 */
export type CoolingSchedule = "linear" | "exponential" | "logarithmic" | "adaptive";

export interface AnnealingConfig {
  initialTemperature: number;
  finalTemperature: number;
  coolingSchedule: CoolingSchedule;
  maxIterations: number;
  coolingRate: number;
}

export interface AnnealingState {
  sessionId: string;
  iteration: number;
  currentTemperature: number;
  currentEnergy: number;
  bestEnergy: number;
  bestSolution: unknown;
  acceptanceRate: number;
  totalAccepted: number;
  totalRejected: number;
  converged: boolean;
}

const sessions = new Map<string, AnnealingState>();
const configs = new Map<string, AnnealingConfig>();
let sessionCounter = 0;

export function createSession(config: AnnealingConfig): AnnealingState {
  const sessionId = `ann-${++sessionCounter}`;
  configs.set(sessionId, config);
  const state: AnnealingState = { sessionId, iteration: 0, currentTemperature: config.initialTemperature, currentEnergy: Infinity, bestEnergy: Infinity, bestSolution: null, acceptanceRate: 1.0, totalAccepted: 0, totalRejected: 0, converged: false };
  sessions.set(sessionId, state);
  return state;
}

export function step(sessionId: string, newEnergy: number, newSolution: unknown): { accepted: boolean; state: AnnealingState } {
  const state = sessions.get(sessionId);
  const config = configs.get(sessionId);
  if (!state || !config) return { accepted: false, state: state! };

  const deltaE = newEnergy - state.currentEnergy;
  let accepted = false;

  if (deltaE < 0) {
    accepted = true;
  } else if (state.currentTemperature > 0) {
    const probability = Math.exp(-deltaE / state.currentTemperature);
    accepted = Math.random() < probability;
  }

  if (accepted) {
    state.currentEnergy = newEnergy;
    state.totalAccepted++;
    if (newEnergy < state.bestEnergy) { state.bestEnergy = newEnergy; state.bestSolution = newSolution; }
  } else {
    state.totalRejected++;
  }

  // Cool temperature
  state.iteration++;
  switch (config.coolingSchedule) {
    case "exponential": state.currentTemperature *= config.coolingRate; break;
    case "linear": state.currentTemperature -= (config.initialTemperature - config.finalTemperature) / config.maxIterations; break;
    case "logarithmic": state.currentTemperature = config.initialTemperature / Math.log(state.iteration + 2); break;
    case "adaptive": state.currentTemperature *= state.totalAccepted > state.totalRejected ? 0.99 : 0.95; break;
  }

  const total = state.totalAccepted + state.totalRejected;
  state.acceptanceRate = total > 0 ? state.totalAccepted / total : 1.0;
  state.converged = state.currentTemperature <= config.finalTemperature || state.iteration >= config.maxIterations;
  return { accepted, state };
}

export function getSession(sessionId: string): AnnealingState | undefined { return sessions.get(sessionId); }
export function _resetAnnealingSchedulerForTest(): void { sessions.clear(); configs.clear(); sessionCounter = 0; }
