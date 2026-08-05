/**
 * rewardCalculator.ts — v87.0.0 "Simulation & Game Theory"
 * Calculates rewards for reinforcement learning and game-theoretic agents.
 */
export type RewardType = "sparse" | "dense" | "shaped" | "terminal";

export interface RewardSignal {
  signalId: string;
  agentId: string;
  stateId: string;
  actionId: string;
  rewardType: RewardType;
  rawReward: number;
  shapedReward: number;
  discount: number;
  discountedReward: number;
  timestamp: number;
}

export interface RewardFunction {
  functionId: string;
  name: string;
  type: RewardType;
  weights: Record<string, number>;
  discount: number;
}

const rewardFunctions = new Map<string, RewardFunction>();
const rewardHistory: RewardSignal[] = [];
let fnCounter = 0;
let sigCounter = 0;

export function defineRewardFunction(name: string, type: RewardType, weights: Record<string, number>, discount = 0.99): RewardFunction {
  const fn: RewardFunction = { functionId: `rf-${++fnCounter}`, name, type, weights, discount };
  rewardFunctions.set(fn.functionId, fn);
  return fn;
}

export function calculateReward(functionId: string, agentId: string, stateId: string, actionId: string, features: Record<string, number>): RewardSignal | null {
  const fn = rewardFunctions.get(functionId);
  if (!fn) return null;

  const rawReward = Object.entries(fn.weights).reduce((sum, [key, weight]) => sum + (features[key] ?? 0) * weight, 0);
  const shapedReward = rawReward + (features["potential_next"] ?? 0) * fn.discount - (features["potential_current"] ?? 0);
  const discountedReward = rawReward * fn.discount;

  const signal: RewardSignal = {
    signalId: `sig-${++sigCounter}`,
    agentId, stateId, actionId,
    rewardType: fn.type,
    rawReward, shapedReward, discount: fn.discount, discountedReward,
    timestamp: Date.now(),
  };
  rewardHistory.push(signal);
  return signal;
}

export function getCumulativeReward(agentId: string): number {
  return rewardHistory.filter(s => s.agentId === agentId).reduce((sum, s) => sum + s.rawReward, 0);
}

export function getAverageReward(agentId: string): number {
  const signals = rewardHistory.filter(s => s.agentId === agentId);
  if (signals.length === 0) return 0;
  return signals.reduce((sum, s) => sum + s.rawReward, 0) / signals.length;
}

export function getRewardHistory(agentId?: string): RewardSignal[] {
  return agentId ? rewardHistory.filter(s => s.agentId === agentId) : [...rewardHistory];
}

export function _resetRewardCalculatorForTest(): void { rewardFunctions.clear(); rewardHistory.length = 0; fnCounter = 0; sigCounter = 0; }
