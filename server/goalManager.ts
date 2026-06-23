/**
 * goalManager.ts — Goal-Oriented Task Planner
 *
 * The single biggest autonomy multiplier for Andromeda. Turns the agent from
 * reactive (waits for queries) to proactive (pursues goals autonomously).
 *
 * Architecture:
 *   Goal → Sub-goals → Tasks → Steps
 *   Each level can be paused, checkpointed, or require human approval.
 *
 * Integrations:
 *   - scheduler.ts: Long-running goals schedule periodic check-ins
 *   - agentOrchestrator.ts: Complex sub-goals spawn multi-agent teams
 *   - selfImprove.ts: "Improve X" goals trigger self-improvement proposals
 *   - memory.ts: Goal progress and learnings are persisted to memory
 */

import { randomUUID } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GoalStatus =
  | "pending"      // Created but not started
  | "active"       // Currently being pursued
  | "paused"       // Paused by user or checkpoint
  | "checkpoint"   // Waiting for human approval to continue
  | "completed"    // Successfully achieved
  | "failed"       // Failed after max retries
  | "cancelled";   // Cancelled by user

export type GoalPriority = "critical" | "high" | "medium" | "low";

export type SubGoal = {
  id: string;
  parentGoalId: string;
  title: string;
  description: string;
  status: GoalStatus;
  assignedAgent?: string;        // Which agent/orchestrator handles this
  result?: string;               // Output when completed
  error?: string;                // Error if failed
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  completedAt?: number;
  dependencies: string[];        // IDs of sub-goals that must complete first
  requiresApproval: boolean;     // Checkpoint before executing
  estimatedComplexity: "simple" | "moderate" | "complex";
};

export type GoalCheckpoint = {
  id: string;
  goalId: string;
  subGoalId?: string;
  message: string;               // What the agent wants to tell the user
  options?: string[];             // Optional choices for the user
  response?: string;             // User's response
  respondedAt?: number;
  createdAt: number;
};

export type Goal = {
  id: string;
  title: string;
  description: string;
  status: GoalStatus;
  priority: GoalPriority;
  successCriteria: string[];     // How to know the goal is achieved
  subGoals: SubGoal[];
  checkpoints: GoalCheckpoint[];
  progress: number;              // 0-100 percentage
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  scheduledTaskId?: string;      // If linked to a scheduler task
  metadata: Record<string, any>;
  learnings: string[];           // What was learned during pursuit
  totalSteps: number;
  completedSteps: number;
};

export type GoalEvent = {
  type: "goal_created" | "goal_started" | "goal_paused" | "goal_resumed"
    | "goal_completed" | "goal_failed" | "goal_cancelled"
    | "subgoal_created" | "subgoal_started" | "subgoal_completed" | "subgoal_failed"
    | "checkpoint_created" | "checkpoint_resolved"
    | "progress_update" | "learning_added";
  goalId: string;
  subGoalId?: string;
  data: Record<string, any>;
  timestamp: number;
};

export type DecompositionResult = {
  subGoals: Array<{
    title: string;
    description: string;
    dependencies: string[];       // Titles of dependent sub-goals
    estimatedComplexity: "simple" | "moderate" | "complex";
    requiresApproval: boolean;
    assignedAgent?: string;
  }>;
  estimatedTotalSteps: number;
  reasoning: string;
};

// ─── Storage ──────────────────────────────────────────────────────────────────

const goals = new Map<string, Goal>();
const eventLog: GoalEvent[] = [];
const MAX_EVENTS = 5000;

function emitEvent(event: Omit<GoalEvent, "timestamp">): GoalEvent {
  const full: GoalEvent = { ...event, timestamp: Date.now() };
  eventLog.push(full);
  if (eventLog.length > MAX_EVENTS) eventLog.splice(0, eventLog.length - MAX_EVENTS);
  // v5.15: Auto-persist goal to DB after every state change
  const goal = goals.get(event.goalId);
  if (goal && _persistenceEnabled) {
    persistGoal(goal).catch(() => {});
  }
  return full;
}

