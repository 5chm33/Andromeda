/**
 * planReviser.ts — v89.0.0 "Autonomous Planning & Goal Management"
 * Revises plans in response to deviations, failures, and changing world states.
 */
export type RevisionStrategy = "replan_from_scratch" | "partial_replan" | "skip_failed" | "retry_with_backoff" | "fallback_plan";

export interface RevisionRequest {
  requestId: string;
  originalPlanId: string;
  executionId: string;
  deviationType: string;
  currentState: string[];
  failedStepIndex: number;
  strategy: RevisionStrategy;
}

export interface RevisedPlan {
  revisedPlanId: string;
  originalPlanId: string;
  strategy: RevisionStrategy;
  removedSteps: string[];
  addedSteps: string[];
  modifiedSteps: string[];
  rationale: string;
  estimatedImprovementMs: number;
  createdAt: number;
}

const revisionHistory: RevisedPlan[] = [];
let revCounter = 0;
let reqCounter = 0;

export function createRevisionRequest(originalPlanId: string, executionId: string, deviationType: string, currentState: string[], failedStepIndex: number, strategy: RevisionStrategy): RevisionRequest {
  return {
    requestId: `rev-req-${++reqCounter}`,
    originalPlanId, executionId, deviationType, currentState, failedStepIndex, strategy,
  };
}

export function revisePlan(request: RevisionRequest, availableAlternatives: string[] = []): RevisedPlan {
  const removedSteps: string[] = [];
  const addedSteps: string[] = [];
  const modifiedSteps: string[] = [];
  let rationale = "";
  let estimatedImprovementMs = 0;

  switch (request.strategy) {
    case "skip_failed":
      removedSteps.push(`step-${request.failedStepIndex}`);
      rationale = `Skipped failed step ${request.failedStepIndex} to continue execution`;
      estimatedImprovementMs = 500;
      break;
    case "retry_with_backoff":
      modifiedSteps.push(`step-${request.failedStepIndex}`);
      rationale = `Retrying step ${request.failedStepIndex} with exponential backoff`;
      estimatedImprovementMs = 200;
      break;
    case "partial_replan":
      for (let i = request.failedStepIndex; i < request.failedStepIndex + 3; i++) removedSteps.push(`step-${i}`);
      addedSteps.push(...availableAlternatives.slice(0, 2));
      rationale = `Replanned steps from index ${request.failedStepIndex} using ${availableAlternatives.length} alternatives`;
      estimatedImprovementMs = 1000;
      break;
    case "fallback_plan":
      addedSteps.push(...availableAlternatives);
      rationale = `Switched to fallback plan with ${availableAlternatives.length} alternative steps`;
      estimatedImprovementMs = 2000;
      break;
    case "replan_from_scratch":
    default:
      rationale = `Full replan triggered due to ${request.deviationType}`;
      estimatedImprovementMs = 3000;
      break;
  }

  const revised: RevisedPlan = {
    revisedPlanId: `rp-${++revCounter}`,
    originalPlanId: request.originalPlanId,
    strategy: request.strategy,
    removedSteps, addedSteps, modifiedSteps,
    rationale, estimatedImprovementMs,
    createdAt: Date.now(),
  };
  revisionHistory.push(revised);
  return revised;
}

export function getRevisionHistory(originalPlanId?: string): RevisedPlan[] {
  return originalPlanId ? revisionHistory.filter(r => r.originalPlanId === originalPlanId) : [...revisionHistory];
}

export function _resetPlanReviserForTest(): void { revisionHistory.length = 0; revCounter = 0; reqCounter = 0; }
