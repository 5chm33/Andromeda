/**
 * recursiveGoals.ts — v5.17
 *
 * Recursive Self-Improvement Goals & Meta-Cognition Module.
 *
 * Implements meta-goals — goals about improving the system itself:
 * - "Improve the self-improvement pipeline"
 * - "Reduce error rates in module X"
 * - "Optimize response latency"
 * - "Expand capability coverage"
 *
 * This module:
 * 1. Scans the codebase for improvement opportunities
 * 2. Creates prioritized self-improvement goals
 * 3. Decomposes them into actionable sub-goals
 * 4. Tracks progress and learns from outcomes
 * 5. Recursively improves its own improvement process (meta-meta)
 *
 * The key insight: the system can set goals to improve any part of itself,
 * including the goal-setting system, creating a recursive improvement loop.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MetaGoal {
  id: string;
  type: "self_improvement" | "performance" | "reliability" | "capability" | "meta";
  title: string;
  description: string;
  rationale: string; // Why this goal matters
  priority: number; // 1-10, higher = more important
  status: "planned" | "active" | "in_progress" | "completed" | "failed" | "deferred";
  subGoals: SubGoal[];
  metrics: GoalMetric[];
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  outcome?: string;
  lessonsLearned?: string[];
  recursive: boolean; // Is this a meta-goal (improving the improver)?
}

export interface SubGoal {
  id: string;
  parentId: string;
  title: string;
  description: string;
  targetFile?: string; // Which file to modify
  estimatedEffort: "trivial" | "small" | "medium" | "large" | "epic";
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  result?: string;
  completedAt?: number;
}

export interface GoalMetric {
  name: string;
  baseline: number; // Value before improvement
  target: number; // Target value
  current: number; // Current value
  unit: string;
  direction: "increase" | "decrease"; // Which direction is better
}

export interface ImprovementScan {
  timestamp: number;
  modulesScanned: number;
  issuesFound: number;
  goalsGenerated: number;
  categories: Record<string, number>;
}

// ─── State ────────────────────────────────────────────────────────────────────

function getServerDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function getGoalsStorePath(): string {
  const workspaceDir = path.resolve(process.cwd(), "workspace");
  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });
  return path.join(workspaceDir, ".andromeda_meta_goals.json");
}

interface GoalStore {
  goals: MetaGoal[];
  scans: ImprovementScan[];
  _version: string;
  _lastUpdated: string;
}

function loadGoalStore(): GoalStore {
  const p = getGoalsStorePath();
  if (!fs.existsSync(p)) return { goals: [], scans: [], _version: "5.17.0", _lastUpdated: new Date().toISOString() };
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as GoalStore;
  } catch {
    return { goals: [], scans: [], _version: "5.17.0", _lastUpdated: new Date().toISOString() };
  }
}

function saveGoalStore(store: GoalStore): void {
  store._lastUpdated = new Date().toISOString();
  store._version = "5.17.0";
  fs.writeFileSync(getGoalsStorePath(), JSON.stringify(store, null, 2), "utf-8");
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Pre-defined Meta-Goal Templates ──────────────────────────────────────────

const META_GOAL_TEMPLATES: Array<Omit<MetaGoal, "id" | "createdAt" | "subGoals" | "metrics" | "status">> = [
  {
    type: "meta",
    title: "Improve the Self-Improvement Pipeline",
    description: "Make the self-improvement system faster, safer, and more autonomous",
    rationale: "The self-improvement pipeline is the foundation of autonomy. Improving it has compounding returns.",
    priority: 10,
    recursive: true,
  },
  {
    type: "performance",
    title: "Reduce Response Latency",
    description: "Optimize LLM calls, caching, and processing to reduce end-to-end response time",
    rationale: "Faster responses improve user experience and enable more iterations per session",
    priority: 8,
    recursive: false,
  },
  {
    type: "reliability",
    title: "Achieve Zero-Downtime Self-Modification",
    description: "Ensure self-improvements can be applied without service interruption",
    rationale: "Downtime during self-improvement breaks the autonomous loop",
    priority: 9,
    recursive: true,
  },
  {
    type: "capability",
    title: "Expand Tool Coverage",
    description: "Add new tools and capabilities based on usage patterns and user needs",
    rationale: "More tools = more problems solvable = higher utility",
    priority: 7,
    recursive: false,
  },
  {
    type: "self_improvement",
    title: "Reduce TypeScript Errors After Self-Modification",
    description: "Improve the proposal generation to produce changes that pass type checking on first attempt",
    rationale: "Type errors after self-modification waste cycles and reduce confidence in auto-apply",
    priority: 8,
    recursive: true,
  },
  {
    type: "reliability",
    title: "Improve Test Coverage for Critical Paths",
    description: "Generate and maintain tests for all critical system paths",
    rationale: "Higher test coverage enables more confident auto-application of changes",
    priority: 7,
    recursive: false,
  },
  {
    type: "performance",
    title: "Optimize Context Window Utilization",
    description: "Ensure maximum useful information per token in LLM context",
    rationale: "Better context utilization = better responses with same cost",
    priority: 6,
    recursive: false,
  },
  {
    type: "meta",
    title: "Improve Goal Decomposition Quality",
    description: "Make the goal decomposition system produce more actionable, well-scoped sub-goals",
    rationale: "Better decomposition leads to better execution of all other goals",
    priority: 9,
    recursive: true,
  },
];

// ─── Core Functions ───────────────────────────────────────────────────────────

/**
 * Create a new meta-goal from a template or custom definition.
 */
