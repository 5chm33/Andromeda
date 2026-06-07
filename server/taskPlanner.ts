/**
 * taskPlanner.ts — LLM-Based Task Decomposition & Re-Planning Engine
 * Andromeda v6.19
 *
 * Replaces the regex keyword matching in ai.ts with actual LLM-driven planning.
 * Supports:
 *  - Structured plan generation (goal → ordered steps with dependencies)
 *  - Re-planning on sub-task failure (not just fixed plans)
 *  - Plan validation before execution
 *  - Episodic memory integration (learns from past failures)
 */

import { backgroundSimpleCompletion } from "./llmProvider.js";
import { getEpisodicMemory, recordEpisode } from "./episodicMemory.js";
import { getConsolidatedLessons } from "./episodicConsolidation.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlanStep {
  id: string;
  description: string;
  toolHint?: string;          // suggested tool (e.g. "read_file", "bash", "browser_navigate")
  dependsOn: string[];        // IDs of steps that must complete before this one
  status: "pending" | "running" | "done" | "failed" | "skipped";
  result?: string;
  error?: string;
  retries: number;
  maxRetries: number;
}

export interface TaskPlan {
  id: string;
  goal: string;
  steps: PlanStep[];
  createdAt: number;
  updatedAt: number;
  status: "planning" | "executing" | "done" | "failed" | "replanning";
  replanCount: number;
  maxReplans: number;
}

export interface PlannerOptions {
  maxSteps?: number;
  maxReplans?: number;
  useEpisodicMemory?: boolean;
  verbose?: boolean;
}

// ─── Active Plans Store ───────────────────────────────────────────────────────

const activePlans = new Map<string, TaskPlan>();

export function getActivePlan(id: string): TaskPlan | undefined {
  return activePlans.get(id);
}

export function getAllActivePlans(): TaskPlan[] {
  return Array.from(activePlans.values());
}

// ─── LLM Plan Generation ──────────────────────────────────────────────────────

/**
 * Generate a structured execution plan for a goal using the LLM.
 * Returns a TaskPlan with ordered, dependency-aware steps.
 */