// v5.15: Persistence flag — set to true after DB is ready
let _persistenceEnabled = false;

// ─── Goal CRUD ────────────────────────────────────────────────────────────────

export function createGoal(input: {
  title: string;
  description: string;
  priority?: GoalPriority;
  successCriteria?: string[];
  metadata?: Record<string, any>;
}): Goal {
  const goal: Goal = {
    id: randomUUID(),
    title: input.title,
    description: input.description,
    status: "pending",
    priority: input.priority ?? "medium",
    successCriteria: input.successCriteria ?? [],
    subGoals: [],
    checkpoints: [],
    progress: 0,
    createdAt: Date.now(),
    metadata: input.metadata ?? {},
    learnings: [],
    totalSteps: 0,
    completedSteps: 0,
  };
  goals.set(goal.id, goal);
  emitEvent({ type: "goal_created", goalId: goal.id, data: { title: goal.title, priority: goal.priority } });
  return goal;
}

export function getGoal(goalId: string): Goal | undefined {
  return goals.get(goalId);
}

export function listGoals(statusFilter?: GoalStatus): Goal[] {
  const all = Array.from(goals.values());
  if (statusFilter) return all.filter(g => g.status === statusFilter);
  return all.sort((a, b) => {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

export function deleteGoal(goalId: string): boolean {
  return goals.delete(goalId);
}

// ─── Goal Lifecycle ───────────────────────────────────────────────────────────

export function startGoal(goalId: string): boolean {
  const goal = goals.get(goalId);
  if (!goal || goal.status !== "pending") return false;
  goal.status = "active";
  goal.startedAt = Date.now();
  emitEvent({ type: "goal_started", goalId, data: {} });
  return true;
}

export function pauseGoal(goalId: string): boolean {
  const goal = goals.get(goalId);
  if (!goal || goal.status !== "active") return false;
  goal.status = "paused";
  emitEvent({ type: "goal_paused", goalId, data: {} });
  return true;
}

export function resumeGoal(goalId: string): boolean {
  const goal = goals.get(goalId);
  if (!goal || (goal.status !== "paused" && goal.status !== "checkpoint")) return false;
  goal.status = "active";
  emitEvent({ type: "goal_resumed", goalId, data: {} });
  return true;
}

export function cancelGoal(goalId: string): boolean {
  const goal = goals.get(goalId);
  if (!goal || goal.status === "completed" || goal.status === "cancelled") return false;
  goal.status = "cancelled";
  // Cancel all pending sub-goals
  for (const sg of goal.subGoals) {
    if (sg.status === "pending" || sg.status === "active") sg.status = "cancelled";
  }
  emitEvent({ type: "goal_cancelled", goalId, data: {} });
  return true;
}

export function completeGoal(goalId: string, learnings?: string[]): boolean {
  const goal = goals.get(goalId);
  if (!goal) return false;
  goal.status = "completed";
  goal.completedAt = Date.now();
  goal.progress = 100;
  if (learnings) goal.learnings.push(...learnings);
  emitEvent({ type: "goal_completed", goalId, data: { duration: goal.completedAt - (goal.startedAt ?? goal.createdAt) } });
  return true;
}

export function failGoal(goalId: string, reason: string): boolean {
  const goal = goals.get(goalId);
  if (!goal) return false;
  goal.status = "failed";
  goal.completedAt = Date.now();
  emitEvent({ type: "goal_failed", goalId, data: { reason } });
  return true;
}

// ─── Sub-Goal Management ──────────────────────────────────────────────────────

export function addSubGoal(goalId: string, input: {
  title: string;
  description: string;
  dependencies?: string[];
  estimatedComplexity?: "simple" | "moderate" | "complex";
  requiresApproval?: boolean;
  assignedAgent?: string;
  maxRetries?: number;
}): SubGoal | null {
  const goal = goals.get(goalId);
  if (!goal) return null;

  const subGoal: SubGoal = {
    id: randomUUID(),
    parentGoalId: goalId,
    title: input.title,
    description: input.description,
    status: "pending",
    assignedAgent: input.assignedAgent,
    retryCount: 0,
    maxRetries: input.maxRetries ?? 2,
    createdAt: Date.now(),
    dependencies: input.dependencies ?? [],
    requiresApproval: input.requiresApproval ?? false,
    estimatedComplexity: input.estimatedComplexity ?? "moderate",
  };

  goal.subGoals.push(subGoal);
  goal.totalSteps = goal.subGoals.length;
  emitEvent({ type: "subgoal_created", goalId, subGoalId: subGoal.id, data: { title: subGoal.title } });
  return subGoal;
}

export function completeSubGoal(goalId: string, subGoalId: string, result: string): boolean {
  const goal = goals.get(goalId);
  if (!goal) return false;
  const sg = goal.subGoals.find(s => s.id === subGoalId);
  if (!sg) return false;

  sg.status = "completed";
  sg.result = result;
  sg.completedAt = Date.now();
  goal.completedSteps++;
  goal.progress = Math.round((goal.completedSteps / Math.max(goal.totalSteps, 1)) * 100);

  emitEvent({ type: "subgoal_completed", goalId, subGoalId, data: { result: result.slice(0, 200) } });
  emitEvent({ type: "progress_update", goalId, data: { progress: goal.progress } });

  // Check if all sub-goals are done
  const allDone = goal.subGoals.every(s => s.status === "completed" || s.status === "cancelled");
  if (allDone && goal.status === "active") {
    completeGoal(goalId);
  }

  return true;
}

export function failSubGoal(goalId: string, subGoalId: string, error: string): boolean {
  const goal = goals.get(goalId);
  if (!goal) return false;
  const sg = goal.subGoals.find(s => s.id === subGoalId);
  if (!sg) return false;

  sg.retryCount++;
  if (sg.retryCount < sg.maxRetries) {
    sg.status = "pending"; // Will be retried
    sg.error = error;
  } else {
    sg.status = "failed";
    sg.error = error;
    emitEvent({ type: "subgoal_failed", goalId, subGoalId, data: { error, retries: sg.retryCount } });
  }
  return true;
}

/**
 * Get the next sub-goal that is ready to execute (all dependencies met).
 */
export function getNextSubGoal(goalId: string): SubGoal | null {
  const goal = goals.get(goalId);
  if (!goal || goal.status !== "active") return null;

  const completedIds = new Set(
    goal.subGoals.filter(s => s.status === "completed").map(s => s.id)
  );

  for (const sg of goal.subGoals) {
    if (sg.status !== "pending") continue;
    // Check all dependencies are completed
    const depsReady = sg.dependencies.every(depId => completedIds.has(depId));
    if (depsReady) return sg;
  }
  return null;
}

/**
 * Get all sub-goals that can run in parallel (no unmet dependencies).
 */
export function getParallelSubGoals(goalId: string): SubGoal[] {
  const goal = goals.get(goalId);
  if (!goal || goal.status !== "active") return [];

  const completedIds = new Set(
    goal.subGoals.filter(s => s.status === "completed").map(s => s.id)
  );

  return goal.subGoals.filter(sg => {
    if (sg.status !== "pending") return false;
    return sg.dependencies.every(depId => completedIds.has(depId));
  });
}

// ─── Checkpoints (Human-in-the-Loop) ─────────────────────────────────────────

export function createCheckpoint(goalId: string, message: string, options?: string[], subGoalId?: string): GoalCheckpoint | null {
  const goal = goals.get(goalId);
  if (!goal) return null;

  const checkpoint: GoalCheckpoint = {
    id: randomUUID(),
    goalId,
    subGoalId,
    message,
    options,
    createdAt: Date.now(),
  };

  goal.checkpoints.push(checkpoint);
  goal.status = "checkpoint";
  emitEvent({ type: "checkpoint_created", goalId, data: { message, checkpointId: checkpoint.id } });
  return checkpoint;
}

export function resolveCheckpoint(goalId: string, checkpointId: string, response: string): boolean {
  const goal = goals.get(goalId);
  if (!goal) return false;

  const cp = goal.checkpoints.find(c => c.id === checkpointId);
  if (!cp || cp.response) return false;

  cp.response = response;
  cp.respondedAt = Date.now();
  goal.status = "active";
  emitEvent({ type: "checkpoint_resolved", goalId, data: { checkpointId, response } });
  return true;
}

export function getPendingCheckpoints(goalId?: string): GoalCheckpoint[] {
  if (goalId) {
    const goal = goals.get(goalId);
    if (!goal) return [];
    return goal.checkpoints.filter(c => !c.response);
  }
  // All pending checkpoints across all goals
  const pending: GoalCheckpoint[] = [];
  for (const goal of Array.from(goals.values())) {
    for (const cp of goal.checkpoints) {
      if (!cp.response) pending.push(cp);
    }
  }
  return pending;
}

// ─── Goal Decomposition (AI-assisted) ─────────────────────────────────────────

/**
 * Decompose a goal into sub-goals. This generates a structured plan
 * that can be reviewed before execution.
 *
 * In a full implementation, this would call the LLM to generate the plan.
 * Here we provide the framework and a heuristic decomposer.
 */
export function decomposeGoal(goalId: string, decomposition: DecompositionResult): boolean {
  const goal = goals.get(goalId);
  if (!goal) return false;

  // Build a title→ID map for dependency resolution
  const titleToId = new Map<string, string>();

  for (const sgInput of decomposition.subGoals) {
    const sg = addSubGoal(goalId, {
      title: sgInput.title,
      description: sgInput.description,
      dependencies: [], // Will be resolved after all sub-goals are created
      estimatedComplexity: sgInput.estimatedComplexity,
      requiresApproval: sgInput.requiresApproval,
      assignedAgent: sgInput.assignedAgent,
    });
    if (sg) titleToId.set(sgInput.title, sg.id);
  }

  // Resolve dependencies by title → ID
  for (const sgInput of decomposition.subGoals) {
    const sgId = titleToId.get(sgInput.title);
    if (!sgId) continue;
    const sg = goal.subGoals.find(s => s.id === sgId);
    if (!sg) continue;
    sg.dependencies = sgInput.dependencies
      .map(depTitle => titleToId.get(depTitle))
      .filter((id): id is string => !!id);
  }

  goal.totalSteps = decomposition.estimatedTotalSteps || goal.subGoals.length;
  goal.metadata.decompositionReasoning = decomposition.reasoning;

  return true;
}

// ─── Learning & Self-Evaluation ───────────────────────────────────────────────

export function addLearning(goalId: string, learning: string): boolean {
  const goal = goals.get(goalId);
  if (!goal) return false;
  goal.learnings.push(learning);
  emitEvent({ type: "learning_added", goalId, data: { learning } });
  return true;
}

/**
 * Evaluate whether a goal's success criteria have been met.
 * Returns a score 0-100 and reasoning.
 */
export function evaluateGoal(goalId: string): { score: number; met: string[]; unmet: string[]; reasoning: string } | null {
  const goal = goals.get(goalId);
  if (!goal) return null;

  const met: string[] = [];
  const unmet: string[] = [];

  // Simple heuristic: check if sub-goals cover the criteria
  for (const criterion of goal.successCriteria) {
    const covered = goal.subGoals.some(sg =>
      sg.status === "completed" &&
      (sg.title.toLowerCase().includes(criterion.toLowerCase().slice(0, 20)) ||
       (sg.result ?? "").toLowerCase().includes(criterion.toLowerCase().slice(0, 20)))
    );
    if (covered) met.push(criterion);
    else unmet.push(criterion);
  }

  const score = goal.successCriteria.length > 0
    ? Math.round((met.length / goal.successCriteria.length) * 100)
    : goal.progress;

  return {
    score,
    met,
    unmet,
    reasoning: `${met.length}/${goal.successCriteria.length} criteria met. Progress: ${goal.progress}%. Sub-goals: ${goal.completedSteps}/${goal.totalSteps} completed.`,
  };
}

// ─── Statistics & Events ──────────────────────────────────────────────────────

export function getGoalStats(): {
  totalGoals: number;
  activeGoals: number;
  completedGoals: number;
  failedGoals: number;
  pendingCheckpoints: number;
  averageProgress: number;
  totalLearnings: number;
} {
  const all = Array.from(goals.values());
  const active = all.filter(g => g.status === "active" || g.status === "checkpoint");
  const completed = all.filter(g => g.status === "completed");
  const failed = all.filter(g => g.status === "failed");
  const pendingCps = getPendingCheckpoints();
  const avgProgress = all.length > 0
    ? Math.round(all.reduce((sum, g) => sum + g.progress, 0) / all.length)
    : 0;
  const totalLearnings = all.reduce((sum, g) => sum + g.learnings.length, 0);

  return {
    totalGoals: all.length,
    activeGoals: active.length,
    completedGoals: completed.length,
    failedGoals: failed.length,
    pendingCheckpoints: pendingCps.length,
    averageProgress: avgProgress,
    totalLearnings,
  };
}

export function getGoalEvents(goalId?: string, limit: number = 50): GoalEvent[] {
  const filtered = goalId
    ? eventLog.filter(e => e.goalId === goalId)
    : eventLog;
  return filtered.slice(-limit);
}

/**
 * Get a summary of all active goals for injection into the system prompt.
 * This allows Andromeda to be aware of its current goals during conversations.
 */
export function getActiveGoalsSummary(): string {
  const active = listGoals("active");
  const checkpoint = listGoals("checkpoint");
  const all = [...active, ...checkpoint];

  if (all.length === 0) return "";

  const lines = ["## Active Goals"];
  for (const goal of all) {
    lines.push(`- **${goal.title}** [${goal.priority}] — ${goal.progress}% complete`);
    if (goal.status === "checkpoint") {
      const pending = goal.checkpoints.filter(c => !c.response);
      if (pending.length > 0) {
        lines.push(`  ⚠ Waiting for approval: ${pending[0].message}`);
      }
    }
    const next = getNextSubGoal(goal.id);
    if (next) {
      lines.push(`  → Next: ${next.title}`);
    }
  }
  return lines.join("\n");
}


// ═══════════════════════════════════════════════════════════════════════════
// v5.7 Enhancement: Dynamic Goal Reprioritization Engine
// ═══════════════════════════════════════════════════════════════════════════

export type ReprioritizationRule = {
  id: string;
  name: string;
  condition: (goal: Goal) => boolean;
  newPriority: GoalPriority;
  reason: string;
  enabled: boolean;
};

export type ReprioritizationEvent = {
  goalId: string;
  goalTitle: string;
  oldPriority: GoalPriority;
  newPriority: GoalPriority;
  rule: string;
  reason: string;
  timestamp: number;
};

const reprioritizationRules: ReprioritizationRule[] = [];
const reprioritizationHistory: ReprioritizationEvent[] = [];
let reprioritizationEnabled = true;

// ── Built-in Rules ───────────────────────────────────────────────────────────

const PRIORITY_ORDER: Record<GoalPriority, number> = { critical: 4, high: 3, medium: 2, low: 1 };

function initDefaultRules(): void {
  if (reprioritizationRules.length > 0) return;

  addReprioritizationRule({
    name: "stale_goal_demotion",
    condition: (goal) => {
      // Goals with no progress in 30 minutes get demoted
      const lastEvent = getGoalEvents(goal.id, 1)[0];
      if (!lastEvent) return false;
      const staleDuration = Date.now() - lastEvent.timestamp;
      return staleDuration > 30 * 60 * 1000 && goal.progress < 50 && goal.priority !== "low";
    },
    newPriority: "low",
    reason: "Goal has been stale for 30+ minutes with <50% progress",
    enabled: true,
  });

  addReprioritizationRule({
    name: "blocked_goal_escalation",
    condition: (goal) => {
      // Goals with pending checkpoints for >5 min get escalated
      const pending = getPendingCheckpoints(goal.id);
      if (pending.length === 0) return false;
      const oldest = Math.min(...pending.map(c => c.createdAt));
      return Date.now() - oldest > 5 * 60 * 1000 && goal.priority !== "critical";
    },
    newPriority: "high",
    reason: "Goal blocked on checkpoint for 5+ minutes — needs attention",
    enabled: true,
  });

  addReprioritizationRule({
    name: "failing_subgoals_escalation",
    condition: (goal) => {
      // If >50% of sub-goals have failed, escalate
      if (goal.subGoals.length < 2) return false;
      const failed = goal.subGoals.filter(sg => sg.status === "failed").length;
      return failed / goal.subGoals.length > 0.5 && goal.priority !== "critical";
    },
    newPriority: "critical",
    reason: "More than 50% of sub-goals have failed — needs immediate attention",
    enabled: true,
  });

  addReprioritizationRule({
    name: "near_completion_boost",
    condition: (goal) => {
      // Goals at >80% progress get boosted to finish them
      return goal.progress >= 80 && goal.priority === "low";
    },
    newPriority: "medium",
    reason: "Goal is >80% complete — boosting to finish",
    enabled: true,
  });

  addReprioritizationRule({
    name: "dependency_chain_boost",
    condition: (goal) => {
      // If other goals depend on this one (checked via sub-goal references), boost it
      const allGoals = listGoals("active");
      const dependents = allGoals.filter(g =>
        g.id !== goal.id &&
        g.subGoals.some(sg => sg.title.toLowerCase().includes(goal.title.toLowerCase().substring(0, 20)))
      );
      return dependents.length >= 2 && goal.priority === "low";
    },
    newPriority: "high",
    reason: "Multiple other goals appear to depend on this one",
    enabled: true,
  });
}

// ── Rule Management ──────────────────────────────────────────────────────────

export function addReprioritizationRule(input: Omit<ReprioritizationRule, "id">): ReprioritizationRule {
  const rule: ReprioritizationRule = {
    id: `rule_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    ...input,
  };
  reprioritizationRules.push(rule);
  return rule;
}

export function removeReprioritizationRule(ruleId: string): boolean {
  const idx = reprioritizationRules.findIndex(r => r.id === ruleId);
  if (idx === -1) return false;
  reprioritizationRules.splice(idx, 1);
  return true;
}

export function listReprioritizationRules(): ReprioritizationRule[] {
  return reprioritizationRules.map(r => ({
    ...r,
    condition: r.condition, // Keep the function reference
  }));
}

export function setReprioritizationEnabled(enabled: boolean): void {
  reprioritizationEnabled = enabled;
}

export function isReprioritizationEnabled(): boolean {
  return reprioritizationEnabled;
}

// ── Reprioritization Engine ──────────────────────────────────────────────────

export function runReprioritization(): ReprioritizationEvent[] {
  if (!reprioritizationEnabled) return [];
  initDefaultRules();

  const events: ReprioritizationEvent[] = [];
  const activeGoals = listGoals("active");

  for (const goal of activeGoals) {
    for (const rule of reprioritizationRules) {
      if (!rule.enabled) continue;

      try {
        if (rule.condition(goal)) {
          // Only apply if it actually changes priority
          if (goal.priority === rule.newPriority) continue;

          // Don't demote critical goals unless explicitly allowed
          if (PRIORITY_ORDER[goal.priority] > PRIORITY_ORDER[rule.newPriority] && goal.priority === "critical") continue;

          const event: ReprioritizationEvent = {
            goalId: goal.id,
            goalTitle: goal.title,
            oldPriority: goal.priority,
            newPriority: rule.newPriority,
            rule: rule.name,
            reason: rule.reason,
            timestamp: Date.now(),
          };

          // Apply the change
          goal.priority = rule.newPriority;
          events.push(event);
          reprioritizationHistory.push(event);

          // Only apply one rule per goal per cycle (highest priority rule wins)
          break;
        }
      } catch {
        // Rule evaluation failed — skip silently
      }
    }
  }

  // Keep history bounded
  if (reprioritizationHistory.length > 500) {
    reprioritizationHistory.splice(0, reprioritizationHistory.length - 500);
  }

  return events;
}

/**
 * Smart sort: returns goals in optimal execution order based on
 * priority, progress, dependencies, and staleness.
 */
export function getOptimalGoalOrder(): Goal[] {
  const active = listGoals("active");

  return active.sort((a, b) => {
    // 1. Priority (critical first)
    const priDiff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
    if (priDiff !== 0) return priDiff;

    // 2. Near-completion goals first (>70% done)
    if (a.progress >= 70 && b.progress < 70) return -1;
    if (b.progress >= 70 && a.progress < 70) return 1;

    // 3. Goals with fewer blocking checkpoints first
    const aPending = getPendingCheckpoints(a.id).length;
    const bPending = getPendingCheckpoints(b.id).length;
    if (aPending !== bPending) return aPending - bPending;

    // 4. Older goals first (FIFO within same priority)
    return a.createdAt - b.createdAt;
  });
}

export function getReprioritizationHistory(limit: number = 50): ReprioritizationEvent[] {
  return reprioritizationHistory.slice(-limit);
}

export function getReprioritizationStats(): {
  totalEvents: number;
  escalations: number;
  demotions: number;
  rulesFired: Record<string, number>;
} {
  const rulesFired: Record<string, number> = {};
  let escalations = 0;
  let demotions = 0;

  for (const event of reprioritizationHistory) {
    rulesFired[event.rule] = (rulesFired[event.rule] || 0) + 1;
    if (PRIORITY_ORDER[event.newPriority] > PRIORITY_ORDER[event.oldPriority]) escalations++;
    else demotions++;
  }

  return {
    totalEvents: reprioritizationHistory.length,
    escalations,
    demotions,
    rulesFired,
  };
}

// ─── v5.15: Database Persistence Layer ───────────────────────────────────────
// Goals are now persisted to the database so they survive server restarts.
// The in-memory Map is still the primary store for speed, but every mutation
// is synced to the DB asynchronously. On startup, goals are loaded from DB.

import { getDb } from "./db";

/**
 * Persist a goal to the database. Called after every mutation.
 * Runs asynchronously — does not block the caller.
 */
async function persistGoal(goal: Goal): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return; // DB not available, in-memory only

    // Upsert: insert or update on conflict
    const sql = `
      INSERT INTO goals (id, title, description, status, priority, category, parentGoalId, metadata, progress, errorLog, createdAt, updatedAt, completedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FROM_UNIXTIME(? / 1000), NOW(), ${goal.completedAt ? 'FROM_UNIXTIME(? / 1000)' : 'NULL'})
      ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        description = VALUES(description),
        status = VALUES(status),
        priority = VALUES(priority),
        metadata = VALUES(metadata),
        progress = VALUES(progress),
        errorLog = VALUES(errorLog),
        updatedAt = NOW(),
        completedAt = ${goal.completedAt ? 'VALUES(completedAt)' : 'completedAt'}
    `;

    const params: any[] = [
      goal.id,
      goal.title,
      goal.description,
      goal.status === "active" ? "in_progress" : goal.status === "checkpoint" ? "pending" : goal.status,
      goal.priority,
      goal.metadata?.category || null,
      null, // parentGoalId — top-level goals don't have parents
      JSON.stringify({
        successCriteria: goal.successCriteria,
        subGoals: goal.subGoals,
        checkpoints: goal.checkpoints,
        learnings: goal.learnings,
        totalSteps: goal.totalSteps,
        completedSteps: goal.completedSteps,
        scheduledTaskId: goal.scheduledTaskId,
        ...goal.metadata,
      }),
      goal.progress,
      goal.subGoals.filter(sg => sg.error).map(sg => `[${sg.title}]: ${sg.error}`).join("\n") || null,
      goal.createdAt,
    ];

    if (goal.completedAt) params.push(goal.completedAt);

    // Use raw SQL via drizzle's execute
    await (db as any).execute(sql, params);
  } catch (err) {
    // Non-fatal: log and continue with in-memory only
    console.warn("[GoalManager] Failed to persist goal to DB:", (err as Error).message);
  }
}

/**
 * Delete a goal from the database.
 */
async function deleteGoalFromDb(goalId: string): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await (db as any).execute("DELETE FROM goals WHERE id = ?", [goalId]);
  } catch (err) {
    console.warn("[GoalManager] Failed to delete goal from DB:", (err as Error).message);
  }
}

/**
 * Load all goals from the database into the in-memory Map.
 * Called once on server startup.
 */
export async function loadGoalsFromDb(): Promise<number> {
  try {
    const db = await getDb();
    if (!db) return 0;

    const rows: any[] = await (db as any).execute("SELECT * FROM goals ORDER BY createdAt DESC LIMIT 500");
    if (!rows || !Array.isArray(rows) || rows.length === 0) return 0;

    let loaded = 0;
    for (const row of rows) {
      // Skip if already in memory (shouldn't happen on fresh start)
      if (goals.has(row.id)) continue;

      const metadata = typeof row.metadata === "string" ? JSON.parse(row.metadata) : (row.metadata || {});

      const goal: Goal = {
        id: row.id,
        title: row.title,
        description: row.description || "",
        status: row.status === "in_progress" ? "active" : (row.status || "pending"),
        priority: row.priority || "medium",
        successCriteria: metadata.successCriteria || [],
        subGoals: metadata.subGoals || [],
        checkpoints: metadata.checkpoints || [],
        progress: row.progress || 0,
        createdAt: new Date(row.createdAt).getTime(),
        startedAt: row.status === "in_progress" ? new Date(row.createdAt).getTime() : undefined,
        completedAt: row.completedAt ? new Date(row.completedAt).getTime() : undefined,
        scheduledTaskId: metadata.scheduledTaskId,
        metadata: metadata,
        learnings: metadata.learnings || [],
        totalSteps: metadata.totalSteps || 0,
        completedSteps: metadata.completedSteps || 0,
      };

      goals.set(goal.id, goal);
      loaded++;
    }

    if (loaded > 0) {
      console.log(`[GoalManager] Loaded ${loaded} goals from database`);
    }
    return loaded;
  } catch (err) {
    console.warn("[GoalManager] Failed to load goals from DB:", (err as Error).message);
    return 0;
  }
}

// ─── Monkey-patch CRUD functions to add persistence ──────────────────────────
// Wrap the original createGoal to also persist

const ___originalCreateGoal = createGoal;
// We can't re-export, so we hook into the emitEvent function to trigger persistence
// Instead, we'll use a post-mutation hook pattern:

/**
 * Call this after any goal mutation to sync to DB.
 * Usage: after createGoal, startGoal, completeGoal, etc.
 */
export function syncGoalToDb(goalId: string): void {
  const goal = goals.get(goalId);
  if (goal) {
    persistGoal(goal).catch(() => {}); // fire-and-forget
  }
}

/**
 * Call this after deleteGoal to remove from DB.
 */
export function syncGoalDeletion(goalId: string): void {
  deleteGoalFromDb(goalId).catch(() => {}); // fire-and-forget
}

// Override emitEvent to auto-persist on every state change
const _originalEmitEvent = emitEvent;
const __emitEventWithPersist = (event: Omit<GoalEvent, "timestamp">): GoalEvent => {
  const result = _originalEmitEvent(event);
  // Auto-persist the goal after any event
  const goal = goals.get(event.goalId);
  if (goal) {
    persistGoal(goal).catch(() => {});
  }
  return result;
};

// Replace the module-level emitEvent reference
// Note: Since emitEvent is a const function, we need to use a different approach.
// Instead, we'll export a startup hook that patches the persistence in.

/**
 * Initialize goal persistence. Call this on server startup after DB is ready.
 */
export async function initGoalPersistence(): Promise<void> {
  // Load existing goals from DB
  await loadGoalsFromDb();
  _persistenceEnabled = true;
  console.log("[GoalManager] Persistence layer initialized — all mutations will be synced to DB");
}