// v5.32: Meta-meta guard — protected modules that recursive goals cannot modify
const PROTECTED_MODULES = new Set([
  "recursiveGoals.ts",
  "selfImproveGuard.ts",
  "consensusEngine.ts",
  "sandboxVerifier.ts",
  "selfModify.ts", // The modification engine itself
]);

const MAX_ACTIVE_RECURSIVE_GOALS = 3; // Prevent runaway recursive goal creation
const _RECURSIVE_DEPTH_LIMIT = 3; // Max depth of meta-meta-meta goals

function checkMetaMetaGuard(input: { recursive?: boolean; subGoals?: Array<{ targetFile?: string }> }, store: GoalStore): string | null {
  // Guard 1: Check if any sub-goals target protected modules
  if (input.subGoals) {
    for (const sg of input.subGoals) {
      if (sg.targetFile) {
        const fileName = sg.targetFile.split("/").pop() || "";
        if (PROTECTED_MODULES.has(fileName)) {
          return `Meta-meta guard: Cannot create goal targeting protected module '${fileName}'. ` +
            `Protected modules (${Array.from(PROTECTED_MODULES).join(", ")}) can only be modified manually.`;
        }
      }
    }
  }

  // Guard 2: Limit active recursive goals to prevent infinite loops
  if (input.recursive) {
    const activeRecursive = store.goals.filter(g => g.recursive && (g.status === "active" || g.status === "in_progress"));
    if (activeRecursive.length >= MAX_ACTIVE_RECURSIVE_GOALS) {
      return `Meta-meta guard: Maximum ${MAX_ACTIVE_RECURSIVE_GOALS} active recursive goals reached. ` +
        `Complete or defer existing recursive goals before creating new ones.`;
    }
  }

  return null; // No guard violation
}

export function createMetaGoal(input: {
  type: MetaGoal["type"];
  title: string;
  description: string;
  rationale: string;
  priority?: number;
  recursive?: boolean;
  subGoals?: Array<{ title: string; description: string; targetFile?: string; estimatedEffort?: SubGoal["estimatedEffort"] }>;
  metrics?: Array<{ name: string; baseline: number; target: number; unit: string; direction: "increase" | "decrease" }>;
}): MetaGoal {
  const store = loadGoalStore();

  // v5.32: Meta-meta guard check
  const guardViolation = checkMetaMetaGuard(input, store);
  if (guardViolation) {
    console.warn(`[RecursiveGoals] ${guardViolation}`);
    // Return a "deferred" goal instead of throwing — graceful degradation
    return {
      id: generateId("mgoal"),
      type: input.type,
      title: `[BLOCKED] ${input.title}`,
      description: guardViolation,
      rationale: input.rationale,
      priority: 0,
      status: "deferred",
      recursive: input.recursive ?? false,
      createdAt: Date.now(),
      subGoals: [],
      metrics: [],
      lessonsLearned: [guardViolation],
    };
  }

  const goal: MetaGoal = {
    id: generateId("mgoal"),
    type: input.type,
    title: input.title,
    description: input.description,
    rationale: input.rationale,
    priority: input.priority ?? 5,
    status: "planned",
    recursive: input.recursive ?? false,
    createdAt: Date.now(),
    subGoals: (input.subGoals || []).map((sg, i) => ({
      id: generateId(`sg${i}`),
      parentId: "", // Will be set below
      title: sg.title,
      description: sg.description,
      targetFile: sg.targetFile,
      estimatedEffort: sg.estimatedEffort || "medium",
      status: "pending" as const,
    })),
    metrics: (input.metrics || []).map(m => ({
      name: m.name,
      baseline: m.baseline,
      target: m.target,
      current: m.baseline,
      unit: m.unit,
      direction: m.direction,
    })),
  };

  // Set parent IDs
  for (const sg of goal.subGoals) {
    sg.parentId = goal.id;
  }

  store.goals.push(goal);
  saveGoalStore(store);
  return goal;
}

