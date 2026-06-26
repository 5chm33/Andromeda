/**
 * Infinite Horizon Planner — value iteration for unbounded improvement planning.
 * Optimizes improvement strategy over an infinite time horizon with discount factor.
 */

export interface IHState {
  capabilityLevels: Record<string, number>;
  cycleNumber: number;
}

export interface IHValueFunction {
  states: Map<string, number>;
  discountFactor: number;
  iterations: number;
  converged: boolean;
  convergenceError: number;
}

export interface IHPolicy {
  id: string;
  actionMap: Map<string, string>;  // state hash → best action
  expectedReturn: number;
  derivedAt: number;
}

export interface IHSimulation {
  cycles: number;
  trajectory: Array<{ state: IHState; action: string; reward: number }>;
  totalDiscountedReturn: number;
  finalCapabilities: Record<string, number>;
}

class InfiniteHorizonPlannerEngine {
  private valueFunction: IHValueFunction | null = null;
  private policies: Map<string, IHPolicy> = new Map();
  private policyCounter = 0;

  private readonly ACTIONS = ["improve_accuracy", "improve_speed", "improve_safety", "improve_generalization", "improve_reasoning"];
  private readonly CONVERGENCE_THRESHOLD = 1e-6;
  private readonly MAX_ITERATIONS = 100;

  computeValueFunction(state: IHState, discountFactor = 0.99): IHValueFunction {
    const valueMap = new Map<string, number>();
    let iterations = 0;
    let converged = false;
    let convergenceError = Infinity;

    // Initialize value function
    const stateHash = this._hashState(state);
    valueMap.set(stateHash, this._immediateReward(state));

    // Value iteration
    for (let iter = 0; iter < this.MAX_ITERATIONS; iter++) {
      iterations++;
      let maxDelta = 0;

      // For each action, compute Bellman update
      for (const action of this.ACTIONS) {
        const nextState = this._transition(state, action);
        const nextHash = this._hashState(nextState);
        const reward = this._immediateReward(nextState);
        const nextValue = valueMap.get(nextHash) ?? 0;
        const newValue = reward + discountFactor * nextValue;
        const oldValue = valueMap.get(stateHash) ?? 0;
        const delta = Math.abs(newValue - oldValue);
        if (delta > maxDelta) maxDelta = delta;
        if (newValue > oldValue) {
          valueMap.set(stateHash, newValue);
        }
      }

      convergenceError = maxDelta;
      if (maxDelta < this.CONVERGENCE_THRESHOLD) {
        converged = true;
        break;
      }
    }

    this.valueFunction = { states: valueMap, discountFactor, iterations, converged, convergenceError };
    console.log(`[IHPlanner] Value function computed: ${iterations} iterations, converged: ${converged}, error: ${convergenceError.toExponential(2)}`);
    return this.valueFunction;
  }

  deriveOptimalPolicy(valueFunction: IHValueFunction): IHPolicy {
    const actionMap = new Map<string, string>();

    // For each known state, find the best action
    for (const [stateHash] of valueFunction.states) {
      let bestAction = this.ACTIONS[0];
      let bestValue = -Infinity;

      for (const action of this.ACTIONS) {
        // Simulate applying action and compute expected value
        const reward = this._rewardForAction(action);
        const value = reward + valueFunction.discountFactor * (valueFunction.states.get(stateHash) ?? 0);
        if (value > bestValue) {
          bestValue = value;
          bestAction = action;
        }
      }
      actionMap.set(stateHash, bestAction);
    }

    const policy: IHPolicy = {
      id: `policy-${++this.policyCounter}`,
      actionMap,
      expectedReturn: Array.from(valueFunction.states.values()).reduce((s, v) => s + v, 0) / Math.max(valueFunction.states.size, 1),
      derivedAt: Date.now(),
    };

    this.policies.set(policy.id, policy);
    return policy;
  }

