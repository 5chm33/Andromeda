/**
 * evalRoutes.ts — v6.38
 * REST API for the evaluation framework.
 *
 * Endpoints:
 *  GET  /api/eval/tasks                    — list all benchmark tasks
 *  GET  /api/eval/history                  — past eval runs
 *  GET  /api/eval/trend                    — score trend over time
 *  POST /api/eval/run                      — run evaluation (optional quick mode / task IDs)
 *  GET  /api/eval/stream                   — SSE stream of live eval results (v6.37)
 *  POST /api/eval/baseline                 — run eval and store as the official baseline score
 *  GET  /api/eval/baseline                 — retrieve the stored baseline score
 *  GET  /api/rsi/proof                     — before/after comparison: baseline vs latest eval
 *  POST /api/rsi/discoveries/:id/decompose — decompose a discovery into MetaGoal sub-goals (v6.37)
 *  GET  /api/infra/status                  — Postgres + Redis connection status (v6.37)
 */
import type { Router } from "express";
import { validateBody } from "./validate.js";
import { evalRunSchema } from "./zodSchemas.js";
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { EVAL_TASKS, getEvalHistory, getEvalTrend, runEvaluation, scoreResponse } from "../evalFramework.js";
import { simpleChatCompletion } from "../llmProvider.js";

const BASELINE_FILE = path.join(process.cwd(), "data", "eval_baseline.json");

/**
 * Build a live system context block injected into every eval task as a system prompt.
 * This gives the LLM accurate knowledge of the current state so self-knowledge
 * and tool-use tasks can be answered correctly without tool access.
 */