/**
 * Scan the codebase and generate improvement goals automatically.
 * This is the "meta-cognition" function — the system thinking about what to improve.
 */
export function scanForImprovementOpportunities(): {
  goals: MetaGoal[];
  scan: ImprovementScan;
} {
  const store = loadGoalStore();
  const serverDir = getServerDir();
  const generatedGoals: MetaGoal[] = [];

  let modulesScanned = 0;
  let issuesFound = 0;
  const categories: Record<string, number> = {};

  // Scan server modules for improvement opportunities
  const serverFiles = fs.readdirSync(serverDir).filter(f => f.endsWith(".ts"));
  modulesScanned = serverFiles.length;

  for (const file of serverFiles) {
    const filePath = path.join(serverDir, file);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      // Check for TODO/FIXME/HACK comments
      const todoLines = lines.filter(l => /\/\/\s*(TODO|FIXME|HACK|XXX)/i.test(l));
      if (todoLines.length > 0) {
        issuesFound += todoLines.length;
        categories["todo_comments"] = (categories["todo_comments"] || 0) + todoLines.length;
      }

      // Check for large functions (>100 lines)
      const functionMatches = content.match(/(?:export\s+)?(?:async\s+)?function\s+\w+/g) || [];
      // Rough heuristic: if file is large and has few functions, functions are too big
      if (lines.length > 500 && functionMatches.length < 5) {
        issuesFound++;
        categories["large_functions"] = (categories["large_functions"] || 0) + 1;
      }

      // Check for any/unknown type usage
      const anyUsage = (content.match(/:\s*any\b/g) || []).length;
      if (anyUsage > 10) {
        issuesFound++;
        categories["weak_typing"] = (categories["weak_typing"] || 0) + 1;
      }

      // Check for error handling gaps (catch blocks that just log)
      const catchBlocks = content.match(/catch\s*\([^)]*\)\s*\{[^}]*console\.(warn|error|log)[^}]*\}/g) || [];
      if (catchBlocks.length > 3) {
        issuesFound++;
        categories["poor_error_handling"] = (categories["poor_error_handling"] || 0) + 1;
      }

      // Check for hardcoded values
      const hardcoded = (content.match(/(?:timeout|interval|limit|max|min)\s*[:=]\s*\d{4,}/g) || []).length;
      if (hardcoded > 3) {
        issuesFound++;
        categories["hardcoded_values"] = (categories["hardcoded_values"] || 0) + 1;
      }
    } catch { /* skip unreadable files */ }
  }

  // Generate goals based on findings
  if (categories["todo_comments"] && categories["todo_comments"] > 5) {
    const goal = createMetaGoal({
      type: "self_improvement",
      title: "Resolve Outstanding TODO Comments",
      description: `Found ${categories["todo_comments"]} TODO/FIXME/HACK comments across the codebase. These represent known technical debt.`,
      rationale: "Reducing technical debt improves maintainability and reduces bug surface area",
      priority: 5,
      recursive: false,
    });
    generatedGoals.push(goal);
  }

  if (categories["weak_typing"]) {
    const goal = createMetaGoal({
      type: "reliability",
      title: "Strengthen Type Safety",
      description: `Found ${categories["weak_typing"]} modules with excessive 'any' type usage. Replace with proper types.`,
      rationale: "Stronger types catch bugs at compile time and improve self-modification safety",
      priority: 6,
      recursive: false,
    });
    generatedGoals.push(goal);
  }

  if (categories["poor_error_handling"]) {
    const goal = createMetaGoal({
      type: "reliability",
      title: "Improve Error Handling Patterns",
      description: `Found ${categories["poor_error_handling"]} modules with catch blocks that only log errors without recovery.`,
      rationale: "Better error handling enables self-healing and prevents silent failures",
      priority: 7,
      recursive: false,
    });
    generatedGoals.push(goal);
  }

  if (categories["hardcoded_values"]) {
    const goal = createMetaGoal({
      type: "self_improvement",
      title: "Extract Hardcoded Configuration Values",
      description: `Found ${categories["hardcoded_values"]} modules with hardcoded numeric constants that should be configurable.`,
      rationale: "Configurable values enable runtime tuning and self-optimization",
      priority: 4,
      recursive: false,
    });
    generatedGoals.push(goal);
  }

  // Record the scan
  const scan: ImprovementScan = {
    timestamp: Date.now(),
    modulesScanned,
    issuesFound,
    goalsGenerated: generatedGoals.length,
    categories,
  };

  store.scans.push(scan);
  if (store.scans.length > 50) store.scans.shift();
  saveGoalStore(store);

  return { goals: generatedGoals, scan };
}

