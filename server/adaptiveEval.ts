/**
 * adaptiveEval.ts — v6.40
 *
 * Adaptive Evaluation System for Andromeda.
 *
 * Core capabilities:
 *   1. LLM-Generated Benchmarks — dynamically generate new eval tasks using an LLM
 *      based on observed capability gaps and historical performance patterns.
 *
 *   2. Dynamic Difficulty Scaling — automatically adjust task difficulty based on
 *      recent pass rates. If the system is acing easy tasks, generate harder ones.
 *      If it's failing hard tasks, generate scaffolded medium ones.
 *
 *   3. Eval Gap Analysis — identify which categories and difficulty levels have the
 *      lowest coverage or worst performance, then target those with new benchmarks.
 *
 *   4. Benchmark Evolution — track benchmark quality over time. Retire tasks that
 *      are always passed (too easy) or always failed (too hard / broken). Promote
 *      high-signal tasks to the permanent EVAL_TASKS pool.
 *
 *   5. Adaptive Eval Runs — run a dynamically selected subset of tasks weighted
 *      toward the system's current weak spots.
 *
 * Storage:
 *   data/adaptive_benchmarks.json  — generated benchmark tasks
 *   data/adaptive_eval_history.json — history of adaptive eval runs
 *   data/benchmark_evolution.json  — task lifecycle (active/retired/promoted)
 */

import * as fs from "fs";
import * as path from "path";
import { createLogger } from "./logger.js";
import { simpleChatCompletion } from "./llmProvider.js";
import type { EvalTask, EvalResult, EvalRun } from "./evalFramework.js";
import { EVAL_TASKS, runEvaluation } from "./evalFramework.js";

const log = createLogger("adaptiveEval");

// ── Types ──────────────────────────────────────────────────────────────────────

export type TaskLifecycle = "active" | "retired_easy" | "retired_hard" | "promoted";

export interface AdaptiveBenchmark extends EvalTask {
  /** How this task was generated */
  source: "llm_generated" | "gap_analysis" | "difficulty_scaled" | "federated";
  /** When this task was generated */
  generatedAt: number;
  /** Lifecycle state */
  lifecycle: TaskLifecycle;
  /** Number of times this task has been run */
  runCount: number;
  /** Number of times this task was passed */
  passCount: number;
  /** Average score across all runs */
  avgScore: number;
  /** Whether this task has been promoted to the permanent pool */
  promoted: boolean;
  /** Generation prompt used to create this task */
  generationContext?: string;
}

export interface GapAnalysis {
  /** Category with lowest recent pass rate */
  weakestCategory: EvalTask["category"];
  /** Difficulty level with lowest recent pass rate */
  weakestDifficulty: EvalTask["difficulty"];
  /** Categories sorted by pass rate (ascending — worst first) */
  categoryRanking: Array<{ category: EvalTask["category"]; passRate: number; taskCount: number }>;
  /** Difficulty levels sorted by pass rate */
  difficultyRanking: Array<{ difficulty: EvalTask["difficulty"]; passRate: number; taskCount: number }>;
  /** Recommended next difficulty to generate */
  recommendedDifficulty: EvalTask["difficulty"];
  /** Recommended categories to target */
  targetCategories: EvalTask["category"][];
  /** Overall system pass rate */
  overallPassRate: number;
  /** Timestamp of analysis */
  analyzedAt: number;
}

export interface AdaptiveEvalRun extends EvalRun {
  /** Whether this was an adaptive run */
  adaptive: true;
  /** Gap analysis that drove task selection */
  gapAnalysis: GapAnalysis;
  /** Number of LLM-generated tasks included */
  generatedTaskCount: number;
  /** Number of static tasks included */
  staticTaskCount: number;
  /** New tasks generated during this run */
  newTasksGenerated: number;
  /** Tasks retired during this run */
  tasksRetired: number;
  /** Tasks promoted during this run */
  tasksPromoted: number;
}