export async function generatePlan(
  goal: string,
  context: string = "",
  options: PlannerOptions = {}
): Promise<TaskPlan> {
  const { maxSteps = 10, maxReplans = 3, useEpisodicMemory = true, verbose = false } = options;

  // Pull relevant past episodes to inform the plan
  let episodicContext = "";
  if (useEpisodicMemory) {
    const episodes = await getEpisodicMemory(goal, 3);
    if (episodes.length > 0) {
      episodicContext = "\n\nRelevant past experience:\n" + episodes.map(e =>
        `- Goal: "${e.goal}" \u2192 ${e.outcome}: ${e.summary}`
      ).join("\n");
    }
  }

  // v6.33: Inject consolidated lessons from episodic memory consolidation
  let lessonContext = "";
  try {
    const lessons = getConsolidatedLessons({ limit: 5 });
    if (lessons.length > 0) {
      // Find lessons whose cluster key overlaps with the goal keywords
      const goalWords = new Set(goal.toLowerCase().split(/\s+/).filter(w => w.length > 3));
      const relevant = lessons.filter(l =>
        l.commonTags.some(t => goalWords.has(t.toLowerCase())) ||
        goalWords.has(l.clusterKey.toLowerCase())
      ).slice(0, 3);
      if (relevant.length > 0) {
        lessonContext = "\n\nConsolidated lessons from past sessions:\n" +
          relevant.map(l => `- [${l.clusterKey}] ${l.lesson}`).join("\n");
      }
    }
  } catch {
    // non-fatal — lessons file may not exist yet
  }

  const systemPrompt = `You are a task planning engine. Given a goal, decompose it into a minimal ordered list of concrete executable steps.

Rules:
1. Each step must be atomic and independently executable
2. Steps must have explicit dependencies (what must complete before this step)
3. Suggest the most appropriate tool for each step from: read_file, write_file, bash, browser_navigate, browser_click, browser_type, search_web, memory_search, llm_call, user_input
4. Maximum ${maxSteps} steps
5. Return ONLY valid JSON, no markdown, no explanation

Output format:
{
  "steps": [
    {
      "id": "step_1",
      "description": "Brief description of what to do",
      "toolHint": "tool_name",
      "dependsOn": []
    },
    {
      "id": "step_2", 
      "description": "Brief description",
      "toolHint": "tool_name",
      "dependsOn": ["step_1"]
    }
  ]
}`;

  const userPrompt = `Goal: ${goal}${context ? `\n\nContext: ${context}` : ""}${episodicContext}${lessonContext}`;

  let stepsRaw: { id: string; description: string; toolHint?: string; dependsOn: string[] }[] = [];

  try {
    const response = await backgroundSimpleCompletion([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]);
    // Strip markdown code fences if present
    const cleaned = response.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    stepsRaw = parsed.steps ?? [];
  } catch (err) {
    if (verbose) console.warn("[TaskPlanner] LLM plan parse failed, using fallback:", err);
    // Fallback: single-step plan
    stepsRaw = [{ id: "step_1", description: goal, toolHint: "llm_call", dependsOn: [] }];
  }

  const steps: PlanStep[] = stepsRaw.map(s => ({
    id: s.id,
    description: s.description,
    toolHint: s.toolHint,
    dependsOn: s.dependsOn ?? [],
    status: "pending",
    retries: 0,
    maxRetries: 2,
  }));

  const plan: TaskPlan = {
    id: `plan_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    goal,
    steps,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "executing",
    replanCount: 0,
    maxReplans,
  };

  activePlans.set(plan.id, plan);
  if (verbose) console.log(`[TaskPlanner] Generated plan ${plan.id} with ${steps.length} steps for: "${goal}"`);

  return plan;
}

// ─── Re-Planning on Failure ───────────────────────────────────────────────────

/**
 * Called when a step fails. Generates a revised plan that accounts for the failure.
 * This is the key SOTA capability — not just retrying, but actually re-thinking the approach.
 */
export async function replanOnFailure(
  plan: TaskPlan,
  failedStep: PlanStep,
  errorContext: string,
  options: PlannerOptions = {}
): Promise<TaskPlan | null> {
  if (plan.replanCount >= plan.maxReplans) {
    console.warn(`[TaskPlanner] Plan ${plan.id} exceeded max replans (${plan.maxReplans}), giving up`);
    plan.status = "failed";
    plan.updatedAt = Date.now();
    return null;
  }

  plan.status = "replanning";
  plan.replanCount++;
  plan.updatedAt = Date.now();

  // Record this failure in episodic memory
  await recordEpisode({
    goal: plan.goal,
    outcome: "partial_failure",
    summary: `Step "${failedStep.description}" failed: ${errorContext.slice(0, 200)}`,
    failedStep: failedStep.description,
    errorContext,
  });

  const completedSteps = plan.steps.filter(s => s.status === "done");
  const remainingGoal = `Continue completing: "${plan.goal}"\n\nAlready done:\n${
    completedSteps.map(s => `- ${s.description}`).join("\n") || "Nothing yet"
  }\n\nFailed step: "${failedStep.description}"\nError: ${errorContext}\n\nGenerate a revised plan for the remaining work, avoiding the same approach that failed.`;

  const systemPrompt = `You are a task re-planning engine. A step in an execution plan failed. Generate a revised plan for the remaining work.
Avoid the same approach that failed. Be creative about alternative approaches.
Return ONLY valid JSON in the same format as before.`;

  try {
    const response = await backgroundSimpleCompletion([
      { role: "system", content: systemPrompt },
      { role: "user", content: remainingGoal }
    ]);
    const cleaned = response.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    const newSteps: PlanStep[] = (parsed.steps ?? []).map((s: any) => ({
      id: s.id,
      description: s.description,
      toolHint: s.toolHint,
      dependsOn: s.dependsOn ?? [],
      status: "pending",
      retries: 0,
      maxRetries: 2,
    }));

    // Merge: keep completed steps, replace remaining with new plan
    plan.steps = [
      ...completedSteps,
      ...newSteps,
    ];
    plan.status = "executing";
    plan.updatedAt = Date.now();

    console.log(`[TaskPlanner] Re-plan ${plan.replanCount}/${plan.maxReplans} for plan ${plan.id}: ${newSteps.length} new steps`);
    return plan;
  } catch (err) {
    console.error("[TaskPlanner] Re-plan generation failed:", err);
    plan.status = "failed";
    plan.updatedAt = Date.now();
    return null;
  }
}

// ─── Plan Execution Helpers ───────────────────────────────────────────────────

/**
 * Get the next executable step (all dependencies satisfied, status=pending).
 */
export function getNextExecutableStep(plan: TaskPlan): PlanStep | null {
  const doneIds = new Set(plan.steps.filter(s => s.status === "done").map(s => s.id));

  for (const step of plan.steps) {
    if (step.status !== "pending") continue;
    const depsReady = step.dependsOn.every(dep => doneIds.has(dep));
    if (depsReady) return step;
  }
  return null;
}

/**
 * Mark a step as done with its result.
 */
export function completeStep(plan: TaskPlan, stepId: string, result: string): void {
  const step = plan.steps.find(s => s.id === stepId);
  if (!step) return;
  step.status = "done";
  step.result = result;
  plan.updatedAt = Date.now();

  // Check if all steps are done
  if (plan.steps.every(s => s.status === "done" || s.status === "skipped")) {
    plan.status = "done";
    // Record success in episodic memory
    recordEpisode({
      goal: plan.goal,
      outcome: "success",
      summary: `Completed in ${plan.steps.filter(s => s.status === "done").length} steps with ${plan.replanCount} replans`,
    }).catch(() => {});
  }
}

/**
 * Mark a step as failed and trigger re-planning if appropriate.
 */
export async function failStep(
  plan: TaskPlan,
  stepId: string,
  error: string,
  options: PlannerOptions = {}
): Promise<TaskPlan | null> {
  const step = plan.steps.find(s => s.id === stepId);
  if (!step) return plan;

  step.retries++;
  if (step.retries <= step.maxRetries) {
    // Retry first
    step.status = "pending";
    console.log(`[TaskPlanner] Retrying step "${step.description}" (attempt ${step.retries}/${step.maxRetries})`);
    return plan;
  }

  step.status = "failed";
  step.error = error;
  plan.updatedAt = Date.now();

  // Trigger re-planning
  return replanOnFailure(plan, step, error, options);
}

/**
 * Get a human-readable plan summary for display.
 */
export function getPlanSummary(plan: TaskPlan): string {
  const done = plan.steps.filter(s => s.status === "done").length;
  const total = plan.steps.length;
  const failed = plan.steps.filter(s => s.status === "failed").length;
  return `Plan "${plan.goal.slice(0, 60)}..." — ${done}/${total} steps done${failed > 0 ? `, ${failed} failed` : ""}${plan.replanCount > 0 ? `, replanned ${plan.replanCount}x` : ""}`;
}

// ─── Multi-Agent Parallel Dispatch (v6.35) ────────────────────────────────────

/**
 * Detect groups of steps that can run in parallel.
 * A group is a set of pending steps whose dependsOn are all already done,
 * and none of them depend on each other.
 */
export function detectParallelGroups(plan: TaskPlan): PlanStep[][] {
  const doneIds = new Set(
    plan.steps.filter(s => s.status === "done" || s.status === "skipped").map(s => s.id)
  );

  // Collect all currently executable (pending + deps satisfied) steps
  const executable = plan.steps.filter(s => {
    if (s.status !== "pending") return false;
    return s.dependsOn.every(dep => doneIds.has(dep));
  });

  if (executable.length <= 1) return executable.length === 1 ? [[executable[0]]] : [];

  // Build a set of executable step IDs to detect cross-dependencies
  const execIds = new Set(executable.map(s => s.id));

  // Group steps that don't depend on each other into parallel batches
  const groups: PlanStep[][] = [];
  const assigned = new Set<string>();

  for (const step of executable) {
    if (assigned.has(step.id)) continue;
    // Find all steps that can run alongside this one (no cross-deps)
    const group = [step];
    assigned.add(step.id);
    for (const other of executable) {
      if (assigned.has(other.id)) continue;
      const crossDep =
        other.dependsOn.some(d => execIds.has(d) && d !== step.id) ||
        step.dependsOn.some(d => d === other.id);
      if (!crossDep) {
        group.push(other);
        assigned.add(other.id);
      }
    }
    groups.push(group);
  }

  return groups;
}

/**
 * Dispatch a group of steps to parallel sub-agents using Promise.allSettled.
 * Each step is executed by calling the provided executor function.
 * Results are written back into the plan steps.
 */
export async function dispatchParallelSteps(
  plan: TaskPlan,
  steps: PlanStep[],
  executor: (step: PlanStep) => Promise<string>,
): Promise<void> {
  if (steps.length === 0) return;

  // Mark all as running
  for (const step of steps) {
    step.status = "running";
    plan.updatedAt = Date.now();
  }

  console.log(
    `[TaskPlanner] Dispatching ${steps.length} steps in parallel: ${steps.map(s => s.id).join(", ")}`
  );

  const results = await Promise.allSettled(steps.map(step => executor(step)));

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const result = results[i];
    if (result.status === "fulfilled") {
      step.status = "done";
      step.result = result.value;
    } else {
      step.retries++;
      if (step.retries <= step.maxRetries) {
        step.status = "pending";
        console.log(
          `[TaskPlanner] Parallel step "${step.description}" failed, will retry (${step.retries}/${step.maxRetries})`
        );
      } else {
        step.status = "failed";
        step.error = String(result.reason);
        console.error(
          `[TaskPlanner] Parallel step "${step.description}" failed permanently: ${step.error}`
        );
      }
    }
    plan.updatedAt = Date.now();
  }

  // Check if plan is complete
  if (plan.steps.every(s => s.status === "done" || s.status === "skipped")) {
    plan.status = "done";
    recordEpisode({
      goal: plan.goal,
      outcome: "success",
      summary: `Completed via parallel dispatch in ${plan.steps.filter(s => s.status === "done").length} steps`,
    }).catch(() => {});
  }
}
