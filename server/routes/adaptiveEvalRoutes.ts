/**
 * adaptiveEvalRoutes.ts — v6.40
 *
 * HTTP endpoints for the Adaptive Evaluation System.
 *
 * Endpoints:
 *   POST /api/adaptive-eval/run              — run a full adaptive eval
 *   POST /api/adaptive-eval/generate         — generate new benchmark tasks (no run)
 *   GET  /api/adaptive-eval/benchmarks       — list all adaptive benchmarks
 *   GET  /api/adaptive-eval/benchmarks/:id   — get a specific benchmark
 *   DELETE /api/adaptive-eval/benchmarks/:id — retire a benchmark manually
 *   GET  /api/adaptive-eval/history          — recent adaptive eval runs
 *   GET  /api/adaptive-eval/gap-analysis     — current gap analysis
 *   GET  /api/adaptive-eval/evolution-stats  — benchmark evolution statistics
 */

import { Router, type Request, type Response } from "express";
import {
  runAdaptiveEval,
  generateBenchmarks,
  getAdaptiveBenchmarks,
  getAdaptiveEvalHistory,
  getLatestGapAnalysis,
  getBenchmarkEvolutionStats,
  analyzeGaps,
  type TaskLifecycle,
} from "../adaptiveEval.js";
import { requireOperator, requireAdmin } from "../rbac.js";
import type { EvalTask } from "../evalFramework.js";

export const adaptiveEvalRouter = Router();

// ── Run adaptive eval ──────────────────────────────────────────────────────────

/**
 * POST /api/adaptive-eval/run
 * Run a full adaptive eval: gap analysis → generate tasks → run → evolve benchmarks.
 */
adaptiveEvalRouter.post("/run", requireOperator, async (req: Request, res: Response) => {
  const {
    generateNew = true,
    newTaskCount = 3,
    totalTaskBudget = 20,
  } = req.body ?? {};

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 min timeout

  try {
    const run = await runAdaptiveEval({
      generateNew: Boolean(generateNew),
      newTaskCount: Math.min(10, Math.max(1, Number(newTaskCount))),
      totalTaskBudget: Math.min(50, Math.max(5, Number(totalTaskBudget))),
      signal: controller.signal,
    });
    res.json({ success: true, run });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  } finally {
    clearTimeout(timeout);
  }
});

// ── Generate benchmarks ────────────────────────────────────────────────────────

/**
 * POST /api/adaptive-eval/generate
 * Generate new benchmark tasks without running an eval.
 */
adaptiveEvalRouter.post("/generate", requireAdmin, async (req: Request, res: Response) => {
  const {
    count = 3,
    category,
    difficulty,
  } = req.body ?? {};

  const gap = analyzeGaps();

  try {
    const benchmarks = await generateBenchmarks({
      count: Math.min(10, Math.max(1, Number(count))),
      targetCategory: category as EvalTask["category"] | undefined,
      targetDifficulty: difficulty as EvalTask["difficulty"] | undefined,
      gapAnalysis: gap,
    });
    res.status(201).json({
      success: true,
      generated: benchmarks.length,
      benchmarks,
      gapAnalysis: gap,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── List benchmarks ────────────────────────────────────────────────────────────

/**
 * GET /api/adaptive-eval/benchmarks
 * List all adaptive benchmarks with optional filters.
 */
adaptiveEvalRouter.get("/benchmarks", requireOperator, (req: Request, res: Response) => {
  const { lifecycle, category, difficulty } = req.query as Record<string, string | undefined>;

  const benchmarks = getAdaptiveBenchmarks({
    lifecycle: lifecycle as TaskLifecycle | undefined,
    category: category as EvalTask["category"] | undefined,
    difficulty: difficulty as EvalTask["difficulty"] | undefined,
  });

  res.json({
    benchmarks,
    count: benchmarks.length,
    stats: getBenchmarkEvolutionStats(),
  });
});

/**
 * GET /api/adaptive-eval/benchmarks/:id
 * Get a specific benchmark by ID.
 */
adaptiveEvalRouter.get("/benchmarks/:id", requireOperator, (req: Request, res: Response) => {
  const benchmarks = getAdaptiveBenchmarks();
  const benchmark = benchmarks.find(b => b.id === req.params.id);
  if (!benchmark) {
    res.status(404).json({ error: `Benchmark '${req.params.id}' not found` });
    return;
  }
  res.json({ benchmark });
});

/**
 * DELETE /api/adaptive-eval/benchmarks/:id
 * Manually retire a benchmark.
 */
adaptiveEvalRouter.delete("/benchmarks/:id", requireAdmin, (req: Request, res: Response) => {
  const benchmarks = getAdaptiveBenchmarks();
  const benchmark = benchmarks.find(b => b.id === req.params.id);
  if (!benchmark) {
    res.status(404).json({ error: `Benchmark '${req.params.id}' not found` });
    return;
  }
  benchmark.lifecycle = "retired_hard";
  res.json({ success: true, message: `Benchmark ${req.params.id} retired` });
});

// ── History ────────────────────────────────────────────────────────────────────

/**
 * GET /api/adaptive-eval/history
 * Get recent adaptive eval run history.
 */
adaptiveEvalRouter.get("/history", requireOperator, (req: Request, res: Response) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)));
  const history = getAdaptiveEvalHistory(limit);
  res.json({ history, count: history.length });
});

// ── Gap analysis ───────────────────────────────────────────────────────────────

/**
 * GET /api/adaptive-eval/gap-analysis
 * Get the current gap analysis based on recent eval history.
 */
adaptiveEvalRouter.get("/gap-analysis", requireOperator, (_req: Request, res: Response) => {
  const gap = getLatestGapAnalysis();
  res.json({ gapAnalysis: gap });
});

// ── Evolution stats ────────────────────────────────────────────────────────────

/**
 * GET /api/adaptive-eval/evolution-stats
 * Get benchmark evolution statistics.
 */
adaptiveEvalRouter.get("/evolution-stats", requireOperator, (_req: Request, res: Response) => {
  const stats = getBenchmarkEvolutionStats();
  res.json({ stats });
});
