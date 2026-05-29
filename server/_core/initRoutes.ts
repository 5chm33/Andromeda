import { validateBody } from "../routes/validate.js";
import { 
  rsiEnableSchema, episodicRecordSchema, planDecomposeSchema 
} from "../routes/zodSchemas.js";
/**
 * initRoutes.ts — v6.04
 *
 * Extracted from _core/index.ts (v6.03 refactor).
 * Registers inline API routes that were defined directly in startServer():
 * - /health
 * - /api/self/introspect
 * - /api/diagnostics
 * - /api/rsi/* (RSI engine endpoints)
 */

import type { Express } from "express";
import { readFileSync } from "fs";

export async function registerCoreRoutes(app: Express): Promise<void> {
  // ── Parameterless health check (UptimeRobot, K8s probes) ─────────────────────
  app.get("/health", (_req, res) => {
    // v6.04: Read version from package.json instead of hardcoding
    let version = "6.04.0";
    try {
      
      const { join } = require("path");
      version = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")).version;
    } catch { /* non-fatal */ }
    res.json({ ok: true, version, timestamp: Date.now() });
  });

  // ── Self-introspection endpoint ───────────────────────────────────────────────
  app.get("/api/self/introspect", async (_req, res) => {
    try {
      const { getSelfModel, describeSelf } = await import("../selfModel.js");
      const model = getSelfModel();
      const description = describeSelf();

      let pendingProposals = 0;
      let recentModifications: any[] = [];
      let activeGoalCount = 0;

      try {
        const { listProposals } = await import("../selfImprove.js");
        pendingProposals = listProposals("pending").length;
      } catch { /* non-fatal */ }

      try {
        const { listMetaGoals } = await import("../recursiveGoals.js");
        activeGoalCount = listMetaGoals({ status: "active" }).length;
      } catch { /* non-fatal */ }

      try {
        const { getModifyStats } = await import("../selfModify.js");
        const stats = getModifyStats();
        recentModifications = stats?.recentHistory?.slice(-5) ?? [];
      } catch { /* non-fatal */ }

      res.json({
        version: model.version,
        identity: model.identity,
        uptime: model.uptime,
        description,
        capabilities: model.capabilities,
        activeGoals: model.activeGoals,
        activeGoalCount,
        pendingProposals,
        resources: model.resources,
        trends: model.trends,
        recentActions: model.recentActions.slice(-10),
        recentModifications,
        currentModel: model.currentModel,
        contextWindow: model.contextWindow,
        lastUpdated: model.lastUpdated,
      });
    } catch (err) {
      res.status(500).json({ error: "Self-introspection failed", message: (err as Error).message });
    }
  });

  // ── Module diagnostics endpoint ───────────────────────────────────────────────
  app.get("/api/diagnostics", async (_req, res) => {
    const diagnostics: Record<string, { status: string; details?: any }> = {};
    const modules: Array<[string, string, string?]> = [
      ["selfHeal", "../selfHeal.js", "getHealStats"],
      ["selfModify", "../selfModify.js", "getModifyStats"],
      ["tokenBudget", "../tokenBudgetManager.js", "getBudgetStats"],
      ["streamIntegrity", "../streamIntegrityMonitor.js", "getStreamStats"],
      ["hotReload", "../hotReload.js", "getHotReloadStats"],
      ["gracefulDegradation", "../gracefulDegradation.js", "getDegradationStats"],
      ["dependencyGraph", "../dependencyGraph.js", "getGraphStats"],
      ["selfMonitor", "../selfMonitor.js", "getMonitorStats"],
      ["selfIntrospect", "../selfIntrospect.js", "getIntrospectionStats"],
      ["contextBus", "../contextBus.js", "getContextBusStats"],
      ["recursionGuard", "../recursionGuard.js", "getGuardStats"],
      ["skillGraph", "../skillGraph.js", "getGraphStats"],
      ["consensusEngine", "../consensusEngine.js", "getConsensusStats"],
      ["continuousImprover", "../continuousImprover.js", "getImproverStats"],
      ["recursiveGoals", "../recursiveGoals.js", "getGoalStats"],
      ["autoGoalSuggester", "../autoGoalSuggester.js", "getSuggesterStats"],
      ["selfModel", "../selfModel.js", "getSelfModelStats"],
      ["autonomyOrchestrator", "../autonomyOrchestrator.js", "getOrchestratorStats"],
      ["sandboxVerifier", "../sandboxVerifier.js", "getVerifierStats"],
      ["multiAgentImprover", "../multiAgentImprover.js", "getMultiAgentStats"],
      ["systemMemory", "../systemMemory.js", "getSystemMemoryStats"],
      ["tieredContextManager", "../tieredContextManager.js", "getContextManagerStats"],
      ["circuitBreaker", "../circuitBreaker.js", "getAllCircuitBreakerStats"],
      ["unifiedKnowledge", "../unifiedKnowledge.js", "getUnifiedKnowledgeStats"],
      ["autonomousGoalGenerator", "../autonomousGoalGenerator.js", "getGoalGeneratorStats"],
      ["selfConsistency", "../selfConsistency.js", "getConsistencyStats"],
      ["adaptiveRouter", "../adaptiveRouter.js", "getRouterStats"],
      ["contextAwareness", "../contextAwareness.js", "getContextAwarenessStats"],
      ["transactionLog", "../transactionLog.js", "getTransactionStats"],
    ];

    for (const [key, modPath, statsFn] of modules) {
      try {
        const mod = await import(modPath);
        const details = statsFn ? (mod[statsFn]?.() ?? "active") : "active";
        diagnostics[key] = { status: "active", details };
      } catch (e) {
        diagnostics[key] = { status: "unavailable", details: (e as Error).message };
      }
    }

    const activeCount = Object.values(diagnostics).filter(d => d.status === "active").length;
    const totalCount = Object.keys(diagnostics).length;

    // v6.04: Read version from package.json
    let version = "6.04.0";
    try {
      
      const { join } = require("path");
      version = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")).version;
    } catch { /* non-fatal */ }

    res.json({
      version,
      timestamp: Date.now(),
      uptime: process.uptime(),
      overall: activeCount === totalCount ? "healthy" : activeCount > totalCount * 0.7 ? "degraded" : "critical",
      modulesActive: activeCount,
      modulesTotal: totalCount,
      modules: diagnostics,
    });
  });

  // ── v5.75: RSI (Recursive Self-Improvement) engine endpoints ──────────────────
  // v6.25: RSI mutation endpoints require admin auth
  const { requireAdminAuth } = await import("../adminAuth.js");
  app.get("/api/rsi/status", async (_req, res) => {
    try {
      const { getRSIStatus } = await import("../rsiEngine.js");
      res.json(getRSIStatus());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  app.post("/api/rsi/enable", requireAdminAuth, validateBody(rsiEnableSchema), async (req, res) => {
    try {
      const { enableRSI } = await import("../rsiEngine.js");
      res.json(enableRSI(req.body || {}));
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  app.post("/api/rsi/disable", requireAdminAuth, async (_req, res) => {
    try {
      const { disableRSI } = await import("../rsiEngine.js");
      res.json(disableRSI());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  app.post("/api/rsi/trigger", requireAdminAuth, async (_req, res) => {
    try {
      const { triggerRSICycleNow } = await import("../rsiEngine.js");
      res.json(await triggerRSICycleNow());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  app.post("/api/rsi/confirm", requireAdminAuth, async (_req, res) => {
    try {
      const { confirmContinue } = await import("../rsiEngine.js");
      res.json(confirmContinue());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  app.get("/api/rsi/history", async (_req, res) => {
    try {
      const { getRSIHistory } = await import("../rsiEngine.js");
      res.json(getRSIHistory());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // ── v6.19: RAG Pipeline ───────────────────────────────────────────────────────
  try {
    const { registerRagRoutes } = await import("../ragPipeline.js");
    registerRagRoutes(app);
  } catch (e) { console.warn("[v6.19] RAG routes failed:", (e as Error).message); }

  // ── v6.19: Observability / Metrics ────────────────────────────────────────────
  try {
    const { registerMetricsRoute, requestTracingMiddleware } = await import("../observability.js");
    requestTracingMiddleware(app);
    registerMetricsRoute(app);
  } catch (e) { console.warn("[v6.19] Observability failed:", (e as Error).message); }

  // ── v6.22: Eval Framework + Baseline + RSI Proof ────────────────────────────────────
  try {
    const { registerEvalRoutes } = await import("../routes/evalRoutes.js");
    registerEvalRoutes(app);
  } catch (e) { console.warn("[v6.22] Eval routes failed:", (e as Error).message); }

  // ── v6.19: Episodic Memory ────────────────────────────────────────────────────
  app.get("/api/episodic/stats", async (_req, res) => {
    try {
      const { getEpisodicStats } = await import("../episodicMemory.js");
      res.json(getEpisodicStats());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  app.post("/api/episodic/record", validateBody(episodicRecordSchema), async (req, res) => {
    try {
      const { recordEpisode } = await import("../episodicMemory.js");
      const episode = await recordEpisode(req.body);
      res.json(episode);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  app.post("/api/episodic/recall", async (req, res) => {
    try {
      const { getEpisodicMemory, synthesizeLessons } = await import("../episodicMemory.js");
      const { goal, topK, synthesize } = req.body;
      if (!goal) { res.status(400).json({ error: "goal required" }); return; }
      const episodes = await getEpisodicMemory(goal, topK ?? 5);
      const lessons = synthesize ? await synthesizeLessons(goal) : undefined;
      res.json({ episodes, lessons });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // ── v6.19: Task Planner ───────────────────────────────────────────────────────
  app.post("/api/plan/decompose", validateBody(planDecomposeSchema), async (req, res) => {
    try {
      const { decomposeTask } = await import("../taskPlanner.js");
      const { goal, context, maxSteps } = req.body;
      if (!goal) { res.status(400).json({ error: "goal required" }); return; }
      const plan = await decomposeTask(goal, context, maxSteps);
      res.json(plan);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
}