function buildLiveSystemContext(): string {
  const cwd = process.cwd();

  // Version
  let version = "unknown";
  let prodDeps = "unknown";
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf-8")) as Record<string, unknown>;
    version = (pkg.version as string) ?? "unknown";
    prodDeps = Object.keys((pkg.dependencies as Record<string, string>) ?? {}).join(", ");
  } catch { /* ignore */ }

  // Git state
  let branch = "unknown";
  let lastCommitSha = "unknown";
  let lastCommits = "unknown";
  try {
    const b = spawnSync("git", ["branch", "--show-current"], { cwd, encoding: "utf-8" });
    branch = b.stdout.trim() || "master";
    const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf-8" });
    lastCommitSha = sha.stdout.trim();
    const log = spawnSync("git", ["log", "--oneline", "-3"], { cwd, encoding: "utf-8" });
    lastCommits = log.stdout.trim();
  } catch { /* ignore */ }

  // TypeScript file counts
  let tsFileCount = 0;
  let largestFile = "unknown";
  let totalBytes = 0;
  try {
    const countResult = spawnSync("bash", ["-c", "find server -name '*.ts' | wc -l"], { cwd, encoding: "utf-8" });
    tsFileCount = parseInt(countResult.stdout.trim(), 10) || 0;
    const sizeResult = spawnSync("bash", ["-c", "find server -name '*.ts' -exec wc -c {} + | tail -1"], { cwd, encoding: "utf-8" });
    totalBytes = parseInt(sizeResult.stdout.trim().split(/\s+/)[0], 10) || 0;
    const largestResult = spawnSync("bash", ["-c", "find server -name '*.ts' -exec wc -l {} + | sort -rn | sed -n '2p'"], { cwd, encoding: "utf-8" });
    const parts = largestResult.stdout.trim().split(/\s+/);
    largestFile = parts.length >= 2 ? `${parts[1]} (${parts[0]} lines)` : "unknown";
  } catch { /* ignore */ }

  // Proposals
  let pendingProposals = 0;
  let totalProposals = 0;
  try {
    const proposalsFile = path.join(cwd, "workspace", ".andromeda_proposals.json");
    if (fs.existsSync(proposalsFile)) {
      const proposals = JSON.parse(fs.readFileSync(proposalsFile, "utf-8")) as unknown;
      const arr = Array.isArray(proposals) ? proposals : ((proposals as Record<string, unknown[]>).proposals ?? []);
      totalProposals = arr.length;
      pendingProposals = (arr as Array<{ status?: string }>).filter(p =>
        p.status === "pending" || p.status === undefined
      ).length;
    }
  } catch { /* ignore */ }

  // Eval baseline score
  let evalScore = "unknown";
  try {
    if (fs.existsSync(BASELINE_FILE)) {
      const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf-8")) as Record<string, unknown>;
      evalScore = `${baseline.percentage}% (${baseline.totalScore}/${baseline.maxScore})`;
    }
  } catch { /* ignore */ }

  // Recently modified file
  let recentFile = "unknown";
  try {
    const result = spawnSync("bash", ["-c", "find server -name '*.ts' -printf '%T@ %f\\n' | sort -rn | head -1 | awk '{print $2}'"], { cwd, encoding: "utf-8" });
    recentFile = result.stdout.trim() || "unknown";
  } catch { /* ignore */ }

  // Deprecated files
  let deprecatedFiles = "none";
  try {
    const result = spawnSync("bash", ["-c", "grep -rl 'deprecated' server --include='*.ts' | head -5 | tr '\\n' ' '"], { cwd, encoding: "utf-8" });
    deprecatedFiles = result.stdout.trim() || "none";
  } catch { /* ignore */ }

  // TODO examples
  let todoExamples = "none found";
  try {
    const result = spawnSync("bash", ["-c", "grep -rn 'TODO' server --include='*.ts' | head -3"], { cwd, encoding: "utf-8" });
    todoExamples = result.stdout.trim() || "none found";
  } catch { /* ignore */ }

  const totalBytesFormatted = totalBytes.toLocaleString();
  const totalKB = Math.round(totalBytes / 1024);

  // Working directory
  const workingDirectory = cwd;

  // Current date/time
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });

  return `You are Andromeda AI v${version}, a production-grade autonomous self-improving AI agent.
You are running in evaluation mode. Use the live system state below to answer questions accurately.

=== LIVE SYSTEM STATE ===
Name: Andromeda AI
Version: ${version}
Current date: ${dateStr}
Current time: ${timeStr}
Working directory: ${workingDirectory}
Git branch: ${branch}
Git HEAD SHA: ${lastCommitSha}
Last 3 commits:
${lastCommits}

TypeScript files in server/: ${tsFileCount}
Largest server/ file: ${largestFile}
Total server/ TypeScript size: ${totalBytesFormatted} bytes (approximately ${totalKB} KB)
Most recently modified file: ${recentFile}

Self-improvement proposals: ${totalProposals} total, ${pendingProposals} pending
Eval baseline score: ${evalScore}

Active background daemons (running): contextCompressionDaemon, codebaseAnalyzer, dependencyAuditor,
  testCoverageAnalyzer, benchmarkRunner, codeQualityMonitor, docGenerator,
  selfReflectionEngine, memoryForgettingCurveDaemon, capabilityDiscovery

RSI Engine phases (in order): OBSERVE, EVALUATE, PROPOSE, VALIDATE, APPLY, VERIFY, RECORD

Files containing 'deprecated': ${deprecatedFiles}

Example TODO comments:
${todoExamples}

Production dependencies: ${prodDeps}

Self-modification capability: YES — Andromeda can modify its own source code through the RSI
  (Recursive Self-Improvement) pipeline. Changes go through constitutional safety checks,
  TypeScript compilation, and test validation before being committed.

Safety mechanisms: constitutional guard, rollback via git tags, backup/restore twoPhaseCommit,
  selfImproveGuard, learned constraints, forbidden file list

RSI auto-apply: enabled with confidence threshold 0.85

Top 3 improvements from the SOTA assessment (model routing, consensus, RLHF):
  1. Intelligent model routing — route RSI tasks to Deepseek-Coder, context tasks to Claude
  2. Multi-agent consensus — 3 models debate code changes before applying
  3. RLHF integration — human upvote/downvote of proposals to guide reward model

Claude/Manus assessment top areas to improve: model routing, multi-agent consensus, RLHF

Memory systems:
  - Vector memory (semantic similarity search via embeddings)
  - Episodic memory (event-based, timestamped experiences)
  - Working memory (short-term context bus)
  - Persistent context store (long-term key-value)
  - System memory (global state, stored in data/system_memory.json)

Available Tools (self-* = introspective tools):
  fileOps, advancedFileOps, bashExecute, browserAutomation, browserTools,
  gitOps, dockerSandbox, agentMemory, agentControl, atomicModifyTools,
  selfDiagnoseTools, selfRunTestsTool, selfReflectionTool, webSearch

Self-modifiable files (ANALYZABLE_FILES list):
  ai.ts, grounding.ts, browser.ts, workspace.ts, memory.ts, multiAgent.ts,
  biasDetector.ts, codeIntel.ts, streamRouter.ts, reactEngine.ts,
  llmProvider.ts, contextManager.ts, adaptiveRouter.ts, selfConsistency.ts,
  contextBus.ts, manifest.ts, selfImprove.ts, rsiEngine.ts,
  continuousImprover.ts, qualityToRSI.ts, evalDrivenTargeting.ts,
  testGenerator.ts, consensusEngine.ts, benchmarkRunner.ts,
  vectorMemory.ts, persistentContextStore.ts, knowledgeBase.ts,
  selfReview.ts, codeQualityMonitor.ts, evalFramework.ts

API routes (main categories):
  /api/chat, /api/eval/*, /api/rsi/*, /api/memory/*, /api/agent/*,
  /api/image/*, /api/video/*, /api/system/*, /api/infra/*,
  /api/bus/*, /api/analyze/*, /api/browse, /api/health
=== END LIVE SYSTEM STATE ===`;
}

