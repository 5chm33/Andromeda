/**
 * environmentModel.ts — v87.0.0 "Simulation & Game Theory"
 * Models environment dynamics with state transitions, observations, and rewards.
 */
export interface EnvState {
  stateId: string;
  features: Record<string, number>;
  isTerminal: boolean;
  label: string;
}

export interface Transition {
  fromStateId: string;
  action: string;
  toStateId: string;
  probability: number;
  reward: number;
}

export interface EnvObservation {
  stateId: string;
  features: Record<string, number>;
  availableActions: string[];
  reward: number;
  isTerminal: boolean;
  stepNumber: number;
}

export interface EnvironmentModel {
  envId: string;
  name: string;
  states: Map<string, EnvState>;
  transitions: Transition[];
  currentStateId: string;
  stepCount: number;
  totalReward: number;
}

const environments = new Map<string, EnvironmentModel>();
let envCounter = 0;

export function createEnvironment(name: string): EnvironmentModel {
  const env: EnvironmentModel = {
    envId: `env-${++envCounter}`,
    name,
    states: new Map(),
    transitions: [],
    currentStateId: "",
    stepCount: 0,
    totalReward: 0,
  };
  environments.set(env.envId, env);
  return env;
}

export function addState(envId: string, stateId: string, features: Record<string, number>, isTerminal = false, label = ""): EnvState | null {
  const env = environments.get(envId);
  if (!env) return null;
  const state: EnvState = { stateId, features, isTerminal, label };
  env.states.set(stateId, state);
  if (!env.currentStateId) env.currentStateId = stateId;
  return state;
}

export function addTransition(envId: string, fromStateId: string, action: string, toStateId: string, probability: number, reward: number): boolean {
  const env = environments.get(envId);
  if (!env) return false;
  env.transitions.push({ fromStateId, action, toStateId, probability, reward });
  return true;
}

export function step(envId: string, action: string): EnvObservation | null {
  const env = environments.get(envId);
  if (!env) return null;

  const possible = env.transitions.filter(t => t.fromStateId === env.currentStateId && t.action === action);
  if (possible.length === 0) return null;

  // Sample based on probability
  const rand = Math.random();
  let cumulative = 0;
  let chosen = possible[0];
  for (const t of possible) {
    cumulative += t.probability;
    if (rand <= cumulative) { chosen = t; break; }
  }

  env.currentStateId = chosen.toStateId;
  env.stepCount++;
  env.totalReward += chosen.reward;

  const nextState = env.states.get(chosen.toStateId)!;
  const availableActions = [...new Set(env.transitions.filter(t => t.fromStateId === chosen.toStateId).map(t => t.action))];

  return { stateId: chosen.toStateId, features: nextState.features, availableActions, reward: chosen.reward, isTerminal: nextState.isTerminal, stepNumber: env.stepCount };
}

export function reset(envId: string, initialStateId?: string): EnvObservation | null {
  const env = environments.get(envId);
  if (!env) return null;
  env.currentStateId = initialStateId ?? [...env.states.keys()][0] ?? "";
  env.stepCount = 0;
  env.totalReward = 0;
  const state = env.states.get(env.currentStateId);
  if (!state) return null;
  const availableActions = [...new Set(env.transitions.filter(t => t.fromStateId === env.currentStateId).map(t => t.action))];
  return { stateId: env.currentStateId, features: state.features, availableActions, reward: 0, isTerminal: state.isTerminal, stepNumber: 0 };
}

export function getEnvironment(envId: string): EnvironmentModel | undefined { return environments.get(envId); }
export function _resetEnvironmentModelForTest(): void { environments.clear(); envCounter = 0; }
