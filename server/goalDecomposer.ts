/**
 * goalDecomposer.ts — v6.37
 *
 * Bridges evalGoalDiscovery.ts → recursiveGoals.ts.
 *
 * When the eval pipeline discovers capability gaps (DiscoveredGoal[]), this
 * module:
 *   1. Calls the LLM to decompose each high-priority discovery into 3-5
 *      concrete, file-scoped sub-goals.
 *   2. Creates a MetaGoal in the recursive goal store for each discovery.
 *   3. Wires the sub-goals so autoExecuteNextGoal() can pick them up.
 *
 * This closes the loop:
 *   eval failure → discovery → MetaGoal + sub-goals → RSI proposal → fix
 */

import { createLogger } from "./logger.js";
import { simpleChatCompletion } from "./llmProvider.js";
import type { DiscoveredGoal } from "./evalGoalDiscovery.js";
import { createMetaGoal, listMetaGoals } from "./recursiveGoals.js";

const log = createLogger("goalDecomposer");

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DecomposedGoal {
  discoveryId: string;
  metaGoalId: string;
  subGoals: Array<{
    title: string;
    description: string;
    targetFile?: string;
    estimatedEffort: "small" | "medium" | "large";
  }>;
  decomposedAt: number;
}

// ── LLM decomposition ──────────────────────────────────────────────────────────

async function decomposeWithLlm(discovery: DiscoveredGoal): Promise<Array<{
  title: string;
  description: string;
  targetFile?: string;
  estimatedEffort: "small" | "medium" | "large";
}>> {
  const prompt = `You are an expert software engineer helping to decompose a high-level improvement goal into concrete, actionable sub-tasks.

## Improvement Goal
Category: ${discovery.category}
Title: ${discovery.title}
Description: ${discovery.description}
Failed eval tasks: ${discovery.failedTaskIds.join(", ")}
Average score in this category: ${discovery.avgScore.toFixed(1)}%

## Instructions
Decompose this goal into exactly 3-5 concrete sub-tasks. Each sub-task must:
1. Target a specific file or module in the Andromeda codebase
2. Be implementable in a single RSI proposal (< 100 lines of code change)
3. Be independently verifiable

Return ONLY a JSON array with this exact shape (no markdown, no explanation):
[
  {
    "title": "Short imperative title",
    "description": "What to change and why (2-3 sentences)",
    "targetFile": "server/someModule.ts",
    "estimatedEffort": "small" | "medium" | "large"
  }
]`;

  try {
    const raw = await simpleChatCompletion([{ role: "user", content: prompt }], { maxTokens: 800 });
    // Extract JSON array from response
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("No JSON array in response");
    const parsed = JSON.parse(match[0]) as Array<{
      title: string;
      description: string;
      targetFile?: string;
      estimatedEffort?: string;
    }>;
    return parsed.map(sg => ({
      title: sg.title || "Untitled sub-goal",
      description: sg.description || "",
      targetFile: sg.targetFile,
      estimatedEffort: (["small", "medium", "large"].includes(sg.estimatedEffort ?? "")
        ? sg.estimatedEffort
        : "medium") as "small" | "medium" | "large",
    }));
  } catch (err) {
    log.warn(`[goalDecomposer] LLM decomposition failed: ${(err as Error).message} — using fallback`);
    // Fallback: create a single generic sub-goal
    return [{
      title: `Improve ${discovery.category} eval performance`,
      description: `Address failing eval tasks in the ${discovery.category} category. Current score: ${discovery.avgScore.toFixed(1)}%. Failed tasks: ${discovery.failedTaskIds.slice(0, 3).join(", ")}.`,
      estimatedEffort: "medium",
    }];
  }
}

// ── Deduplication ──────────────────────────────────────────────────────────────

function isDuplicate(discovery: DiscoveredGoal): boolean {
  const existing = listMetaGoals({ status: "planned" });
  return existing.some(g =>
    g.title.toLowerCase().includes(discovery.category.toLowerCase()) &&
    g.status !== "completed" &&
    g.status !== "failed"
  );
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Decompose a list of discovered goals into MetaGoals with LLM-generated sub-goals.
 * Only processes discoveries with avgScore < 70% (significant gaps).
 * Skips duplicates (same category already has a planned MetaGoal).
 */
export async function decomposeDiscoveries(
  discoveries: DiscoveredGoal[],
): Promise<DecomposedGoal[]> {
  const results: DecomposedGoal[] = [];

  // Validate and filter to significant gaps only
  const valid = discoveries.filter(d =>
    d && typeof d.id === 'string' && typeof d.category === 'string' &&
    typeof d.title === 'string' && typeof d.description === 'string' &&
    Array.isArray(d.failedTaskIds) && typeof d.avgScore === 'number'
  );
  const significant = valid.filter(d => d.avgScore < 70);
  if (significant.length === 0) {
    log.info("[goalDecomposer] No significant gaps to decompose (all categories ≥ 70%)");
    return results;
  }

  // Sort by severity (lowest score first)
  significant.sort((a, b) => a.avgScore - b.avgScore);

  // Process top 3 to avoid LLM overload
  const toProcess = significant.slice(0, 3);

  for (const discovery of toProcess) {
    if (isDuplicate(discovery)) {
      log.info(`[goalDecomposer] Skipping duplicate: ${discovery.category}`);
      continue;
    }

    log.info(`[goalDecomposer] Decomposing: ${discovery.title} (score: ${discovery.avgScore.toFixed(1)}%)`);

    try {
      const subGoals = await decomposeWithLlm(discovery);

      const metaGoal = createMetaGoal({
        type: "capability",
        title: discovery.title,
        description: discovery.description,
        rationale: `Eval failure: ${discovery.category} category scored ${discovery.avgScore.toFixed(1)}%. Failed tasks: ${discovery.failedTaskIds.join(", ")}.`,
        priority: Math.max(1, Math.round(10 - (discovery.avgScore / 10))), // lower score = higher priority
        recursive: true,
        subGoals: subGoals.map(sg => ({
          title: sg.title,
          description: sg.description,
          targetFile: sg.targetFile,
          estimatedEffort: sg.estimatedEffort,
        })),
      });

      results.push({
        discoveryId: discovery.id,
        metaGoalId: metaGoal.id,
        subGoals,
        decomposedAt: Date.now(),
      });

      log.info(`[goalDecomposer] Created MetaGoal ${metaGoal.id} with ${subGoals.length} sub-goals`);
    } catch (err) {
      log.warn(`[goalDecomposer] Failed to decompose ${discovery.id}: ${(err as Error).message}`);
    }
  }

  return results;
}

/**
 * Decompose a single discovery immediately.
 * Used by the /api/rsi/discoveries/:id/decompose endpoint.
 */
export async function decomposeSingleDiscovery(
  discovery: DiscoveredGoal,
): Promise<DecomposedGoal | null> {
  try {
    const results = await decomposeDiscoveries([discovery]);
    return results[0] ?? null;
  } catch (err) {
    log.warn(`[goalDecomposer] decomposeSingleDiscovery failed: ${(err as Error).message}`);
    return null;
  }
}
