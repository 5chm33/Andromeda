/**
 * Long-Range Planning Engine — Monte Carlo Tree Search for 100+ cycle planning.
 * Identifies the improvement sequence most likely to reach capability targets.
 */

export interface PlanningState {
  capabilityLevels: Record<string, number>;
  cycleNumber: number;
  accumulatedReward: number;
}

export interface PlanningNode {
  id: string;
  state: PlanningState;
  action: string;
  visits: number;
  totalValue: number;
  children: PlanningNode[];
  parent?: string;
}

export interface ImprovementPlan {
  id: string;
  actions: string[];
  estimatedFinalState: PlanningState;
  expectedTotalReward: number;
  confidence: number;
  horizon: number;
}

export interface TrajectorySimulation {
  cycles: number;
  finalCapabilities: Record<string, number>;
  totalReward: number;
  reachedTargets: string[];
}

class LongRangePlannerEngine {
  private planningTree: Map<string, PlanningNode> = new Map();
  private plans: Map<string, ImprovementPlan> = new Map();
  private planCounter = 0;
  private readonly C_UCT = 1.41; // UCT exploration constant

  buildPlanningTree(currentState: PlanningState, horizon: number): PlanningNode {
    const rootId = `node-root-${Date.now()}`;
    const root: PlanningNode = {
      id: rootId,
      state: { ...currentState },
      action: "root",
      visits: 0,
      totalValue: 0,
      children: [],
    };
    this.planningTree.set(rootId, root);

    // Run MCTS iterations
    const iterations = Math.min(horizon * 10, 500);
    for (let i = 0; i < iterations; i++) {
      this._mctsIteration(root, horizon, 0);
    }

    console.log(`[Planner] Built planning tree: ${this.planningTree.size} nodes, ${iterations} MCTS iterations, horizon: ${horizon}`);
    return root;
  }

  private _mctsIteration(node: PlanningNode, maxDepth: number, depth: number): number {
    if (depth >= maxDepth) {
      return this._evaluate(node.state);
    }

    // Expand if not fully expanded
    if (node.children.length < 3) {
      const child = this._expand(node);
      const value = this._rollout(child.state, maxDepth - depth);
      this._backpropagate(child, value);
      return value;
    }

    // Select best child via UCT
    const bestChild = this._selectUCT(node);
    const value = this._mctsIteration(bestChild, maxDepth, depth + 1);
    this._backpropagate(node, value);
    return value;
  }

  private _expand(parent: PlanningNode): PlanningNode {
    const actions = ["improve_accuracy", "improve_speed", "improve_safety", "improve_generalization"];
    const action = actions[parent.children.length % actions.length];
    const newState = this._applyAction(parent.state, action);

    const childId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const child: PlanningNode = {
      id: childId,
      state: newState,
      action,
      visits: 0,
      totalValue: 0,
      children: [],
      parent: parent.id,
    };
    parent.children.push(child);
    this.planningTree.set(childId, child);
    return child;
  }

  private _applyAction(state: PlanningState, action: string): PlanningState {
    const newLevels = { ...state.capabilityLevels };
    const dim = action.replace("improve_", "");
    newLevels[dim] = Math.min(1.0, (newLevels[dim] ?? 0.9) + 0.001 + Math.random() * 0.002);
    return {
      capabilityLevels: newLevels,
      cycleNumber: state.cycleNumber + 1,
      accumulatedReward: state.accumulatedReward + (newLevels[dim] - (state.capabilityLevels[dim] ?? 0.9)),
    };
  }

  private _evaluate(state: PlanningState): number {
    const avgLevel = Object.values(state.capabilityLevels).reduce((s, v) => s + v, 0) /
      Math.max(Object.keys(state.capabilityLevels).length, 1);
    return avgLevel + state.accumulatedReward * 0.1;
  }

  private _rollout(state: PlanningState, depth: number): number {
    let current = { ...state };
    for (let i = 0; i < depth; i++) {
      const actions = ["improve_accuracy", "improve_speed", "improve_safety"];
      const action = actions[Math.floor(Math.random() * actions.length)];
      current = this._applyAction(current, action);
    }
    return this._evaluate(current);
  }