/**
 * Get the next actionable goal to work on (highest priority active goal).
 */
export function getNextGoal(): MetaGoal | null {
  const store = loadGoalStore();
  const activeGoals = store.goals
    .filter(g => g.status === "planned" || g.status === "active")
    .sort((a, b) => b.priority - a.priority);

  return activeGoals[0] || null;
}

/**
 * Start working on a goal.
 */
export function activateGoal(goalId: string): boolean {
  const store = loadGoalStore();
  const goal = store.goals.find(g => g.id === goalId);
  if (!goal) return false;

  goal.status = "active";
  goal.startedAt = Date.now();
  saveGoalStore(store);
  return true;
}

/**
 * Complete a sub-goal.
 */
export function completeSubGoal(goalId: string, subGoalId: string, result: string): boolean {
  const store = loadGoalStore();
  const goal = store.goals.find(g => g.id === goalId);
  if (!goal) return false;

  const subGoal = goal.subGoals.find(sg => sg.id === subGoalId);
  if (!subGoal) return false;

  subGoal.status = "completed";
  subGoal.result = result;
  subGoal.completedAt = Date.now();

  // Check if all sub-goals are done
  const allDone = goal.subGoals.every(sg => sg.status === "completed" || sg.status === "skipped");
  if (allDone) {
    goal.status = "completed";
    goal.completedAt = Date.now();
  } else {
    goal.status = "in_progress";
  }

  saveGoalStore(store);
  return true;
}

/**
 * Complete a goal with outcome and lessons learned.
 */
export function completeGoal(goalId: string, outcome: string, lessons?: string[]): boolean {
  const store = loadGoalStore();
  const goal = store.goals.find(g => g.id === goalId);
  if (!goal) return false;

  goal.status = "completed";
  goal.completedAt = Date.now();
  goal.outcome = outcome;
  goal.lessonsLearned = lessons || [];
  saveGoalStore(store);
  return true;
}

/**
 * Fail a goal with reason.
 */
export function failGoal(goalId: string, reason: string): boolean {
  const store = loadGoalStore();
  const goal = store.goals.find(g => g.id === goalId);
  if (!goal) return false;

  goal.status = "failed";
  goal.outcome = `Failed: ${reason}`;
  saveGoalStore(store);
  return true;
}

/**
 * Update a metric for a goal.
 */
export function updateMetric(goalId: string, metricName: string, currentValue: number): boolean {
  const store = loadGoalStore();
  const goal = store.goals.find(g => g.id === goalId);
  if (!goal) return false;

  const metric = goal.metrics.find(m => m.name === metricName);
  if (!metric) return false;

  metric.current = currentValue;
  saveGoalStore(store);
  return true;
}

/**
 * List all meta-goals with optional filtering.
 */
export function listMetaGoals(filter?: { status?: MetaGoal["status"]; type?: MetaGoal["type"]; recursive?: boolean }): MetaGoal[] {
  const store = loadGoalStore();
  let goals = store.goals;

  if (filter?.status) goals = goals.filter(g => g.status === filter.status);
  if (filter?.type) goals = goals.filter(g => g.type === filter.type);
  if (filter?.recursive !== undefined) goals = goals.filter(g => g.recursive === filter.recursive);

  return goals.sort((a, b) => b.priority - a.priority);
}