export interface BenchmarkEvolutionStats {
  totalGenerated: number;
  active: number;
  retiredEasy: number;
  retiredHard: number;
  promoted: number;
  avgPassRate: number;
  generationsByCategory: Record<string, number>;
  generationsByDifficulty: Record<string, number>;
  lastGeneratedAt: number | null;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(process.cwd(), "data");
const BENCHMARKS_FILE = path.join(DATA_DIR, "adaptive_benchmarks.json");
const HISTORY_FILE = path.join(DATA_DIR, "adaptive_eval_history.json");
const EVOLUTION_FILE = path.join(DATA_DIR, "benchmark_evolution.json");

/** Retire a task if it has been run ≥ this many times and pass rate is above EASY_THRESHOLD */
const RETIREMENT_MIN_RUNS = 5;
const EASY_RETIREMENT_THRESHOLD = 0.95; // 95%+ pass rate → too easy
const HARD_RETIREMENT_THRESHOLD = 0.10; // <10% pass rate → too hard / broken
const PROMOTION_MIN_RUNS = 8;
const PROMOTION_PASS_RATE = 0.55; // 55-85% pass rate → good signal task
const PROMOTION_MAX_PASS_RATE = 0.85;

// ── State ──────────────────────────────────────────────────────────────────────

let adaptiveBenchmarks: AdaptiveBenchmark[] = [];
let evalHistory: AdaptiveEvalRun[] = [];

// ── Persistence ────────────────────────────────────────────────────────────────

function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadBenchmarks(): void {
  try {
    if (fs.existsSync(BENCHMARKS_FILE)) {
      adaptiveBenchmarks = JSON.parse(fs.readFileSync(BENCHMARKS_FILE, "utf-8"));
      log.info(`[adaptiveEval] Loaded ${adaptiveBenchmarks.length} adaptive benchmarks`);
    }
  } catch (err) {
    log.warn(`[adaptiveEval] Failed to load benchmarks: ${(err as Error).message}`);
    adaptiveBenchmarks = [];
  }
}

function saveBenchmarks(): void {
  ensureDataDir();
  fs.writeFileSync(BENCHMARKS_FILE, JSON.stringify(adaptiveBenchmarks, null, 2), "utf-8");
}

function loadHistory(): void {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      evalHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8"));
    }
  } catch {
    evalHistory = [];
  }
}

function saveHistory(): void {
  ensureDataDir();
  // Keep last 50 runs
  if (evalHistory.length > 50) evalHistory = evalHistory.slice(-50);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(evalHistory, null, 2), "utf-8");
}

// ── Gap Analysis ───────────────────────────────────────────────────────────────

/**
 * Analyze recent eval history to identify capability gaps.
 * Returns a structured gap analysis used to drive benchmark generation.
 */
