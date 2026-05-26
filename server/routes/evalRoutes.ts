/**
 * evalRoutes.ts — v6.22
 * REST API for the evaluation framework.
 *
 * Endpoints:
 *  GET  /api/eval/tasks      — list all benchmark tasks
 *  GET  /api/eval/history    — past eval runs
 *  GET  /api/eval/trend      — score trend over time
 *  POST /api/eval/run        — run evaluation (optional quick mode / task IDs)
 *  POST /api/eval/baseline   — run eval and store as the official baseline score
 *  GET  /api/eval/baseline   — retrieve the stored baseline score
 *  GET  /api/rsi/proof       — before/after comparison: baseline vs latest eval
 */
import type { Router } from "express";
import * as fs from "fs";
import * as path from "path";
import { EVAL_TASKS, getEvalHistory, getEvalTrend, runEvaluation } from "../evalFramework.js";
import { simpleChatCompletion } from "../llmProvider.js";

const BASELINE_FILE = path.join(process.cwd(), "data", "eval_baseline.json");

function makeRunAgent() {
  return async (prompt: string, maxTokens: number, timeoutMs: number): Promise<string> => {
    const result = await Promise.race([
      simpleChatCompletion(prompt, { maxTokens }),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);
    return result as string;
  };
}

function loadBaseline(): Record<string, unknown> | null {
  try {
    if (fs.existsSync(BASELINE_FILE)) {
      return JSON.parse(fs.readFileSync(BASELINE_FILE, "utf-8"));
    }
  } catch { /* ignore */ }
  return null;
}

function saveBaseline(run: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
  fs.writeFileSync(BASELINE_FILE, JSON.stringify({ ...run, storedAt: Date.now() }, null, 2));
}

export function registerEvalRoutes(app: Router): void {
  // GET /api/eval/tasks — list all benchmark tasks
  app.get("/api/eval/tasks", (_req, res) => {
    res.json({
      tasks: EVAL_TASKS.map(t => ({
        id: t.id,
        category: t.category,
        difficulty: t.difficulty,
        prompt: t.prompt.slice(0, 100),
        scoreWeight: t.scoreWeight,
      })),
      total: EVAL_TASKS.length,
    });
  });

  // GET /api/eval/history — get past eval runs
  app.get("/api/eval/history", (req, res) => {
    const limit = parseInt((req.query.limit as string) ?? "10");
    res.json({ history: getEvalHistory(limit) });
  });

  // GET /api/eval/trend — score trend over time
  app.get("/api/eval/trend", (_req, res) => {
    res.json({ trend: getEvalTrend() });
  });

  // POST /api/eval/run — run evaluation (optionally specify task IDs or quick mode)
  app.post("/api/eval/run", async (req, res) => {
    const { taskIds, quick } = req.body as { taskIds?: string[]; quick?: boolean };
    const ids = taskIds ?? (quick ? EVAL_TASKS.filter(t => t.difficulty === "easy").map(t => t.id) : undefined);
    try {
      const run = await runEvaluation(makeRunAgent(), ids);
      res.json({ success: true, run });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // POST /api/eval/baseline — run eval and store result as the official baseline
  // Call this ONCE before enabling RSI to establish the starting score.
  app.post("/api/eval/baseline", async (req, res) => {
    const { quick } = req.body as { quick?: boolean };
    const ids = quick ? EVAL_TASKS.filter(t => t.difficulty === "easy").map(t => t.id) : undefined;
    try {
      const run = await runEvaluation(makeRunAgent(), ids);
      saveBaseline(run as unknown as Record<string, unknown>);
      res.json({
        success: true,
        message: "Baseline stored. Enable RSI and let it run, then call GET /api/rsi/proof to see the delta.",
        baseline: {
          percentage: run.percentage,
          passed: run.passed,
          failed: run.failed,
          byCategory: run.byCategory,
          runId: run.runId,
          storedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // GET /api/eval/baseline — retrieve the stored baseline score
  app.get("/api/eval/baseline", (_req, res) => {
    const baseline = loadBaseline();
    if (!baseline) {
      res.status(404).json({
        success: false,
        message: "No baseline stored yet. POST /api/eval/baseline to create one.",
      });
      return;
    }
    res.json({ success: true, baseline });
  });

  // GET /api/rsi/proof — the publishable proof that RSI works
  // Shows baseline score vs latest eval score, with delta per category.
  app.get("/api/rsi/proof", async (_req, res) => {
    const baseline = loadBaseline() as Record<string, unknown> | null;
    const history = getEvalHistory(20);

    if (!baseline) {
      res.status(404).json({
        success: false,
        message: "No baseline stored. POST /api/eval/baseline before enabling RSI.",
      });
      return;
    }

    if (!history || history.length === 0) {
      res.status(404).json({
        success: false,
        message: "No eval runs recorded yet. POST /api/eval/run after RSI cycles to compare.",
      });
      return;
    }

    const latest = history[0] as Record<string, unknown>;
    const baselinePct = (baseline as { percentage?: number }).percentage ?? 0;
    const latestPct = (latest as { percentage?: number }).percentage ?? 0;
    const delta = latestPct - baselinePct;

    const baselineCats = (baseline as { byCategory?: Record<string, { pct: number }> }).byCategory ?? {};
    const latestCats = (latest as { byCategory?: Record<string, { pct: number }> }).byCategory ?? {};
    const categoryDelta: Record<string, { baseline: number; latest: number; delta: number }> = {};
    const allCats = new Set([...Object.keys(baselineCats), ...Object.keys(latestCats)]);
    for (const cat of allCats) {
      const b = baselineCats[cat]?.pct ?? 0;
      const l = latestCats[cat]?.pct ?? 0;
      categoryDelta[cat] = { baseline: b, latest: l, delta: l - b };
    }

    res.json({
      success: true,
      proof: {
        baseline: {
          percentage: baselinePct,
          runId: (baseline as { runId?: string }).runId,
          storedAt: (baseline as { storedAt?: string | number }).storedAt,
        },
        latest: {
          percentage: latestPct,
          runId: (latest as { runId?: string }).runId,
          timestamp: (latest as { timestamp?: number }).timestamp,
        },
        delta: {
          percentage: delta,
          direction: delta > 0 ? "improved" : delta < 0 ? "regressed" : "unchanged",
          summary: `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}% since baseline`,
        },
        byCategory: categoryDelta,
        totalEvalRuns: history.length,
        interpretation: delta > 5
          ? "STRONG IMPROVEMENT: RSI is provably working. Score increased by more than 5% since baseline."
          : delta > 0
          ? "MARGINAL IMPROVEMENT: RSI shows positive trend. Run more cycles to confirm."
          : delta === 0
          ? "NO CHANGE: RSI has not yet improved eval score. Check RSI cycle logs."
          : "REGRESSION: Score dropped since baseline. Review recent RSI proposals.",
      },
    });
  });
}