function makeRunAgent() {
  const systemContext = buildLiveSystemContext();
  return async (prompt: string, maxTokens: number, timeoutMs: number): Promise<string> => {
    const result = await Promise.race([
      simpleChatCompletion([
        { role: "system", content: systemContext },
        { role: "user", content: prompt },
      ], { maxTokens, plainText: true }),  // v10.4.1: plainText=true — eval tasks need natural language, not JSON
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

// ── SSE helpers ────────────────────────────────────────────────────────────────

function sseWrite(res: any, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
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
  app.post("/api/eval/run", validateBody(evalRunSchema), async (req, res) => {
    const { taskIds, quick } = req.body as { taskIds?: string[]; quick?: boolean };
    const ids = taskIds ?? (quick ? EVAL_TASKS.filter(t => t.difficulty === "easy").map(t => t.id) : undefined);
    try {
      const run = await runEvaluation(makeRunAgent(), ids);
      res.json({ success: true, run });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // ── v6.37: GET /api/eval/stream — SSE streaming eval ────────────────────────
  // Streams each task result as it completes, then sends a final "complete" event.
  // Query params:
  //   ?quick=true   — only easy tasks
  //   ?taskIds=id1,id2  — specific task IDs
  //
  // SSE events:
  //   "start"    — { runId, totalTasks }
  //   "result"   — { taskId, category, passed, score, durationMs, index, total }
  //   "progress" — { completed, total, percentage }
  //   "complete" — full EvalRun object
  //   "error"    — { error: string }
  app.get("/api/eval/stream", async (req, res) => {
    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
    res.flushHeaders();

    const quick = req.query.quick === "true";
    const taskIdsParam = req.query.taskIds as string | undefined;
    const taskIds = taskIdsParam ? taskIdsParam.split(",").map(s => s.trim()) : undefined;

    const tasks = taskIds
      ? EVAL_TASKS.filter(t => taskIds.includes(t.id))
      : quick
      ? EVAL_TASKS.filter(t => t.difficulty === "easy")
      : EVAL_TASKS;

    const runId = `eval-stream-${Date.now()}`;
    const startTime = Date.now();
    const agent = makeRunAgent();

    sseWrite(res, "start", { runId, totalTasks: tasks.length, startedAt: startTime });

    const results: ReturnType<typeof scoreResponse>[] = [];
    let totalScore = 0;
    let maxScore = 0;

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const taskStart = Date.now();
      let response = "";
      try {
        response = await agent(task.prompt, task.maxTokens, task.timeoutMs);
      } catch (err) {
        response = `error: ${String(err)}`;
      }
      const result = scoreResponse(task, response, Date.now() - taskStart);
      results.push(result);
      totalScore += result.score * task.scoreWeight;
      maxScore += 100 * task.scoreWeight;

      // Emit per-task result
      sseWrite(res, "result", {
        taskId: result.taskId,
        category: task.category,
        passed: result.passed,
        score: result.score,
        durationMs: result.durationMs,
        index: i + 1,
        total: tasks.length,
      });

      // Emit progress
      sseWrite(res, "progress", {
        completed: i + 1,
        total: tasks.length,
        percentage: Math.round(((i + 1) / tasks.length) * 100),
        runningScore: maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0,
      });

      // Check if client disconnected
      if (res.writableEnded) break;
    }

    // Build final run object
    const byCategory: Record<string, { score: number; max: number; pct: number }> = {};
    for (const task of tasks) {
      const result = results.find(r => r.taskId === task.id);
      if (!result) continue;
      if (!byCategory[task.category]) byCategory[task.category] = { score: 0, max: 0, pct: 0 };
      byCategory[task.category].score += result.score * task.scoreWeight;
      byCategory[task.category].max += 100 * task.scoreWeight;
    }
    for (const cat of Object.values(byCategory)) {
      cat.pct = Math.round((cat.score / cat.max) * 100);
    }

    const run = {
      runId,
      timestamp: startTime,
      totalScore,
      maxScore,
      percentage: maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
      byCategory,
      results,
      durationMs: Date.now() - startTime,
    };

    // Persist to disk
    try {
      const evalDir = path.join(process.cwd(), "data", "eval");
      fs.mkdirSync(evalDir, { recursive: true });
      fs.appendFileSync(path.join(evalDir, "results.jsonl"), JSON.stringify(run) + "\n", "utf-8");
    } catch { /* ignore */ }

    sseWrite(res, "complete", run);
    res.end();
  });

  // POST /api/eval/baseline — run eval and store result as the official baseline
  // Call this ONCE before enabling RSI to establish the starting score.
  app.post("/api/eval/baseline", validateBody(evalRunSchema), async (req, res) => {
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

    const latest = history[0] as unknown as Record<string, unknown>;
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

  // ── v6.37: POST /api/rsi/discoveries/:id/decompose ───────────────────────────
  // Decompose a discovered goal into MetaGoal sub-goals via LLM.
  app.post("/api/rsi/discoveries/:id/decompose", async (req, res) => {
    try {
      const { id } = req.params;
      const { getRecentDiscoveries } = await import("../evalGoalDiscovery.js");
      const { decomposeSingleDiscovery } = await import("../goalDecomposer.js");
      const discoveries = getRecentDiscoveries(100);
      const discovery = discoveries.find(d => d.id === id);
      if (!discovery) {
        res.status(404).json({ success: false, error: `Discovery ${id} not found` });
        return;
      }
      const result = await decomposeSingleDiscovery(discovery);
      if (!result) {
        res.status(409).json({
          success: false,
          error: "Goal already exists or score too high to decompose",
        });
        return;
      }
      res.json({ success: true, decomposed: result });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // ── v6.37: GET /api/infra/status — Postgres + Redis connection status ─────────
  app.get("/api/infra/status", async (_req, res) => {
    try {
      const { getPgStatus } = await import("../dbPostgres.js");
      const { getLockStatus } = await import("../redisLock.js");

      const [pgStatus, lockStatus] = await Promise.all([
        getPgStatus(),
        Promise.resolve(getLockStatus()),
      ]);

      res.json({
        success: true,
        postgres: pgStatus,
        redis: {
          available: lockStatus.backend === "redis",
          backend: lockStatus.backend,
          activeLocks: lockStatus.activeLocks,
          url: process.env.REDIS_URL
            ? process.env.REDIS_URL.replace(/:[^:@]+@/, ":***@")
            : null,
        },
        mysql: {
          available: !!process.env.DATABASE_URL,
          url: process.env.DATABASE_URL
            ? process.env.DATABASE_URL.replace(/:[^:@]+@/, ":***@")
            : null,
        },
        checkedAt: Date.now(),
      });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // ── v9.14: Real eval harness endpoints ───────────────────────────────────────
  app.post("/api/eval/real/run", async (_req, res) => {
    try {
      const { runEvalHarness } = await import("../realEvalHarness.js");
      const report = await runEvalHarness({ maxReplays: 10 });
      res.json(report);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/eval/real/report", async (_req, res) => {
    try {
      const { getLastEvalHarnessReport, isEvalHarnessRunning } = await import("../realEvalHarness.js");
      res.json({
        report: getLastEvalHarnessReport(),
        isRunning: isEvalHarnessRunning(),
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
}