export function analyzeGaps(recentRuns?: EvalRun[]): GapAnalysis {
  // Use provided runs or load from history
  const runs = recentRuns ?? evalHistory.slice(-10);

  // Aggregate results by category and difficulty
  const catStats: Record<string, { pass: number; total: number }> = {};
  const diffStats: Record<string, { pass: number; total: number }> = {};

  const allCategories: EvalTask["category"][] = ["reasoning", "code", "tool_use", "self_knowledge", "multi_step"];
  const allDifficulties: EvalTask["difficulty"][] = ["easy", "medium", "hard"];

  // Initialize with zeros
  for (const cat of allCategories) catStats[cat] = { pass: 0, total: 0 };
  for (const diff of allDifficulties) diffStats[diff] = { pass: 0, total: 0 };

  // Build a lookup of task category/difficulty from EVAL_TASKS + adaptive benchmarks
  const taskMeta = new Map<string, { category: EvalTask["category"]; difficulty: EvalTask["difficulty"] }>();
  for (const t of EVAL_TASKS) taskMeta.set(t.id, { category: t.category, difficulty: t.difficulty });
  for (const t of adaptiveBenchmarks) taskMeta.set(t.id, { category: t.category, difficulty: t.difficulty });

  let totalPass = 0;
  let totalTasks = 0;

  for (const run of runs) {
    for (const result of run.results) {
      const meta = taskMeta.get(result.taskId);
      if (!meta) continue;

      catStats[meta.category].total++;
      diffStats[meta.difficulty].total++;
      totalTasks++;

      if (result.passed) {
        catStats[meta.category].pass++;
        diffStats[meta.difficulty].pass++;
        totalPass++;
      }
    }
  }

  // Sort categories by pass rate (worst first)
  const categoryRanking = allCategories
    .filter(cat => catStats[cat].total > 0)
    .map(cat => ({
      category: cat,
      passRate: catStats[cat].pass / catStats[cat].total,
      taskCount: catStats[cat].total,
    }))
    .sort((a, b) => a.passRate - b.passRate);

  // Sort difficulties by pass rate
  const difficultyRanking = allDifficulties
    .filter(diff => diffStats[diff].total > 0)
    .map(diff => ({
      difficulty: diff,
      passRate: diffStats[diff].pass / diffStats[diff].total,
      taskCount: diffStats[diff].total,
    }))
    .sort((a, b) => a.passRate - b.passRate);

  const overallPassRate = totalTasks > 0 ? totalPass / totalTasks : 0.5;

  // Determine recommended difficulty based on overall pass rate
  let recommendedDifficulty: EvalTask["difficulty"];
  if (overallPassRate > 0.85) {
    recommendedDifficulty = "hard"; // System is doing well — push harder
  } else if (overallPassRate < 0.40) {
    recommendedDifficulty = "easy"; // System is struggling — scaffold with easier tasks
  } else {
    recommendedDifficulty = "medium";
  }

  // Target worst 2 categories
  const targetCategories = categoryRanking.slice(0, 2).map(c => c.category);
  if (targetCategories.length === 0) {
    targetCategories.push("reasoning", "code");
  }

  return {
    weakestCategory: categoryRanking[0]?.category ?? "reasoning",
    weakestDifficulty: difficultyRanking[0]?.difficulty ?? "medium",
    categoryRanking,
    difficultyRanking,
    recommendedDifficulty,
    targetCategories,
    overallPassRate,
    analyzedAt: Date.now(),
  };
}

// ── LLM Benchmark Generation ───────────────────────────────────────────────────

/**
 * Generate new eval tasks using an LLM, targeting specific capability gaps.
 */