/**
 * Get improvement progress summary.
 */
export function getImprovementProgress(): {
  totalGoals: number;
  completed: number;
  active: number;
  failed: number;
  completionRate: number;
  recentScans: ImprovementScan[];
  topPriorities: MetaGoal[];
  recursiveGoals: MetaGoal[];
} {
  const store = loadGoalStore();
  const completed = store.goals.filter(g => g.status === "completed").length;
  const active = store.goals.filter(g => g.status === "active" || g.status === "in_progress").length;
  const failed = store.goals.filter(g => g.status === "failed").length;

  return {
    totalGoals: store.goals.length,
    completed,
    active,
    failed,
    completionRate: store.goals.length > 0 ? completed / store.goals.length : 0,
    recentScans: store.scans.slice(-5),
    topPriorities: store.goals
      .filter(g => g.status === "planned" || g.status === "active")
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 5),
    recursiveGoals: store.goals.filter(g => g.recursive),
  };
}

/**
 * Seed the system with initial meta-goals from templates.
 */
export function seedMetaGoals(): MetaGoal[] {
  const store = loadGoalStore();

  // Don't seed if goals already exist
  if (store.goals.length > 0) return [];

  const seeded: MetaGoal[] = [];
  for (const template of META_GOAL_TEMPLATES) {
    const goal = createMetaGoal({
      type: template.type,
      title: template.title,
      description: template.description,
      rationale: template.rationale,
      priority: template.priority,
      recursive: template.recursive,
    });
    seeded.push(goal);
  }

  return seeded;
}

/**
 * Initialize the recursive goals system.
 */
export function initRecursiveGoals(): void {
  const store = loadGoalStore();
  if (store.goals.length === 0) {
    seedMetaGoals();
    console.log("[RecursiveGoals] Seeded initial meta-goals from templates.");
  }
  console.log(`[RecursiveGoals] Initialized. ${store.goals.length} meta-goals tracked.`);
}

// ─── v5.27: Auto-Execute Goals ──────────────────────────────────────────────

/**
 * v5.28: Fully operational goal execution engine.
 * Decomposes goals into sub-goals, targets specific files,
 * runs proposals through the test pipeline, and commits on success.
 */
// v5.29: Recursion and TTL limits to prevent infinite loops
const MAX_ACTIVE_GOALS = 5;
const GOAL_TTL_MS = 4 * 60 * 60 * 1000; // v10.3: 4 hours max per goal (was 30min — too short for LLM-backed sub-goals)
// v6.16: Increased from 60s to 15min — the orchestrator calls this every 60s but
// actual goal execution (which calls analyzeAndPropose → LLM) should be infrequent.
// With DeepSeek routing, each analyzeAndPropose call costs ~$0.001 — 15min interval
// means max 4 LLM calls/hour for goal execution, not 60.
const MIN_CYCLE_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes between actual executions
let lastExecutionTime = 0;

