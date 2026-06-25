/**
 * Andromeda v5.27 — Autonomous Goal Suggestion Engine
 * v6.31: Replaced isRunning boolean guard with withAutoGoalLock() distributed lock.
 *
 * Analyzes system logs, error patterns, and performance metrics
 * to proactively suggest improvement goals without user intervention.
 *
 * Integrates with:
 * - selfMonitor.ts (metrics)
 * - selfKnowledgeBase.ts (known issues)
 * - recursiveGoals.ts (goal creation)
 * - redisLock.ts (distributed concurrency control)
 */

import { withAutoGoalLock } from "./redisLock.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface GoalSuggestion {
  id: string;
  title: string;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  source: "error_pattern" | "performance_drop" | "knowledge_gap" | "recurring_issue";
  confidence: number; // 0-1
  suggestedAt: number;
  autoExecute: boolean;
}

interface SuggesterConfig {
  enabled: boolean;
  intervalMs: number;
  maxSuggestionsPerCycle: number;
  autoExecuteThreshold: number; // confidence threshold for auto-execution
}

// ── State ────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: SuggesterConfig = {
  enabled: true, // v5.30: Enabled by default
  intervalMs: 30 * 60 * 1000, // Every 30 minutes
  maxSuggestionsPerCycle: 3,
  autoExecuteThreshold: 0.9,
};

let config: SuggesterConfig = { ...DEFAULT_CONFIG };
let suggesterTimer: ReturnType<typeof setInterval> | null = null;
// v6.31: isRunning replaced by withAutoGoalLock() distributed lock
let _timerActive = false;
const suggestions: GoalSuggestion[] = [];
const MAX_SUGGESTIONS = 100;

// ── Analysis Functions ───────────────────────────────────────────────────────

async function analyzeErrorPatterns(): Promise<GoalSuggestion[]> {
  return handleAnalysisError(
    async () => {
      const results: GoalSuggestion[] = [];
      const { getOpenIssues } = await import("./selfKnowledgeBase");
      const openIssues = getOpenIssues();

      // Group by module
      const byModule: Record<string, number> = {};
      for (const issue of openIssues) {
        const modules = issue.affectedModules || ["unknown"];
        for (const mod of modules) {
          byModule[mod] = (byModule[mod] || 0) + 1;
        }
      }

      // Suggest goals for modules with multiple open issues
      for (const [module, count] of Object.entries(byModule)) {
        if (count >= 3) {
          results.push({
            id: `goal_err_${module}_${Date.now()}`,
            title: `Reduce error rate in ${module}`,
            description: `Module "${module}" has ${count} open issues. Investigate root causes and apply fixes.`,
            priority: count >= 5 ? "high" : "medium",
            source: "error_pattern",
            confidence: Math.min(0.95, 0.6 + count * 0.05),
            suggestedAt: Date.now(),
            autoExecute: false,
          });
        }
      }
      return results;
    },
    "analyzeErrorPatterns"
  );
}