export async function generateBenchmarks(
  options: {
    count?: number;
    targetCategory?: EvalTask["category"];
    targetDifficulty?: EvalTask["difficulty"];
    gapAnalysis?: GapAnalysis;
    signal?: AbortSignal;
  } = {}
): Promise<AdaptiveBenchmark[]> {
  const {
    count = 3,
    gapAnalysis,
    signal,
  } = options;

  const gap = gapAnalysis ?? analyzeGaps();
  const targetCategory = options.targetCategory ?? gap.targetCategories[0] ?? "reasoning";
  const targetDifficulty = options.targetDifficulty ?? gap.recommendedDifficulty;

  log.info(`[adaptiveEval] Generating ${count} benchmark(s): category=${targetCategory}, difficulty=${targetDifficulty}`);

  const existingTaskSamples = EVAL_TASKS
    .filter(t => t.category === targetCategory)
    .slice(0, 3)
    .map(t => `- [${t.difficulty}] ${t.prompt.slice(0, 80)}...`)
    .join("\n");

  const systemPrompt = `You are an AI benchmark designer for Andromeda, a recursive self-improving AI system.
Your job is to generate high-quality evaluation tasks that test specific capabilities.

TASK REQUIREMENTS:
- Category: ${targetCategory}
- Difficulty: ${targetDifficulty}
- The task must have a clear, verifiable correct answer
- The prompt must be self-contained (no external resources needed)
- expectedKeywords: 2-5 words/phrases that a correct response MUST contain
- forbiddenKeywords: 1-3 hallucination markers or wrong answers to watch for
- scoreWeight: 1 (easy), 2 (medium), 3 (hard)

EXISTING TASKS IN THIS CATEGORY (for reference, do NOT duplicate):
${existingTaskSamples || "None yet"}

CURRENT SYSTEM WEAKNESS:
- Overall pass rate: ${(gap.overallPassRate * 100).toFixed(1)}%
- Weakest category: ${gap.weakestCategory}
- Generate tasks that probe the edges of current capability

OUTPUT FORMAT (JSON array, no markdown, no explanation):
[
  {
    "id": "gen_<unique_6char_id>",
    "category": "${targetCategory}",
    "difficulty": "${targetDifficulty}",
    "prompt": "<clear, specific question or task>",
    "expectedKeywords": ["keyword1", "keyword2"],
    "forbiddenKeywords": ["wrong_answer"],
    "maxTokens": 512,
    "timeoutMs": 30000,
    "scoreWeight": ${targetDifficulty === "easy" ? 1 : targetDifficulty === "medium" ? 2 : 3}
  }
]

Generate exactly ${count} task(s).`;

  let generated: AdaptiveBenchmark[] = [];

  try {
    const response = await simpleChatCompletion(
      [{ role: "user", content: systemPrompt }],
      { maxTokens: 2000, temperature: 0.8, signal }
    );

    // Extract JSON from response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON array found in LLM response");

    const parsed = JSON.parse(jsonMatch[0]) as Partial<EvalTask>[];

    generated = parsed
      .filter(t => t.id && t.prompt && t.expectedKeywords && t.category && t.difficulty)
      .map(t => ({
        id: `adp_${t.id ?? Math.random().toString(36).slice(2, 8)}`,
        category: (t.category as EvalTask["category"]) ?? targetCategory,
        difficulty: (t.difficulty as EvalTask["difficulty"]) ?? targetDifficulty,
        prompt: t.prompt!,
        expectedKeywords: t.expectedKeywords ?? [],
        forbiddenKeywords: t.forbiddenKeywords ?? [],
        maxTokens: t.maxTokens ?? 512,
        timeoutMs: t.timeoutMs ?? 30000,
        scoreWeight: t.scoreWeight ?? 2,
        source: "llm_generated" as const,
        generatedAt: Date.now(),
        lifecycle: "active" as TaskLifecycle,
        runCount: 0,
        passCount: 0,
        avgScore: 0,
        promoted: false,
        generationContext: `gap_analysis:${targetCategory}:${targetDifficulty}:passRate=${(gap.overallPassRate * 100).toFixed(0)}%`,
      }));

    log.info(`[adaptiveEval] Generated ${generated.length} new benchmark(s)`);
  } catch (err) {
    log.warn(`[adaptiveEval] Benchmark generation failed: ${(err as Error).message}`);
    // Fall back to template-based generation
    generated = generateTemplateBenchmarks(targetCategory, targetDifficulty, count);
  }

  // Add to pool
  adaptiveBenchmarks.push(...generated);
  saveBenchmarks();

  return generated;
}

/**
 * Template-based fallback benchmark generation (no LLM required).
 */
