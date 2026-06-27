import { createLogger } from "./logger.js";
const log = createLogger("RolloutController");
/**
 * rolloutController.ts — v77.0.0 "Feature Flags & Experimentation"
 * Controls phased feature rollouts with configurable stages and pause/resume capabilities.
 */
export type RolloutStageStatus = "pending" | "active" | "completed" | "paused" | "failed";

export interface RolloutStage {
  stageId: string;
  name: string;
  targetPercent: number;
  durationMinutes: number;
  status: RolloutStageStatus;
  startedAt: number | null;
  completedAt: number | null;
}

export interface RolloutPlan {
  planId: string;
  featureName: string;
  stages: RolloutStage[];
  currentStageIndex: number;
  paused: boolean;
  createdAt: number;
}

const plans = new Map<string, RolloutPlan>();
let planCounter = 0;
let stageCounter = 0;

export function createRolloutPlan(featureName: string, stageConfigs: Array<{ name: string; targetPercent: number; durationMinutes: number }>): RolloutPlan {
  const stages: RolloutStage[] = stageConfigs.map(cfg => ({
    stageId: `stage-${++stageCounter}`,
    name: cfg.name,
    targetPercent: cfg.targetPercent,
    durationMinutes: cfg.durationMinutes,
    status: "pending",
    startedAt: null,
    completedAt: null,
  }));

  const plan: RolloutPlan = {
    planId: `rollout-${++planCounter}`,
    featureName, stages, currentStageIndex: 0, paused: false, createdAt: Date.now(),
  };
  plans.set(plan.planId, plan);
  log.info(`[RolloutController] Created rollout plan for "${featureName}" with ${stages.length} stages`);
  return plan;
}

export function advanceRollout(planId: string): { advanced: boolean; stage: RolloutStage | null } {
  const plan = plans.get(planId);
  if (!plan || plan.paused) return { advanced: false, stage: null };

  const current = plan.stages[plan.currentStageIndex];
  if (!current) return { advanced: false, stage: null };

  if (current.status === "pending") {
    current.status = "active";
    current.startedAt = Date.now();
    return { advanced: true, stage: current };
  }

  if (current.status === "active") {
    current.status = "completed";
    current.completedAt = Date.now();
    plan.currentStageIndex++;
    const next = plan.stages[plan.currentStageIndex];
    if (next) { next.status = "active"; next.startedAt = Date.now(); return { advanced: true, stage: next }; }
  }

  return { advanced: false, stage: current };
}

export function pauseRollout(planId: string): boolean {
  const plan = plans.get(planId);
  if (!plan) return false;
  plan.paused = true;
  return true;
}

export function resumeRollout(planId: string): boolean {
  const plan = plans.get(planId);
  if (!plan) return false;
  plan.paused = false;
  return true;
}

export function getRolloutPlan(planId: string): RolloutPlan | undefined { return plans.get(planId); }
export function getAllRolloutPlans(): RolloutPlan[] { return [...plans.values()]; }
export function _resetRolloutControllerForTest(): void { plans.clear(); planCounter = 0; stageCounter = 0; }
