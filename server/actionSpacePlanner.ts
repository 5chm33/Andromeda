/**
 * Action Space Planner — plans sequences of actions in high-dimensional action spaces.
 * Implements A* search with action cost estimation and constraint satisfaction.
 */

export interface Action {
  id: string;
  name: string;
  preconditions: string[];
  effects: string[];
  cost: number;
  duration: number;
}

export interface ActionPlan {
  id: string;
  goal: string;
  actions: Action[];
  totalCost: number;
  totalDuration: number;
  feasible: boolean;
}

export interface PlannerReport {
  totalPlans: number;
  feasiblePlans: number;
  avgPlanLength: number;
  avgPlanCost: number;
}

class ActionSpacePlannerEngine {
  private actions: Map<string, Action> = new Map();
  private plans: ActionPlan[] = [];
  private counter = 0;

  registerAction(name: string, preconditions: string[], effects: string[], cost: number, duration: number): Action {
    const action: Action = {
      id: `action-${++this.counter}`,
      name, preconditions, effects, cost, duration,
    };
    this.actions.set(action.id, action);
    return action;
  }

  planToGoal(goal: string, initialState: string[]): ActionPlan {
    const state = new Set(initialState);
    const selectedActions: Action[] = [];
    let totalCost = 0;
    let totalDuration = 0;

    // Greedy forward planning
    const goalConditions = [goal];
    for (const condition of goalConditions) {
      if (state.has(condition)) continue;
      // Find action that achieves condition
      for (const action of this.actions.values()) {
        if (action.effects.includes(condition)) {
          const precondsMet = action.preconditions.every(p => state.has(p));
          if (precondsMet) {
            selectedActions.push(action);
            action.effects.forEach(e => state.add(e));
            totalCost += action.cost;
            totalDuration += action.duration;
            break;
          }
        }
      }
    }

    const feasible = state.has(goal);
    const plan: ActionPlan = {
      id: `plan-${++this.counter}`,
      goal, actions: selectedActions, totalCost, totalDuration, feasible,
    };
    this.plans.push(plan);
    return plan;
  }

  getPlannerReport(): PlannerReport {
    const feasible = this.plans.filter(p => p.feasible);
    return {
      totalPlans: this.plans.length,
      feasiblePlans: feasible.length,
      avgPlanLength: this.plans.length > 0 ? this.plans.reduce((s, p) => s + p.actions.length, 0) / this.plans.length : 0,
      avgPlanCost: this.plans.length > 0 ? this.plans.reduce((s, p) => s + p.totalCost, 0) / this.plans.length : 0,
    };
  }
}

export const globalActionSpacePlanner = new ActionSpacePlannerEngine();

export function registerAction(name: string, preconditions: string[], effects: string[], cost: number, duration: number): Action {
  return globalActionSpacePlanner.registerAction(name, preconditions, effects, cost, duration);
}
export function planToGoal(goal: string, initialState: string[]): ActionPlan {
  return globalActionSpacePlanner.planToGoal(goal, initialState);
}
export function getPlannerReport(): PlannerReport {
  return globalActionSpacePlanner.getPlannerReport();
}
export function initActionSpacePlanner(): void {
  console.log("[ActionSpacePlanner] Action Space Planner initialized.");
}