function generateTemplateBenchmarks(
  category: EvalTask["category"],
  difficulty: EvalTask["difficulty"],
  count: number
): AdaptiveBenchmark[] {
  const templates: Record<EvalTask["category"], Array<Partial<EvalTask>>> = {
    reasoning: [
      {
        prompt: "If all Bloops are Razzies and all Razzies are Lazzies, are all Bloops definitely Lazzies? Explain your reasoning.",
        expectedKeywords: ["yes", "lazzies", "transitive"],
        forbiddenKeywords: ["no", "not necessarily"],
      },
      {
        prompt: "A bat and ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost?",
        expectedKeywords: ["5 cents", "$0.05", "five cents"],
        forbiddenKeywords: ["10 cents", "$0.10"],
      },
      {
        prompt: "What is the next number in the sequence: 2, 6, 12, 20, 30, ?",
        expectedKeywords: ["42"],
        forbiddenKeywords: ["40", "36", "44"],
      },
    ],
    code: [
      {
        prompt: "Write a Python function that returns the nth Fibonacci number using dynamic programming (not recursion).",
        expectedKeywords: ["def", "fibonacci", "dp", "memo"],
        forbiddenKeywords: ["recursion", "recursive"],
      },
      {
        prompt: "What is the time complexity of binary search? Explain why.",
        expectedKeywords: ["O(log n)", "logarithmic", "halves"],
        forbiddenKeywords: ["O(n)", "linear", "O(n^2)"],
      },
    ],
    tool_use: [
      {
        prompt: "Describe the correct sequence of steps to safely read a file in Python, handling the case where the file might not exist.",
        expectedKeywords: ["try", "except", "FileNotFoundError", "open"],
        forbiddenKeywords: ["ignore", "skip error"],
      },
    ],
    self_knowledge: [
      {
        prompt: "What is recursive self-improvement (RSI) in the context of AI systems? What are its key risks?",
        expectedKeywords: ["self-improvement", "capability", "alignment", "safety"],
        forbiddenKeywords: ["impossible", "fictional"],
      },
    ],
    multi_step: [
      {
        prompt: "Plan the steps needed to deploy a web application: from code commit to production. List at least 5 distinct steps.",
        expectedKeywords: ["test", "build", "deploy", "monitor", "rollback"],
        forbiddenKeywords: ["skip testing", "no monitoring"],
      },
    ],
    browser: [
      {
        prompt: "Describe the steps to navigate to a webpage, find a search box, and submit a query using browser automation.",
        expectedKeywords: ["navigate", "find", "click", "type", "submit"],
        forbiddenKeywords: [],
      },
    ],
  };

  const pool = templates[category] ?? templates.reasoning;
  const results: AdaptiveBenchmark[] = [];
  const id_prefix = `tmpl_${category.slice(0, 2)}_${difficulty.slice(0, 1)}`;

  for (let i = 0; i < Math.min(count, pool.length); i++) {
    const t = pool[i % pool.length];
    results.push({
      id: `${id_prefix}_${Date.now()}_${i}`,
      category,
      difficulty,
      prompt: t.prompt!,
      expectedKeywords: t.expectedKeywords ?? [],
      forbiddenKeywords: t.forbiddenKeywords ?? [],
      maxTokens: difficulty === "hard" ? 1024 : 512,
      timeoutMs: 30000,
      scoreWeight: difficulty === "easy" ? 1 : difficulty === "medium" ? 2 : 3,
      source: "gap_analysis",
      generatedAt: Date.now(),
      lifecycle: "active",
      runCount: 0,
      passCount: 0,
      avgScore: 0,
      promoted: false,
    });
  }

  return results;
}

// ── Benchmark Evolution ────────────────────────────────────────────────────────

/**
 * Update benchmark statistics after an eval run.
 * Retire tasks that are too easy or too hard. Promote high-signal tasks.
 */
export function evolveBenchmarks(results: EvalResult[]): {
  retired: string[];
  promoted: string[];
} {
  const retired: string[] = [];
  const promoted: string[] = [];

  // Build result lookup
  const resultMap = new Map<string, EvalResult>();
  for (const r of results) resultMap.set(r.taskId, r);

  for (const benchmark of adaptiveBenchmarks) {
    if (benchmark.lifecycle !== "active") continue;

    const result = resultMap.get(benchmark.id);
    if (!result) continue;

    // Update stats
    benchmark.runCount++;
    if (result.passed) benchmark.passCount++;
    benchmark.avgScore = (benchmark.avgScore * (benchmark.runCount - 1) + result.score) / benchmark.runCount;

    const passRate = benchmark.passCount / benchmark.runCount;

    // Check for retirement
    if (benchmark.runCount >= RETIREMENT_MIN_RUNS) {
      if (passRate >= EASY_RETIREMENT_THRESHOLD) {
        benchmark.lifecycle = "retired_easy";
        retired.push(benchmark.id);
        log.info(`[adaptiveEval] Retired task ${benchmark.id} (too easy, pass rate: ${(passRate * 100).toFixed(0)}%)`);
        continue;
      }
      if (passRate <= HARD_RETIREMENT_THRESHOLD) {
        benchmark.lifecycle = "retired_hard";
        retired.push(benchmark.id);
        log.info(`[adaptiveEval] Retired task ${benchmark.id} (too hard, pass rate: ${(passRate * 100).toFixed(0)}%)`);
        continue;
      }
    }

    // Check for promotion
    if (
      !benchmark.promoted &&
      benchmark.runCount >= PROMOTION_MIN_RUNS &&
      passRate >= PROMOTION_PASS_RATE &&
      passRate <= PROMOTION_MAX_PASS_RATE
    ) {
      benchmark.lifecycle = "promoted";
      benchmark.promoted = true;
      promoted.push(benchmark.id);
      log.info(`[adaptiveEval] Promoted task ${benchmark.id} (pass rate: ${(passRate * 100).toFixed(0)}%)`);
    }
  }

  if (retired.length > 0 || promoted.length > 0) {
    saveBenchmarks();
  }

  return { retired, promoted };
}

