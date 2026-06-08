/**
 * evalDrivenTargeting.ts — v1.0 (Tier 2 Enhancement #5)
 *
 * Eval-Driven Improvement Targeting: Connects the adaptive eval suite's gap analysis
 * to the RSI proposal generator. When an eval benchmark shows a weak category, this
 * module selects the files most likely responsible and directs analyzeAndPropose()
 * to target those files with the relevant improvement area.
 *
 * Architecture:
 *   1. getEvalDrivenTarget() reads the latest gap analysis from adaptiveEval
 *   2. It maps weak eval categories to the server files most likely responsible
 *   3. continuousImprover calls this every other cycle to get a targeted file+area
 *   4. The result is passed to analyzeAndPropose(file, area) for a focused proposal
 *
 * Category → File mapping rationale:
 *   - "reasoning"    → aiPlanning.ts, agentOrchestrator.ts (planning/reasoning logic)
 *   - "code"         → selfImprove.ts, selfImproveGuard.ts (code generation/apply)
 *   - "tool_use"     → tools/toolRegistry.ts, capabilityDiscovery.ts
 *   - "self_knowledge" → selfKnowledgeBase.ts, manifest.ts, aiMemory.ts
 *   - "multi_step"   → agentStateMachine.ts, aiPlanning.ts, contextBus.ts
 */

import fs from "fs";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EvalTarget {
  targetFile: string;
  area: "performance" | "reliability" | "security" | "readability" | "feature";
  reason: string;
  evalCategory: string;
  evalPassRate: number;
}

// ─── Category → File mapping ──────────────────────────────────────────────────

const CATEGORY_FILE_MAP: Record<string, Array<{ file: string; area: EvalTarget["area"] }>> = {
  reasoning: [
    { file: "aiPlanning.ts", area: "reliability" },
    { file: "agentOrchestrator.ts", area: "reliability" },
    { file: "agentStateMachine.ts", area: "reliability" },
  ],
  code: [
    { file: "selfImprove.ts", area: "reliability" },
    { file: "selfImproveGuard.ts", area: "security" },
    { file: "continuousImprover.ts", area: "performance" },
  ],
  tool_use: [
    { file: "capabilityDiscovery.ts", area: "feature" },
    { file: "agentOrchestrator.ts", area: "feature" },
    { file: "ai.ts", area: "feature" },
  ],
  self_knowledge: [
    { file: "selfKnowledgeBase.ts", area: "reliability" },
    { file: "aiMemory.ts", area: "reliability" },
    { file: "andromedaMemoryWriter.ts", area: "reliability" },
  ],
  multi_step: [
    { file: "agentStateMachine.ts", area: "reliability" },
    { file: "aiPlanning.ts", area: "performance" },
    { file: "contextBus.ts", area: "performance" },
  ],
};

// ─── Gap analysis reader ──────────────────────────────────────────────────────

interface CachedGapAnalysis {
  weakestCategory: string;
  categoryRanking: Array<{ category: string; passRate: number; taskCount: number }>;
  overallPassRate: number;
  analyzedAt: number;
}

let _cachedGap: CachedGapAnalysis | null = null;
let _cacheLoadedAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function loadGapAnalysis(): CachedGapAnalysis | null {
  const now = Date.now();
  if (_cachedGap && now - _cacheLoadedAt < CACHE_TTL_MS) return _cachedGap;

  try {
    // Try to read from the eval history file directly (avoids importing adaptiveEval at module load)
    const historyPath = path.join(process.cwd(), "data", "adaptive_eval_history.json");
    if (!fs.existsSync(historyPath)) return null;

    const history: any[] = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
    if (!history || history.length === 0) return null;

    // Use the most recent run's gap analysis if available
    const lastRun = history[history.length - 1];
    if (lastRun?.gapAnalysis) {
      _cachedGap = lastRun.gapAnalysis as CachedGapAnalysis;
      _cacheLoadedAt = now;
      return _cachedGap;
    }

    // Otherwise compute a simple gap from the last 5 runs
    const recentRuns = history.slice(-5);
    const catStats: Record<string, { pass: number; total: number }> = {};
    for (const run of recentRuns) {
      for (const result of (run.results || [])) {
        const cat = result.category || "reasoning";
        if (!catStats[cat]) catStats[cat] = { pass: 0, total: 0 };
        catStats[cat].total++;
        if (result.passed) catStats[cat].pass++;
      }
    }

    const categoryRanking = Object.entries(catStats)
      .map(([category, s]) => ({ category, passRate: s.total > 0 ? s.pass / s.total : 0.5, taskCount: s.total }))
      .sort((a, b) => a.passRate - b.passRate);

    if (categoryRanking.length === 0) return null;

    const totalPass = Object.values(catStats).reduce((s, c) => s + c.pass, 0);
    const totalTotal = Object.values(catStats).reduce((s, c) => s + c.total, 0);

    _cachedGap = {
      weakestCategory: categoryRanking[0].category,
      categoryRanking,
      overallPassRate: totalTotal > 0 ? totalPass / totalTotal : 0.5,
      analyzedAt: now,
    };
    _cacheLoadedAt = now;
    return _cachedGap;
  } catch {
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get a targeted file and area based on the current eval gap analysis.
 * Returns null if no gap data is available (falls back to random selection in caller).
 */
export function getEvalDrivenTarget(): EvalTarget | null {
  try {
    const gap = loadGapAnalysis();
    if (!gap) return null;

    // Find the weakest category that has a file mapping
    const weakCategories = gap.categoryRanking.filter(c => c.passRate < 0.7 && c.taskCount >= 2);
    if (weakCategories.length === 0) return null;

    for (const weakCat of weakCategories) {
      const candidates = CATEGORY_FILE_MAP[weakCat.category];
      if (!candidates || candidates.length === 0) continue;

      // Pick a random candidate from the mapping to avoid always hitting the same file
      const candidate = candidates[Math.floor(Math.random() * candidates.length)];

      return {
        targetFile: candidate.file,
        area: candidate.area,
        reason: `Eval gap: ${weakCat.category} pass rate is ${(weakCat.passRate * 100).toFixed(0)}% (${weakCat.taskCount} tasks)`,
        evalCategory: weakCat.category,
        evalPassRate: weakCat.passRate,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Get a summary of current eval performance for logging.
 */
export function getEvalSummary(): string {
  try {
    const gap = loadGapAnalysis();
    if (!gap) return "No eval data available";
    const top3 = gap.categoryRanking.slice(0, 3)
      .map(c => `${c.category}=${(c.passRate * 100).toFixed(0)}%`)
      .join(", ");
    return `Overall: ${(gap.overallPassRate * 100).toFixed(0)}% | Weakest: ${top3}`;
  } catch {
    return "Eval summary unavailable";
  }
}

/**
 * Record that an eval-driven proposal was generated (for tracking effectiveness).
 */
export function recordEvalDrivenProposal(target: EvalTarget, proposalId: string): void {
  try {
    const logPath = path.join(process.cwd(), "data", "eval_driven_proposals.json");
    let log: any[] = [];
    try {
      if (fs.existsSync(logPath)) log = JSON.parse(fs.readFileSync(logPath, "utf-8"));
    } catch { /* ignore */ }
    log.push({ ...target, proposalId, recordedAt: Date.now() });
    if (log.length > 100) log = log.slice(-100);
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2), "utf-8");
  } catch { /* non-fatal */ }
}