// Helper for centralized error handling
async function handleAnalysisError<T>(fn: () => Promise<T>, functionName: string): Promise<T | []> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[AutoGoalSuggester] ${functionName} failed:`, (err as Error).message);
    return [];
  }
}

async function analyzePerformanceMetrics(): Promise<GoalSuggestion[]> {
  return handleAnalysisError(async () => {
    const results: GoalSuggestion[] = [];
    const { getHealthReport } = await import("./selfMonitor");
    const status = getHealthReport();
    if (status && status.metrics) {
      // Check for degrading metrics
      for (const [key, metric] of Object.entries(status.metrics) as [string, any][]) {
        if (metric && metric.trend === "degrading" && metric.samples > 5) {
          results.push({
            id: `goal_perf_${key}_${Date.now()}`,
            title: `Improve ${key.replace(/_/g, " ")}`,
            description: `Metric "${key}" is trending downward (current: ${metric.current}). Investigate and optimize.`,
            priority: metric.current < 0.5 ? "high" : "medium",
            source: "performance_drop",
            confidence: 0.7,
            suggestedAt: Date.now(),
            autoExecute: false,
          });
        }
      }
    }
    return results;
  }, "analyzePerformanceMetrics");
}

async function analyzeRecurringIssues(): Promise<GoalSuggestion[]> {
  return handleAnalysisError(async () => {
    const results: GoalSuggestion[] = [];
    const { getCrossSessionInsights } = await import("./selfKnowledgeBase");
    const insights = getCrossSessionInsights();
    if (insights.totalAttempts > 5 && insights.successRate < 0.5) {
      results.push({
        id: `goal_recurring_${Date.now()}`,
        title: "Improve self-modification success rate",
        description: `Self-modification success rate is ${(insights.successRate * 100).toFixed(0)}% (${insights.totalAttempts} attempts). Top anti-patterns: ${insights.topAntiPatterns.slice(0, 2).join("; ")}`,
        priority: "high",
        source: "recurring_issue",
        confidence: 0.85,
        suggestedAt: Date.now(),
        autoExecute: false,
      });
    }
    return results;
  }, "analyzeRecurringIssues");
}

// ── Core Suggestion Cycle ────────────────────────────────────────────────────

async function runSuggestionCycle(): Promise<GoalSuggestion[]> {
  const newSuggestions: GoalSuggestion[] = [];

  const [errorGoals, perfGoals, recurringGoals] = await Promise.all([
    analyzeErrorPatterns(),
    analyzePerformanceMetrics(),
    analyzeRecurringIssues(),
  ]);

  newSuggestions.push(...errorGoals, ...perfGoals, ...recurringGoals);

  // Deduplicate against existing suggestions
  const existingTitles = new Set(suggestions.map(s => s.title));
  const unique = newSuggestions.filter(s => !existingTitles.has(s.title));

  // Limit per cycle
  const toAdd = unique.slice(0, config.maxSuggestionsPerCycle);
  suggestions.push(...toAdd);
  if (suggestions.length > MAX_SUGGESTIONS) {
    suggestions.splice(0, suggestions.length - MAX_SUGGESTIONS);
  }

  // Auto-execute high-confidence goals
  for (const suggestion of toAdd) {
    if (suggestion.confidence >= config.autoExecuteThreshold && suggestion.autoExecute) {
      try {
        const { createGoal } = await import("./recursiveGoals") as any;
        if (createGoal) {
          createGoal({
            title: suggestion.title,
            description: suggestion.description,
            priority: suggestion.priority,
            source: "auto_suggester",
          });
          console.log(`[AutoGoalSuggester] Auto-created goal: ${suggestion.title}`);
        }
      } catch (err) { console.warn(`[AutoGoalSuggester] Failed to create goal: ${(err as Error).message}`); }
    }
  }

  if (toAdd.length > 0) {
    console.log(`[AutoGoalSuggester] Generated ${toAdd.length} new suggestions.`);
  }
  return toAdd;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function startAutoGoalSuggester(overrides?: Partial<SuggesterConfig>): void {
  if (overrides) config = { ...config, ...overrides };
  if (!config.enabled) {
    console.log("[AutoGoalSuggester] Disabled. Set enabled: true to activate.");
    return;
  }
  if (_timerActive) return;

  // v6.31: Each interval tick acquires the distributed lock before running
  _timerActive = true;
  suggesterTimer = setInterval(() => {
    withAutoGoalLock(() => runSuggestionCycle()).catch(err =>
      console.warn("[AutoGoalSuggester] Cycle skipped (lock busy or error):", (err as Error).message)
    );
  }, config.intervalMs);
  console.log(`[AutoGoalSuggester] Started. Interval: ${config.intervalMs / 1000 / 60}min`);
}

export function stopAutoGoalSuggester(): void {
  if (suggesterTimer) clearInterval(suggesterTimer);
  suggesterTimer = null;
  _timerActive = false;
  // v6.31: No isRunning flag to clear — lock releases automatically
}

export function getSuggestions(limit = 20): GoalSuggestion[] {
  return suggestions.slice(-limit);
}

export async function triggerSuggestionCycle(): Promise<GoalSuggestion[]> {
  // v6.31: Acquire lock for manual trigger too
  const result = await withAutoGoalLock(() => runSuggestionCycle());
  return result.result ?? [];
}

export function getSuggesterStats() {
  return {
    enabled: config.enabled,
    running: _timerActive,
    totalSuggestions: suggestions.length,
    intervalMs: config.intervalMs,
  };
}