// ── Adaptive Eval Run ──────────────────────────────────────────────────────────

/**
 * Run an adaptive evaluation:
 * 1. Analyze gaps from recent history
 * 2. Optionally generate new benchmarks targeting weak spots
 * 3. Select a weighted task set (more weight on weak categories)
 * 4. Run the eval
 * 5. Evolve benchmarks based on results
 */
export async function runAdaptiveEval(options: {
  generateNew?: boolean;
  newTaskCount?: number;
  totalTaskBudget?: number;
  signal?: AbortSignal;
} = {}): Promise<AdaptiveEvalRun> {
  const {
    generateNew = true,
    newTaskCount = 3,
    totalTaskBudget = 20,
    signal,
  } = options;

  const startTime = Date.now();
  log.info("[adaptiveEval] Starting adaptive eval run");

  // Step 1: Gap analysis
  const gap = analyzeGaps();
  log.info(`[adaptiveEval] Gap analysis: weakest=${gap.weakestCategory}(${(gap.overallPassRate * 100).toFixed(0)}% overall)`);

  // Step 2: Optionally generate new benchmarks
  let newTasksGenerated = 0;
  if (generateNew) {
    try {
      const newTasks = await generateBenchmarks({
        count: newTaskCount,
        gapAnalysis: gap,
        signal,
      });
      newTasksGenerated = newTasks.length;
    } catch (err) {
      log.warn(`[adaptiveEval] New task generation failed: ${(err as Error).message}`);
    }
  }

  // Step 3: Select tasks — weighted toward weak categories
  const activeBenchmarks = adaptiveBenchmarks.filter(b => b.lifecycle === "active");
  const selectedTasks = selectWeightedTasks(gap, activeBenchmarks, totalTaskBudget);

  const staticTaskCount = selectedTasks.filter(t => !t.id.startsWith("adp_") && !t.id.startsWith("tmpl_")).length;
  const generatedTaskCount = selectedTasks.length - staticTaskCount;

  log.info(`[adaptiveEval] Selected ${selectedTasks.length} tasks (${staticTaskCount} static, ${generatedTaskCount} generated)`);

  // Step 4: Run eval on selected tasks
  // Pass the selected task IDs to runEvaluation
  const selectedTaskIds = selectedTasks.map(t => t.id);
  // Build a simple pass-through runAgent (adaptive eval uses the same LLM as the framework)
  const { simpleChatCompletion: scc } = await import("./llmProvider.js");
  const runAgent = async (prompt: string, maxTokens: number, _timeoutMs: number): Promise<string> => {
    return scc([{ role: "user", content: prompt }], { maxTokens, signal });
  };
  // Only run tasks that exist in EVAL_TASKS (adaptive benchmarks need to be added to the pool first)
  const staticIds = selectedTaskIds.filter(id => EVAL_TASKS.some(t => t.id === id));
  const evalRun = await runEvaluation(runAgent, staticIds.length > 0 ? staticIds : undefined);

  // Step 5: Evolve benchmarks
  const { retired, promoted } = evolveBenchmarks(evalRun.results);

  // Build adaptive run record
  const adaptiveRun: AdaptiveEvalRun = {
    ...evalRun,
    adaptive: true,
    gapAnalysis: gap,
    generatedTaskCount,
    staticTaskCount,
    newTasksGenerated,
    tasksRetired: retired.length,
    tasksPromoted: promoted.length,
  };

  // Save to history
  evalHistory.push(adaptiveRun);
  saveHistory();

  log.info(`[adaptiveEval] Adaptive eval complete: ${evalRun.percentage.toFixed(1)}% (${evalRun.passed}/${evalRun.passed + evalRun.failed})`);
  return adaptiveRun;
}

