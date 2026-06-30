/**
 * evalGoalDiscovery.ts — v6.36
 *
 * Unsupervised Goal Discovery: analyses eval run failures and automatically
 * creates improvement goals in the goal manager without human input.
 *
 * Flow:
 *   1. After each RSI cycle eval, collect all failed/low-scoring tasks
 *   2. Group failures by category
 *   3. For each category with ≥2 failures, ask the LLM to propose a concrete
 *      improvement goal (what code/behaviour needs to change)
 *   4. Create the goal via goalManager if it doesn't already exist
 *   5. Persist discovery history to data/eval_goal_discoveries.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { EvalRun, EvalTask } from "./evalFramework.js";
import { EVAL_TASKS } from "./evalFramework.js";
import { createGoal, listGoals } from "./goalManager.js";
import { simpleChatCompletion } from "./llmProvider.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DISCOVERY_PATH = path.join(__dirname, "../data/eval_goal_discoveries.json");

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DiscoveredGoal {
  id: string;
  category: string;
  title: string;
  description: string;
  failedTaskIds: string[];
  avgScore: number;
  goalId?: string; // set after createGoal succeeds
  discoveredAt: number;
}

interface DiscoveryHistory {
  discoveries: DiscoveredGoal[];
  lastRunAt: number;
}

// ── Persistence ────────────────────────────────────────────────────────────────

function loadHistory(): DiscoveryHistory {
  try {
    if (fs.existsSync(DISCOVERY_PATH)) {
      const content = fs.readFileSync(DISCOVERY_PATH, "utf-8");
      return JSON.parse(content);
    }
  } catch (err) {
    console.warn("[EvalGoalDiscovery] Failed to load history:", (err as Error).message);
  }
  return { discoveries: [], lastRunAt: 0 };
}

function saveHistory(h: DiscoveryHistory): void {
  try {
    const dir = path.dirname(DISCOVERY_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DISCOVERY_PATH, JSON.stringify(h, null, 2));
  } catch (err) {
    console.warn("[EvalGoalDiscovery] Save failed:", (err as Error).message);
  }
}

// ── Core logic ─────────────────────────────────────────────────────────────────

/**
 * Analyse an EvalRun and auto-create improvement goals for weak categories.
 * Called by rsiEngine after each cycle's eval.
 */
export async function discoverGoalsFromEval(run: EvalRun): Promise<DiscoveredGoal[]> {
  const history = loadHistory();

  // Collect failed/weak tasks (score < 50%)
  const weakTasks: Array<{ task: EvalTask; score: number }> = [];
  for (const result of run.results ?? []) {
    if (result.score < 50) {
      const task = EVAL_TASKS.find(t => t.id === result.taskId);
      if (task) weakTasks.push({ task, score: result.score });
    }
  }

  if (weakTasks.length === 0) {
    console.log("[EvalGoalDiscovery] No weak tasks found — no goals to discover.");
    return [];
  }

  // Group by category
  const byCategory: Record<string, Array<{ task: EvalTask; score: number }>> = {};
  for (const wt of weakTasks) {
    const cat = wt.task.category ?? "general";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(wt);
  }

  // Get existing goal titles to avoid duplicates
  const existingGoals = listGoals();
  const existingTitles = new Set(existingGoals.map((g: any) => g.title?.toLowerCase() ?? ""));

  const discovered: DiscoveredGoal[] = [];

  for (const [category, items] of Object.entries(byCategory)) {
    if (items.length < 1) continue; // need at least 1 failure

    const avgScore = items.reduce((s, i) => s + i.score, 0) / items.length;
    const taskDescriptions = items
      .map(i => `  - [${i.task.id}] "${i.task.prompt.slice(0, 80)}..." (score: ${i.score}/100)`)
      .join("\n");

    // Ask LLM to propose a concrete improvement goal
    const prompt = `You are Andromeda's self-improvement system analysing eval failures.

Category: ${category}
Average score: ${avgScore.toFixed(1)}/100
Failed tasks:
${taskDescriptions}

Based on these failures, propose ONE specific, actionable improvement goal for Andromeda.
The goal should describe a concrete code change or capability improvement that would fix these failures.

Respond with JSON only:
{
  "title": "short goal title (max 60 chars)",
  "description": "2-3 sentence description of what needs to change and why"
}`;

    try {
      const raw = await simpleChatCompletion(
        [{ role: "user", content: prompt }],
        { maxTokens: 200, temperature: 0.3, providerId: "deepseek" }
      );
      const json = raw.match(/\{[\s\S]*\}/)?.[0];
      if (!json) continue;
      const { title, description } = JSON.parse(json);
      if (!title || !description) continue;

      // Skip if a very similar goal already exists
      if (existingTitles.has(title.toLowerCase())) {
        console.log(`[EvalGoalDiscovery] Skipping duplicate goal: "${title}"`);
        continue;
      }

      const discovery: DiscoveredGoal = {
        id: `disc_${Date.now()}_${category}`,
        category,
        title,
        description,
        failedTaskIds: items.map(i => i.task.id),
        avgScore,
        discoveredAt: Date.now(),
      };

      // Create the goal in goalManager
      try {
        const goal = createGoal({
          title,
          description,
          priority: avgScore < 25 ? "high" : "medium",
          metadata: { category, source: "eval_discovery", failedTaskIds: discovery.failedTaskIds, avgScore },
        });
        discovery.goalId = (goal as any).id ?? undefined;
        console.log(`[EvalGoalDiscovery] Created goal "${title}" (id: ${discovery.goalId}) for category "${category}"`);
      } catch (err) {
        console.warn(`[EvalGoalDiscovery] createGoal failed for "${title}":`, (err as Error).message);
      }

      discovered.push(discovery);
      existingTitles.add(title.toLowerCase());
    } catch (err) {
      console.warn(`[EvalGoalDiscovery] LLM call failed for category "${category}":`, (err as Error).message);
    }
  }

  // Persist
  history.discoveries.push(...discovered);
  history.lastRunAt = Date.now();
  // Keep last 200 discoveries
  if (history.discoveries.length > 200) {
    history.discoveries = history.discoveries.slice(-200);
  }
  saveHistory(history);

  console.log(`[EvalGoalDiscovery] Discovered ${discovered.length} new goals from ${weakTasks.length} weak tasks.`);
  return discovered;
}

/**
 * Get all discovery history.
 */
export function getDiscoveryHistory(): DiscoveryHistory {
  return loadHistory();
}

/**
 * Get the most recent discoveries (for the dashboard).
 */
export function getRecentDiscoveries(limit = 20): DiscoveredGoal[] {
  const h = loadHistory();
  return h.discoveries.slice(-limit).reverse();
}