export async function autoExecuteNextGoal(): Promise<{
  executed: boolean;
  goalId?: string;
  result?: string;
  subGoalsProcessed?: number;
  subGoalsCompleted?: number;
}> {
  // v5.29: Rate limiting — prevent rapid-fire execution
  const now = Date.now();
  if (now - lastExecutionTime < MIN_CYCLE_INTERVAL_MS) {
    return { executed: false, result: "Rate limited — too soon since last execution" };
  }
  lastExecutionTime = now;

  // v5.29: Check recursion depth — limit concurrent active goals
  const store = loadGoalStore();
  const activeGoals = store.goals.filter(g => g.status === "active" || g.status === "in_progress");
  if (activeGoals.length >= MAX_ACTIVE_GOALS) {
    // v6.15: Suppressed — fires every cycle, not actionable
    return { executed: false, result: `Max recursion depth: ${activeGoals.length} goals active` };
  }

  // v5.29: TTL enforcement — expire stale goals
  for (const goal of activeGoals) {
    const goalAge = now - (goal.startedAt || goal.createdAt);
    if (goalAge > GOAL_TTL_MS) {
      goal.status = "failed";
      goal.outcome = `TTL exceeded (${Math.round(goalAge / 60000)}min > ${Math.round(GOAL_TTL_MS / 60000)}min limit)`;
      console.log(`[RecursiveGoals] Goal TTL expired: ${goal.title}`);
    }
  }
  saveGoalStore(store);

  const nextGoal = getNextGoal();
  if (!nextGoal) {
    return { executed: false, result: "No pending goals" };
  }

  // Activate the goal
  activateGoal(nextGoal.id);
  // v6.16: Only log when actually doing work (not on every orchestrator cycle)
  console.log(`[RecursiveGoals] Starting goal execution: ${nextGoal.title} (${nextGoal.type})`);

  const goal = store.goals.find(g => g.id === nextGoal.id);
  if (!goal) return { executed: false, goalId: nextGoal.id, result: "Goal not found in store" };

  // If goal has no sub-goals, decompose it
  if (goal.subGoals.length === 0) {
    await decomposeGoalIntoSubGoals(goal);
    saveGoalStore(store);
  }

  // Process pending sub-goals
  const pendingSubGoals = goal.subGoals.filter(sg => sg.status === "pending");
  if (pendingSubGoals.length === 0) {
    // All sub-goals processed — check if goal is complete
    const allDone = goal.subGoals.every(sg => sg.status === "completed" || sg.status === "skipped");
    if (allDone) {
      goal.status = "completed";
      goal.completedAt = Date.now();
      goal.outcome = `All ${goal.subGoals.length} sub-goals completed`;
      saveGoalStore(store);
      return { executed: true, goalId: goal.id, result: "Goal completed — all sub-goals done" };
    }
    return { executed: false, goalId: goal.id, result: "No pending sub-goals (some may have failed)" };
  }

  let processed = 0;
  let completed = 0;

  try {
    const { analyzeAndPropose, listProposals, applyProposal, getAnalyzableFiles } = await import("./selfImprove");
    const { runPipeline } = await import("./selfTestPipeline");

    // Process up to 3 sub-goals per cycle
    const batch = pendingSubGoals.slice(0, 3);

    for (const subGoal of batch) {
      processed++;
      subGoal.status = "in_progress";
      saveGoalStore(store);

      try {
        // Determine target file
        let targetFile = subGoal.targetFile;
        if (!targetFile) {
          // Infer target from sub-goal description
          const allFiles = getAnalyzableFiles();
          targetFile = allFiles.find(f =>
            subGoal.description.toLowerCase().includes(f.split("/").pop()?.replace(".ts", "") || "")
          ) || allFiles[Math.floor(Math.random() * allFiles.length)];
        }

        if (!targetFile) {
          subGoal.status = "skipped";
          subGoal.result = "No target file identified";
          saveGoalStore(store);
          continue;
        }

        // Generate improvement proposal targeting this sub-goal
        console.log(`[RecursiveGoals] Sub-goal: "${subGoal.title}" → targeting ${targetFile}`);
        await analyzeAndPropose(targetFile);

        // Find proposals related to this sub-goal
        const proposals = listProposals("pending");
        if (proposals.length === 0) {
          subGoal.status = "skipped";
          subGoal.result = "No proposals generated for this target";
          saveGoalStore(store);
          continue;
        }

        // Run the best proposal through the test pipeline
        const proposal = proposals[0];
        const pipelineResult = await runPipeline({
          id: proposal.id,
          description: `Goal: ${subGoal.title}`,
          changes: [{
            filePath: targetFile,
            operation: "edit" as const,
            content: proposal.proposedContent || "",
          }],
          author: "self-improve",
          timestamp: Date.now(),
          priority: "medium",
        });

        if (pipelineResult.success) {
          // Apply the proposal
          const applyResult = await applyProposal(proposal.id);
          if (applyResult.success) {
            subGoal.status = "completed";
            subGoal.completedAt = Date.now();
            subGoal.result = applyResult.message;
            completed++;
            console.log(`[RecursiveGoals] ✓ Sub-goal completed: ${subGoal.title}`);
          } else {
            subGoal.status = "failed";
            subGoal.result = `Apply failed: ${applyResult.message}`;
          }
        } else {
          subGoal.status = "failed";
          subGoal.result = `Pipeline failed at ${pipelineResult.stage}: ${pipelineResult.error || pipelineResult.output}`;
        }

        saveGoalStore(store);
      } catch (err) {
        subGoal.status = "failed";
        subGoal.result = (err as Error).message;
        saveGoalStore(store);
      }
    }

    // Check if goal is now complete
    const allDone = goal.subGoals.every(sg => sg.status === "completed" || sg.status === "skipped");
    if (allDone) {
      goal.status = "completed";
      goal.completedAt = Date.now();
      goal.outcome = `Completed ${completed}/${goal.subGoals.length} sub-goals`;
      saveGoalStore(store);
    }

    // Record learning
    try {
      const { recordLearning } = await import("./selfKnowledgeBase");
      recordLearning({
        title: `Goal execution: ${goal.title}`,
        description: `Processed ${processed} sub-goals, ${completed} succeeded`,
        context: `Goal: ${goal.title} (${goal.type})`,
        outcome: completed > 0 ? "success" : "no progress",
        lesson: `Processed ${processed} sub-goals, ${completed} succeeded`,
        category: completed > 0 ? "success" : "antipattern",
        applicableTo: ["recursiveGoals", "selfImprove"],
      });
    } catch { /* non-critical */ }

    return {
      executed: completed > 0,
      goalId: goal.id,
      result: `Processed ${processed} sub-goals: ${completed} completed, ${processed - completed} failed/skipped`,
      subGoalsProcessed: processed,
      subGoalsCompleted: completed,
    };
  } catch (err) {
    console.error(`[RecursiveGoals] Auto-execute failed for ${nextGoal.id}:`, (err as Error).message);
    return { executed: false, goalId: nextGoal.id, result: (err as Error).message };
  }
}