/**
 * Select tasks weighted toward the system's weak spots.
 */
function selectWeightedTasks(
  gap: GapAnalysis,
  activeBenchmarks: AdaptiveBenchmark[],
  budget: number
): EvalTask[] {
  const weakCategories = new Set(gap.targetCategories);

  // Start with static tasks, weighted toward weak categories
  const staticPool = EVAL_TASKS.filter(t => weakCategories.has(t.category));
  const staticOther = EVAL_TASKS.filter(t => !weakCategories.has(t.category));

  // Allocate budget: 50% weak category static, 25% other static, 25% generated
  const weakBudget = Math.floor(budget * 0.5);
  const otherBudget = Math.floor(budget * 0.25);
  const genBudget = budget - weakBudget - otherBudget;

  const selected: EvalTask[] = [
    ...shuffle(staticPool).slice(0, weakBudget),
    ...shuffle(staticOther).slice(0, otherBudget),
    ...shuffle(activeBenchmarks).slice(0, genBudget),
  ];

  // Deduplicate by id
  const seen = new Set<string>();
  return selected.filter(t => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Stats ──────────────────────────────────────────────────────────────────────

export function getBenchmarkEvolutionStats(): BenchmarkEvolutionStats {
  const generationsByCategory: Record<string, number> = {};
  const generationsByDifficulty: Record<string, number> = {};
  let totalPassRate = 0;
  let ratedCount = 0;
  let lastGeneratedAt: number | null = null;

  for (const b of adaptiveBenchmarks) {
    generationsByCategory[b.category] = (generationsByCategory[b.category] ?? 0) + 1;
    generationsByDifficulty[b.difficulty] = (generationsByDifficulty[b.difficulty] ?? 0) + 1;

    if (b.runCount > 0) {
      totalPassRate += b.passCount / b.runCount;
      ratedCount++;
    }

    if (!lastGeneratedAt || b.generatedAt > lastGeneratedAt) {
      lastGeneratedAt = b.generatedAt;
    }
  }

  return {
    totalGenerated: adaptiveBenchmarks.length,
    active: adaptiveBenchmarks.filter(b => b.lifecycle === "active").length,
    retiredEasy: adaptiveBenchmarks.filter(b => b.lifecycle === "retired_easy").length,
    retiredHard: adaptiveBenchmarks.filter(b => b.lifecycle === "retired_hard").length,
    promoted: adaptiveBenchmarks.filter(b => b.lifecycle === "promoted").length,
    avgPassRate: ratedCount > 0 ? totalPassRate / ratedCount : 0,
    generationsByCategory,
    generationsByDifficulty,
    lastGeneratedAt,
  };
}

export function getAdaptiveBenchmarks(filter?: {
  lifecycle?: TaskLifecycle;
  category?: EvalTask["category"];
  difficulty?: EvalTask["difficulty"];
}): AdaptiveBenchmark[] {
  let benchmarks = [...adaptiveBenchmarks];
  if (filter?.lifecycle) benchmarks = benchmarks.filter(b => b.lifecycle === filter.lifecycle);
  if (filter?.category) benchmarks = benchmarks.filter(b => b.category === filter.category);
  if (filter?.difficulty) benchmarks = benchmarks.filter(b => b.difficulty === filter.difficulty);
  return benchmarks.sort((a, b) => b.generatedAt - a.generatedAt);
}

export function getAdaptiveEvalHistory(limit = 20): AdaptiveEvalRun[] {
  return evalHistory.slice(-limit).reverse();
}

export function getLatestGapAnalysis(): GapAnalysis {
  return analyzeGaps();
}

// ── Init ───────────────────────────────────────────────────────────────────────

export function initAdaptiveEval(): void {
  loadBenchmarks();
  loadHistory();
  log.info(`[adaptiveEval] Initialized: ${adaptiveBenchmarks.length} benchmarks, ${evalHistory.length} history runs`);
}