  simulateInfiniteHorizon(policy: IHPolicy, cycles: number, discountFactor = 0.99): IHSimulation {
    let state: IHState = {
      capabilityLevels: { accuracy: 0.9999999, speed: 0.95, safety: 0.9999999, generalization: 0.85 },
      cycleNumber: 0,
    };

    const trajectory: IHSimulation["trajectory"] = [];
    let totalDiscountedReturn = 0;

    for (let i = 0; i < cycles; i++) {
      const stateHash = this._hashState(state);
      const action = policy.actionMap.get(stateHash) ?? this.ACTIONS[i % this.ACTIONS.length];
      const reward = this._rewardForAction(action);
      totalDiscountedReturn += reward * Math.pow(discountFactor, i);
      trajectory.push({ state: { ...state }, action, reward });
      state = this._transition(state, action);
      state.cycleNumber = i + 1;
    }

    return {
      cycles,
      trajectory,
      totalDiscountedReturn,
      finalCapabilities: state.capabilityLevels,
    };
  }

  updateValueEstimates(observations: Array<{ state: IHState; reward: number }>): void {
    if (!this.valueFunction) return;
    for (const obs of observations) {
      const hash = this._hashState(obs.state);
      const current = this.valueFunction.states.get(hash) ?? 0;
      // Online update: exponential moving average
      this.valueFunction.states.set(hash, current * 0.9 + obs.reward * 0.1);
    }
    console.log(`[IHPlanner] Updated value estimates from ${observations.length} observations`);
  }

  private _hashState(state: IHState): string {
    const levels = Object.entries(state.capabilityLevels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v.toFixed(3)}`)
      .join(",");
    return levels;
  }

  private _immediateReward(state: IHState): number {
    const levels = Object.values(state.capabilityLevels);
    return levels.reduce((s, v) => s + v, 0) / Math.max(levels.length, 1);
  }

  private _rewardForAction(action: string): number {
    const rewards: Record<string, number> = {
      improve_accuracy: 0.001,
      improve_speed: 0.0008,
      improve_safety: 0.0012,
      improve_generalization: 0.0009,
      improve_reasoning: 0.0011,
    };
    return rewards[action] ?? 0.001;
  }

  private _transition(state: IHState, action: string): IHState {
    const dim = action.replace("improve_", "");
    const newLevels = { ...state.capabilityLevels };
    newLevels[dim] = Math.min(1.0, (newLevels[dim] ?? 0.9) + 0.001);
    return { capabilityLevels: newLevels, cycleNumber: state.cycleNumber + 1 };
  }

  getPolicies(): IHPolicy[] {
    return Array.from(this.policies.values());
  }
}

export const globalInfiniteHorizonPlanner = new InfiniteHorizonPlannerEngine();

export function computeValueFunction(state: IHState, discountFactor?: number): IHValueFunction {
  return globalInfiniteHorizonPlanner.computeValueFunction(state, discountFactor);
}

export function deriveOptimalPolicy(valueFunction: IHValueFunction): IHPolicy {
  return globalInfiniteHorizonPlanner.deriveOptimalPolicy(valueFunction);
}

export function simulateInfiniteHorizon(policy: IHPolicy, cycles: number, discountFactor?: number): IHSimulation {
  return globalInfiniteHorizonPlanner.simulateInfiniteHorizon(policy, cycles, discountFactor);
}

export function updateValueEstimates(observations: Array<{ state: IHState; reward: number }>): void {
  globalInfiniteHorizonPlanner.updateValueEstimates(observations);
}

export function initInfiniteHorizonPlanner(): void {
  console.log("[IHPlanner] Infinite Horizon Planner initialized.");
  const initialState: IHState = {
    capabilityLevels: { accuracy: 0.9999999, speed: 0.95, safety: 0.9999999, generalization: 0.85 },
    cycleNumber: 0,
  };
  const vf = globalInfiniteHorizonPlanner.computeValueFunction(initialState);
  globalInfiniteHorizonPlanner.deriveOptimalPolicy(vf);
}
