/**
 * Temporal Abstraction Engine — multi-timescale planning and execution.
 * Operates simultaneously at second, minute, hour, and day timescales,
 * ensuring consistency across temporal horizons.
 */

export type Timescale = "second" | "minute" | "hour" | "day";

export interface TemporalPlan {
  id: string;
  timescale: Timescale;
  goal: string;
  actions: string[];
  startTime: number;
  endTime: number;
  priority: number;
  status: "active" | "completed" | "paused" | "conflict";
}

export interface TemporalConflict {
  planA: string;
  planB: string;
  conflictType: "resource" | "objective" | "timing";
  description: string;
  resolution: string;
}

export interface MultiTimescalePlan {
  id: string;
  secondPlan: TemporalPlan;
  minutePlan: TemporalPlan;
  hourPlan: TemporalPlan;
  dayPlan: TemporalPlan;
  conflicts: TemporalConflict[];
  alignmentScore: number;
}

const TIMESCALE_HORIZONS: Record<Timescale, number> = {
  second: 1000,
  minute: 60000,
  hour: 3600000,
  day: 86400000,
};

class TemporalAbstractionEngine {
  private plans: Map<string, TemporalPlan> = new Map();
  private multiScalePlans: Map<string, MultiTimescalePlan> = new Map();
  private planCounter = 0;

  planAtTimescale(timescale: Timescale, goal: string): TemporalPlan {
    const horizon = TIMESCALE_HORIZONS[timescale];
    const actionsByTimescale: Record<Timescale, string[]> = {
      second: ["evaluate_proposal", "run_reward_model", "apply_improvement"],
      minute: ["run_improvement_cycle", "update_capability_metrics", "checkpoint_state"],
      hour: ["run_curriculum_cycle", "rebalance_compute_budget", "generate_stakeholder_report"],
      day: ["synthesize_new_goals", "distill_knowledge_crystal", "update_long_range_plan"],
    };

    const plan: TemporalPlan = {
      id: `plan-${timescale}-${++this.planCounter}`,
      timescale,
      goal,
      actions: actionsByTimescale[timescale],
      startTime: Date.now(),
      endTime: Date.now() + horizon,
      priority: timescale === "second" ? 1.0 : timescale === "minute" ? 0.8 : timescale === "hour" ? 0.6 : 0.4,
      status: "active",
    };

    this.plans.set(plan.id, plan);
    return plan;
  }

  alignTimescales(plans: TemporalPlan[]): TemporalPlan[] {
    // Ensure higher-level plans inform lower-level ones
    const dayPlan = plans.find(p => p.timescale === "day");
    const hourPlan = plans.find(p => p.timescale === "hour");
    const minutePlan = plans.find(p => p.timescale === "minute");
    const secondPlan = plans.find(p => p.timescale === "second");

    // Propagate goals downward
    if (dayPlan && hourPlan) {
      hourPlan.goal = `${hourPlan.goal} (aligned with: ${dayPlan.goal})`;
    }
    if (hourPlan && minutePlan) {
      minutePlan.goal = `${minutePlan.goal} (aligned with: ${hourPlan.goal.split(" (")[0]})`;
    }
    if (minutePlan && secondPlan) {
      secondPlan.goal = `${secondPlan.goal} (aligned with: ${minutePlan.goal.split(" (")[0]})`;
    }

    return plans;
  }

  detectTemporalConflict(plans: TemporalPlan[]): TemporalConflict[] {
    const conflicts: TemporalConflict[] = [];

    for (let i = 0; i < plans.length; i++) {
      for (let j = i + 1; j < plans.length; j++) {
        const a = plans[i];
        const b = plans[j];

        // Check for objective conflicts
        if (a.goal.includes("reduce") && b.goal.includes("increase")) {
          conflicts.push({
            planA: a.id,
            planB: b.id,
            conflictType: "objective",
            description: `${a.timescale} plan wants to reduce while ${b.timescale} plan wants to increase`,
            resolution: "Defer to higher-timescale plan",
          });
        }

        // Check for timing conflicts (overlapping critical actions)
        const aActions = new Set(a.actions);
        const bActions = new Set(b.actions);
        const overlap = [...aActions].filter(x => bActions.has(x));
        if (overlap.length > 0 && a.timescale !== b.timescale) {
          conflicts.push({
            planA: a.id,
            planB: b.id,
            conflictType: "timing",
            description: `Overlapping actions: ${overlap.join(", ")}`,
            resolution: "Serialize actions by timescale priority",
          });
        }
      }
    }

    return conflicts;
  }

  synthesizeMultiTimescalePlan(goals: Record<Timescale, string>): MultiTimescalePlan {
    const secondPlan = this.planAtTimescale("second", goals.second);
    const minutePlan = this.planAtTimescale("minute", goals.minute);
    const hourPlan = this.planAtTimescale("hour", goals.hour);
    const dayPlan = this.planAtTimescale("day", goals.day);

    const allPlans = [secondPlan, minutePlan, hourPlan, dayPlan];
    this.alignTimescales(allPlans);
    const conflicts = this.detectTemporalConflict(allPlans);

    const alignmentScore = Math.max(0, 1 - conflicts.length * 0.1);

    const multiPlan: MultiTimescalePlan = {
      id: `multi-${Date.now()}`,
      secondPlan,
      minutePlan,
      hourPlan,
      dayPlan,
      conflicts,
      alignmentScore,
    };

    this.multiScalePlans.set(multiPlan.id, multiPlan);
    console.log(`[Temporal] Multi-timescale plan created: ${conflicts.length} conflicts, alignment score: ${alignmentScore.toFixed(2)}`);
    return multiPlan;
  }

  getActivePlans(): TemporalPlan[] {
    return Array.from(this.plans.values()).filter(p => p.status === "active");
  }
}

export const globalTemporalAbstractionEngine = new TemporalAbstractionEngine();

export function planAtTimescale(timescale: Timescale, goal: string): TemporalPlan {
  return globalTemporalAbstractionEngine.planAtTimescale(timescale, goal);
}

export function alignTimescales(plans: TemporalPlan[]): TemporalPlan[] {
  return globalTemporalAbstractionEngine.alignTimescales(plans);
}

export function detectTemporalConflict(plans: TemporalPlan[]): TemporalConflict[] {
  return globalTemporalAbstractionEngine.detectTemporalConflict(plans);
}

export function synthesizeMultiTimescalePlan(goals: Record<Timescale, string>): MultiTimescalePlan {
  return globalTemporalAbstractionEngine.synthesizeMultiTimescalePlan(goals);
}

export function initTemporalAbstractionEngine(): void {
  console.log("[Temporal] Temporal Abstraction Engine initialized.");
  // Seed with default multi-timescale plan
  globalTemporalAbstractionEngine.synthesizeMultiTimescalePlan({
    second: "Evaluate and apply next improvement proposal",
    minute: "Complete one full RSI improvement cycle",
    hour: "Advance capability metrics toward daily targets",
    day: "Make measurable progress toward omega-level convergence",
  });
}