  private _backpropagate(node: PlanningNode, value: number): void {
    node.visits++;
    node.totalValue += value;
  }

  private _selectUCT(node: PlanningNode): PlanningNode {
    return node.children.reduce((best, child) => {
      const exploitation = child.visits > 0 ? child.totalValue / child.visits : 0;
      const exploration = this.C_UCT * Math.sqrt(Math.log(node.visits + 1) / (child.visits + 1));
      const uct = exploitation + exploration;
      const bestUCT = best.visits > 0 ? best.totalValue / best.visits + this.C_UCT * Math.sqrt(Math.log(node.visits + 1) / (best.visits + 1)) : 0;
      return uct > bestUCT ? child : best;
    }, node.children[0]);
  }

  simulateTrajectory(plan: ImprovementPlan, cycles: number): TrajectorySimulation {
    let state: PlanningState = {
      capabilityLevels: { accuracy: 0.9999999, speed: 0.95, safety: 0.9999999, generalization: 0.85 },
      cycleNumber: 0,
      accumulatedReward: 0,
    };

    for (let i = 0; i < cycles; i++) {
      const action = plan.actions[i % plan.actions.length];
      state = this._applyAction(state, action);
    }

    const targets = { accuracy: 1.0, speed: 0.999, safety: 1.0, generalization: 0.99 };
    const reachedTargets = Object.entries(targets)
      .filter(([dim, target]) => (state.capabilityLevels[dim] ?? 0) >= target * 0.999)
      .map(([dim]) => dim);

    return {
      cycles,
      finalCapabilities: state.capabilityLevels,
      totalReward: state.accumulatedReward,
      reachedTargets,
    };
  }

  selectOptimalPlan(tree: PlanningNode): ImprovementPlan {
    // Extract best path from root
    const actions: string[] = [];
    let current = tree;

    while (current.children.length > 0) {
      const best = current.children.reduce((a, b) =>
        (b.visits > 0 ? b.totalValue / b.visits : 0) > (a.visits > 0 ? a.totalValue / a.visits : 0) ? b : a
      );
      actions.push(best.action);
      current = best;
      if (actions.length >= 20) break;
    }

    const planId = `plan-${++this.planCounter}`;
    const plan: ImprovementPlan = {
      id: planId,
      actions,
      estimatedFinalState: current.state,
      expectedTotalReward: current.visits > 0 ? current.totalValue / current.visits : 0,
      confidence: Math.min(1, current.visits / 10),
      horizon: actions.length,
    };

    this.plans.set(planId, plan);
    return plan;
  }

  updatePlanFromObservations(actualOutcome: { action: string; reward: number }): void {
    // Update tree values based on actual observations
    for (const node of this.planningTree.values()) {
      if (node.action === actualOutcome.action) {
        node.totalValue = (node.totalValue * node.visits + actualOutcome.reward) / (node.visits + 1);
        node.visits++;
      }
    }
    console.log(`[Planner] Updated plan from observation: ${actualOutcome.action} → reward ${actualOutcome.reward.toFixed(4)}`);
  }

  getPlans(): ImprovementPlan[] {
    return Array.from(this.plans.values());
  }
}

export const globalLongRangePlanner = new LongRangePlannerEngine();

export function buildPlanningTree(currentState: PlanningState, horizon: number): PlanningNode {
  return globalLongRangePlanner.buildPlanningTree(currentState, horizon);
}

export function simulateTrajectory(plan: ImprovementPlan, cycles: number): TrajectorySimulation {
  return globalLongRangePlanner.simulateTrajectory(plan, cycles);
}

export function selectOptimalPlan(tree: PlanningNode): ImprovementPlan {
  return globalLongRangePlanner.selectOptimalPlan(tree);
}

export function updatePlanFromObservations(outcome: { action: string; reward: number }): void {
  globalLongRangePlanner.updatePlanFromObservations(outcome);
}

export function initLongRangePlanner(): void {
  console.log("[Planner] Long-Range Planning Engine initialized.");
}
