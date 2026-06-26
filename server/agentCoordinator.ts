/**
 * agentCoordinator.ts — v47.0.0
 *
 * High-level coordinator that orchestrates multi-agent workflows,
 * resolves capability gaps, and manages parallel execution pipelines.
 */

export interface CoordinationPlan {
  planId: string;
  goalDescription: string;
  steps: CoordinationStep[];
  status: "pending" | "executing" | "completed" | "failed";
  createdAt: number;
  completedAt?: number;
}

export interface CoordinationStep {
  stepId: string;
  description: string;
  requiredCapabilities: string[];
  assignedAgentId?: string;
  dependsOn: string[];    // stepIds that must complete first
  status: "waiting" | "ready" | "executing" | "completed" | "failed";
  result?: unknown;
}

const plans = new Map<string, CoordinationPlan>();
let planCounter = 0;
let stepCounter = 0;

export function createPlan(goalDescription: string): CoordinationPlan {
  const plan: CoordinationPlan = {
    planId: `plan-${++planCounter}-${Date.now()}`,
    goalDescription,
    steps: [],
    status: "pending",
    createdAt: Date.now(),
  };
  plans.set(plan.planId, plan);
  return plan;
}

export function addStep(
  planId: string,
  description: string,
  requiredCapabilities: string[],
  dependsOn: string[] = []
): CoordinationStep | null {
  const plan = plans.get(planId);
  if (!plan) return null;

  const step: CoordinationStep = {
    stepId: `step-${++stepCounter}`,
    description,
    requiredCapabilities,
    dependsOn,
    status: dependsOn.length === 0 ? "ready" : "waiting",
  };
  plan.steps.push(step);
  return step;
}

export function assignStep(planId: string, stepId: string, agentId: string): boolean {
  const plan = plans.get(planId);
  const step = plan?.steps.find(s => s.stepId === stepId);
  if (!step || step.status !== "ready") return false;
  step.assignedAgentId = agentId;
  step.status = "executing";
  if (plan!.status === "pending") plan!.status = "executing";
  return true;
}

export function completeStep(planId: string, stepId: string, result: unknown, success: boolean): void {
  const plan = plans.get(planId);
  if (!plan) return;

  const step = plan.steps.find(s => s.stepId === stepId);
  if (!step) return;

  step.status = success ? "completed" : "failed";
  step.result = result;

  if (!success) {
    plan.status = "failed";
    plan.completedAt = Date.now();
    return;
  }

  // Unlock dependent steps
  for (const s of plan.steps) {
    if (s.status === "waiting" && s.dependsOn.every(dep => {
      const depStep = plan.steps.find(x => x.stepId === dep);
      return depStep?.status === "completed";
    })) {
      s.status = "ready";
    }
  }

  // Check if all steps done
  const allDone = plan.steps.every(s => s.status === "completed");
  if (allDone) {
    plan.status = "completed";
    plan.completedAt = Date.now();
  }
}

export function getReadySteps(planId: string): CoordinationStep[] {
  return plans.get(planId)?.steps.filter(s => s.status === "ready") ?? [];
}

export function getPlan(planId: string): CoordinationPlan | undefined {
  return plans.get(planId);
}

export function getPlanProgress(planId: string): { total: number; completed: number; pct: number } | null {
  const plan = plans.get(planId);
  if (!plan) return null;
  const total = plan.steps.length;
  const completed = plan.steps.filter(s => s.status === "completed").length;
  return { total, completed, pct: total > 0 ? Math.round((completed / total) * 100) : 0 };
}

export function _resetCoordinatorForTest(): void {
  plans.clear();
  planCounter = 0;
  stepCounter = 0;
}