/**
 * v5.28: Decompose a goal into actionable sub-goals based on its description.
 * Uses heuristics to identify target files and create concrete tasks.
 */
async function decomposeGoalIntoSubGoals(goal: MetaGoal): Promise<void> {
  const { getAnalyzableFiles } = await import("./selfImprove");
  const allFiles = getAnalyzableFiles();

  // Parse goal description for file references
  const mentionedFiles = allFiles.filter(f => {
    const basename = f.split("/").pop()?.replace(".ts", "").toLowerCase() || "";
    return goal.description.toLowerCase().includes(basename) ||
           goal.rationale.toLowerCase().includes(basename);
  });

  // If specific files mentioned, create sub-goals for each
  if (mentionedFiles.length > 0) {
    for (const file of mentionedFiles.slice(0, 5)) {
      goal.subGoals.push({
        id: `sg_${goal.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        parentId: goal.id,
        title: `Improve ${file.split("/").pop()} for: ${goal.title}`,
        description: `Analyze and improve ${file} to achieve: ${goal.description}`,
        targetFile: file,
        estimatedEffort: "medium",
        status: "pending",
      });
    }
  } else {
    // Generic decomposition: pick relevant files based on goal type
    const typeFileMap: Record<string, string[]> = {
      self_improvement: ["selfImprove.ts", "selfModify.ts", "selfHeal.ts"],
      performance: ["ai.ts", "streamRouter.ts", "tokenBudgetManager.ts"],
      reliability: ["selfHeal.ts", "gracefulDegradation.ts", "autoRollback.ts"],
      capability: ["reactEngine.ts", "multiAgent.ts", "fileEngine.ts"],
      meta: ["recursiveGoals.ts", "autonomyOrchestrator.ts", "selfModel.ts"],
    };

    const targetFiles = (typeFileMap[goal.type] || ["selfImprove.ts"])
      .map(f => allFiles.find(af => af.endsWith(f)))
      .filter(Boolean) as string[];

    for (const file of targetFiles) {
      goal.subGoals.push({
        id: `sg_${goal.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        parentId: goal.id,
        title: `Analyze ${file.split("/").pop()} for ${goal.type} improvements`,
        description: `${goal.description} — focus on ${file}`,
        targetFile: file,
        estimatedEffort: "medium",
        status: "pending",
      });
    }
  }

  console.log(`[RecursiveGoals] Decomposed "${goal.title}" into ${goal.subGoals.length} sub-goals`);
}

/**
 * Get stats for the goal system.
 */
export function getGoalStats() {
  const store = loadGoalStore();
  const byStatus: Record<string, number> = {};
  for (const goal of store.goals) {
    byStatus[goal.status] = (byStatus[goal.status] || 0) + 1;
  }
  return {
    totalGoals: store.goals.length,
    byStatus,
    nextGoal: getNextGoal()?.title || null,
  };
}
