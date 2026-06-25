import { validateBody } from "../routes/validate.js";
import { 
  rsiEnableSchema, episodicRecordSchema, planDecomposeSchema 
} from "../routes/zodSchemas.js";
import { adminRouter } from "../routes/adminRoutes.js";
import { federatedRouter } from "../routes/federatedRoutes.js";
import { adaptiveEvalRouter } from "../routes/adaptiveEvalRoutes.js";
import { v7Router } from "../routes/v7Routes.js";
import { v71Router } from "../routes/v71Routes.js";
import { telemetryMiddleware } from "../telemetry.js";
import { attachRbacContext, auditMiddleware, roleRateLimit } from "../rbac.js";
/**
 * initRoutes.ts — v6.38
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
  // ── v6.38: RBAC context + audit middleware (applied globally before all routes) ──
  app.use(attachRbacContext);
  app.use(auditMiddleware);
  app.use(roleRateLimit);

  // ── v6.38: Admin routes (RBAC + audit log + tenant management) ──────────────
  app.use("/api/admin", adminRouter);

  // ── v6.39: Federated learning routes (multi-node RSI sync) ────────────────
  app.use("/api/federated", federatedRouter);

  // ── v6.40: Adaptive eval routes (LLM-generated benchmarks) ────────────────
  app.use("/api/adaptive-eval", adaptiveEvalRouter);

  // ── v7.0: Watchdog, telemetry, capability manifest, roadmap ────────────────
  app.use("/api/v7", v7Router);

  // ── v7.1: Auto-rebuild, RLHF, PR generator, knowledge transfer ───────────
  app.use("/api/v71", v71Router);
  app.use(telemetryMiddleware());

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
      const { getCostStats } = await import("../llmProvider.js");
      const { getRsiSchedulerStatus } = await import("../rsiScheduler.js");
      const rsiStatus = getRSIStatus();
      const schedulerStatus = getRsiSchedulerStatus();
      // v11.292.0: Attach live cost tracking + scheduler paused state to the RSI status response
      res.json({ ...rsiStatus, costStats: getCostStats(), schedulerPaused: schedulerStatus.paused ?? false });
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
      // v6.31: Read from DB when available, fall back to JSON store
      const { dbLoadCycles } = await import("../rsiDb.js");
      const dbCycles = await dbLoadCycles(100);
      if (dbCycles.length > 0) {
        res.json({ cycles: dbCycles, source: "db" });
        return;
      }
      const { getRSIHistory } = await import("../rsiEngine.js");
      res.json({ cycles: getRSIHistory(), source: "json" });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // ── v9.9.0: Combined RSI health endpoint (RSI engine + ContinuousImprover at a glance) ──────────
  app.get("/api/rsi/health", async (_req, res) => {
    try {
      const [rsiMod, ciMod, proposalsMod] = await Promise.allSettled([
        import("../rsiEngine.js"),
        import("../continuousImprover.js"),
        import("../selfImprove.js"),
      ]);
      const rsiStatus = rsiMod.status === "fulfilled" ? (rsiMod.value as any).getRSIStatus?.() : null;
      const ciStats = ciMod.status === "fulfilled" ? (ciMod.value as any).getImproverStats?.() : null;
      const proposals = proposalsMod.status === "fulfilled" ? (proposalsMod.value as any).listProposals?.() ?? [] : [];
      const byStatus = proposals.reduce((acc: Record<string, number>, p: any) => {
        acc[p.status] = (acc[p.status] || 0) + 1; return acc;
      }, {});
      res.json({
        ok: true,
        timestamp: Date.now(),
        rsi: rsiStatus,
        continuousImprover: ciStats,
        proposals: { total: proposals.length, byStatus },
      });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // ── v9.10.0: Git commit log feed (for dashboard) ──────────────────────────────
  app.get("/api/git/log", async (req, res) => {
    try {
      const { execSync } = await import("child_process");
      const limit = Math.min(parseInt((req.query.limit as string) || "30", 10), 100);
      const raw = execSync(
        `git log --format='%H|%s|%an|%ai' -${limit}`,
        { cwd: process.cwd(), encoding: "utf-8", timeout: 5000 }
      ).trim();
      // v11.291.0: Determine which commits have been pushed to remote
      let pushedHashes = new Set<string>();
      try {
        const remoteLog = execSync(
          "git log --format='%H' origin/main",
          { cwd: process.cwd(), encoding: "utf-8", timeout: 5000 }
        ).trim();
        remoteLog.split("\n").filter(Boolean).forEach(h => pushedHashes.add(h.trim()));
      } catch { /* remote may not be reachable — non-fatal */ }
      // v11.291.0: Get remote sync status
      let syncStatus = "unknown";
      let aheadCount = 0;
      try {
        const revList = execSync(
          "git rev-list --count --left-right HEAD...origin/main",
          { cwd: process.cwd(), encoding: "utf-8", timeout: 5000 }
        ).trim();
        const [ahead, behind] = revList.split("\t").map(Number);
        aheadCount = ahead || 0;
        syncStatus = ahead === 0 ? "synced" : `${ahead} ahead`;
      } catch { syncStatus = "unknown"; }
      const commits = raw.split("\n").filter(Boolean).map(line => {
        const parts = line.split("|");
        const fullHash = parts[0] || "";
        return {
          hash: fullHash.slice(0, 8),
          fullHash,
          subject: parts[1],
          author: parts[2],
          date: parts[3],
          pushed: pushedHashes.has(fullHash),
          isRsiCommit: /andromeda self-improvement|rsi|autonomous|self-improv/i.test(parts[1] || ""),
        };
      });
      res.json({ commits, syncStatus, aheadCount });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // ── v9.10.0: Vector memory stats (neural vs TF-IDF) ──────────────────────────
  app.get("/api/memory/vector-stats", async (_req, res) => {
    try {
      const [vmMod, memMod] = await Promise.allSettled([
        import("../vectorMemory.js"),
        import("../memory.js"),
      ]);
      const vectorStats = vmMod.status === "fulfilled" ? (vmMod.value as any).vectorStats?.() : null;
      const memStats = memMod.status === "fulfilled" ? (memMod.value as any).getMemoryStats?.() : null;
      res.json({ vector: vectorStats, memory: memStats, neuralActive: (vectorStats?.entryCount ?? 0) > 0 });
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
      const { generatePlan } = await import("../taskPlanner.js");
      const { goal, context, maxSteps } = req.body;
      if (!goal) { res.status(400).json({ error: "goal required" }); return; }
      const plan = await generatePlan(goal, context ?? "", { maxSteps });
      res.json(plan);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // -- v6.30: CI Pipeline --
  app.post("/api/ci/run", async (req, res) => {
    try {
      const { runCiPipeline } = await import("../ciPipeline.js");
      const { proposalId, snapshotId, skipBuild, skipTests, skipTypecheck, skipReload } = req.body ?? {};
      const result = await runCiPipeline(proposalId, snapshotId, { skipBuild, skipTests, skipTypecheck, skipReload });
      res.json(result);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  app.get("/api/ci/status", async (_req, res) => {
    try {
      const { getCiStatus } = await import("../ciPipeline.js");
      res.json(getCiStatus());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  app.get("/api/ci/history", async (req, res) => {
    try {
      const { getCiHistory } = await import("../ciPipeline.js");
      const limit = parseInt(String((req.query as any).limit ?? "20"), 10);
      res.json(getCiHistory(limit));
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // -- v6.30: Import Graph --
  app.get("/api/system/import-graph", async (_req, res) => {
    try {
      const { getGraphSummary } = await import("../importGraph.js");
      res.json(await getGraphSummary());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  app.post("/api/system/import-graph/usages", async (req, res) => {
    try {
      const { findSymbolUsages } = await import("../importGraph.js");
      const { file, symbol } = req.body ?? {};
      if (!file || !symbol) { res.status(400).json({ error: "file and symbol required" }); return; }
      const usages = await findSymbolUsages(file, symbol);
      res.json({ usages });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  app.post("/api/system/import-graph/validate", async (req, res) => {
    try {
      const { validateRefactoring } = await import("../importGraph.js");
      const { changes } = req.body ?? {};
      if (!changes) { res.status(400).json({ error: "changes array required" }); return; }
      const validation = await validateRefactoring(changes);
      res.json(validation);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // -- v6.30: RSI DB + Lock status --
  app.get("/api/rsi/db/status", async (_req, res) => {
    try {
      const { getRsiDbStatus } = await import("../rsiDb.js");
      res.json(getRsiDbStatus());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  app.get("/api/system/locks", async (_req, res) => {
    try {
      const { getLockStatus } = await import("../redisLock.js");
      res.json(getLockStatus());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // ── v9.0: Gödel Machine API routes (proofVerifier, utilityFunction, semanticSelfModel, causal, MCTS, epistemic, AST) ─
  try {
    const { registerGodelRoutes } = await import('../routes/godelRoutes.js');
    registerGodelRoutes(app);
    console.log('[GodelRoutes] v9.0: Gödel Machine API routes registered (/api/godel/*)');
  } catch (e) { console.warn('[GodelRoutes] Registration failed:', (e as Error).message); }

  // ── v11.0: Docker Sandbox execution endpoints ───────────────────────────────
  // GET /api/sandbox/status — check if Docker is available on this host
  app.get('/api/sandbox/status', async (_req, res) => {
    try {
      const { isDockerAvailable } = await import('../dockerSandbox.js');
      const available = await isDockerAvailable();
      res.json({
        available,
        message: available
          ? 'Docker sandbox ready — isolated code execution enabled'
          : 'Docker not available — install Docker Engine: curl -fsSL https://get.docker.com | sh',
      });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // POST /api/sandbox/execute — run code in an isolated Docker container
  app.post('/api/sandbox/execute', requireAdminAuth, async (req, res) => {
    try {
      const { executeInSandbox, isDockerAvailable } = await import('../dockerSandbox.js');
      const { code, language = 'javascript', timeoutMs = 10000, memoryMb = 256 } = req.body ?? {};
      if (!code) { res.status(400).json({ error: 'code is required' }); return; }
      const available = await isDockerAvailable();
      if (!available) {
        res.status(503).json({
          error: 'Docker is not available on this host',
          hint: 'Install Docker Engine: curl -fsSL https://get.docker.com | sh',
          fallback: 'Andromeda will use the local sandboxManager as a fallback',
        });
        return;
      }
      const result = await executeInSandbox(code, language, { timeoutMs, memoryLimit: `${memoryMb}m` });
      res.json(result);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  console.log('[DockerSandbox] v11.0: /api/sandbox/execute and /api/sandbox/status registered');

  // ─── Phase 1: Cost Optimization Routes ────────────────────────────────────
  app.get('/api/cost/stats', requireAdminAuth, async (req, res) => {
    try {
      const { getCostStats } = await import('../costOptimizer.js');
      res.json(getCostStats());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  console.log('[CostOptimizer] v1.0: /api/cost/stats registered');

  // ─── Phase 2: Swarm Specialist Voting Routes ───────────────────────────────
  app.get('/api/swarm/voting/stats', requireAdminAuth, async (req, res) => {
    try {
      const { getVotingStats } = await import('../swarmSpecialistVoting.js');
      res.json(getVotingStats());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.get('/api/swarm/voting/history', requireAdminAuth, async (req, res) => {
    try {
      const { getVotingHistory } = await import('../swarmSpecialistVoting.js');
      const limit = parseInt(String(req.query.limit ?? '50'), 10);
      res.json(getVotingHistory(limit));
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.post('/api/swarm/voting/enable', requireAdminAuth, async (req, res) => {
    try {
      const { enableSwarmVoting } = await import('../swarmSpecialistVoting.js');
      enableSwarmVoting();
      res.json({ enabled: true });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.post('/api/swarm/voting/disable', requireAdminAuth, async (req, res) => {
    try {
      const { disableSwarmVoting } = await import('../swarmSpecialistVoting.js');
      disableSwarmVoting();
      res.json({ enabled: false });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  console.log('[SwarmVoting] v1.0: /api/swarm/voting/* registered');

  // ─── Phase 2: Long-Term Memory Routes ─────────────────────────────────────
  app.get('/api/memory/longterm/stats', requireAdminAuth, async (req, res) => {
    try {
      const { getLongTermMemoryStats } = await import('../longTermMemoryConsolidation.js');
      res.json(getLongTermMemoryStats());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.get('/api/memory/longterm/patterns', requireAdminAuth, async (req, res) => {
    try {
      const { getTopPatterns } = await import('../longTermMemoryConsolidation.js');
      const limit = parseInt(String(req.query.limit ?? '20'), 10);
      res.json(getTopPatterns(limit));
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.post('/api/memory/longterm/consolidate', requireAdminAuth, async (req, res) => {
    try {
      const { runLongTermConsolidation } = await import('../longTermMemoryConsolidation.js');
      const result = await runLongTermConsolidation();
      res.json(result);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  console.log('[LongTermMemory] v1.0: /api/memory/longterm/* registered');

  // ─── Phase 3: Algorithmic Discovery Routes ─────────────────────────────────
  app.get('/api/algo/stats', requireAdminAuth, async (req, res) => {
    try {
      const { getAlgorithmRegistryStats } = await import('../algorithmicDiscoveryV2.js');
      res.json(getAlgorithmRegistryStats());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.post('/api/algo/tournament', requireAdminAuth, async (req, res) => {
    try {
      const { runDiscoveryTournament } = await import('../algorithmicDiscoveryV2.js');
      const { capability } = req.body ?? {};
      if (!capability) { res.status(400).json({ error: 'capability is required' }); return; }
      const result = await runDiscoveryTournament(capability);
      res.json(result);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.post('/api/algo/refine', requireAdminAuth, async (req, res) => {
    try {
      const { refineActiveAlgorithm } = await import('../algorithmicDiscoveryV2.js');
      const { capability, iterations = 2 } = req.body ?? {};
      if (!capability) { res.status(400).json({ error: 'capability is required' }); return; }
      const result = await refineActiveAlgorithm(capability, iterations);
      res.json(result);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  console.log('[AlgoDiscoveryV2] v2.0: /api/algo/* registered');

  // ─── Phase 3: Cross-Domain Adapter Routes ──────────────────────────────────
  app.get('/api/crossdomain/stats', requireAdminAuth, async (req, res) => {
    try {
      const { getCrossDomainStats } = await import('../crossDomainAdapter.js');
      res.json(getCrossDomainStats());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.post('/api/crossdomain/artifact', requireAdminAuth, async (req, res) => {
    try {
      const { registerArtifact } = await import('../crossDomainAdapter.js');
      const { domain, name, content, metadata } = req.body ?? {};
      if (!domain || !name || !content) { res.status(400).json({ error: 'domain, name, content required' }); return; }
      const artifact = registerArtifact(domain, name, content, metadata ?? {});
      res.json(artifact);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.post('/api/crossdomain/propose/:artifactId', requireAdminAuth, async (req, res) => {
    try {
      const { generateDomainProposal } = await import('../crossDomainAdapter.js');
      const result = await generateDomainProposal(req.params.artifactId);
      if (!result) { res.status(404).json({ error: 'Artifact not found or proposal generation failed' }); return; }
      res.json(result);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  console.log('[CrossDomain] v1.0: /api/crossdomain/* registered');

  // ─── Q1 2027: Ollama Local LLM Routes ───────────────────────────────────────────
  app.get('/api/ollama/status', requireAdminAuth, async (req, res) => {
    try {
      const { getOllamaStatus } = await import('../ollamaAutoSetup.js');
      res.json(getOllamaStatus());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.get('/api/ollama/setup-guide', requireAdminAuth, async (req, res) => {
    try {
      const { getSetupGuide } = await import('../ollamaAutoSetup.js');
      res.json(getSetupGuide());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.get('/api/ollama/models', requireAdminAuth, async (req, res) => {
    try {
      const { getRecommendedModels } = await import('../ollamaAutoSetup.js');
      res.json(getRecommendedModels());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.post('/api/ollama/pull', requireAdminAuth, async (req, res) => {
    try {
      const { pullOllamaModel } = await import('../ollamaAutoSetup.js');
      const { model } = req.body ?? {};
      if (!model) { res.status(400).json({ error: 'model is required' }); return; }
      const success = await pullOllamaModel(model);
      res.json({ success });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  console.log('[OllamaAutoSetup] v1.0: /api/ollama/* registered');

  // ─── Q3 2026: Robotics/IoT Routes ───────────────────────────────────────────────
  app.get('/api/robotics/stats', requireAdminAuth, async (req, res) => {
    try {
      const { getRoboticsStats } = await import('../roboticsIoTAdapter.js');
      res.json(getRoboticsStats());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.post('/api/robotics/artifact', requireAdminAuth, async (req, res) => {
    try {
      const { registerRoboticsArtifact } = await import('../roboticsIoTAdapter.js');
      const { type, name, content, metadata } = req.body ?? {};
      if (!type || !name || !content) { res.status(400).json({ error: 'type, name, content required' }); return; }
      const artifact = registerRoboticsArtifact(type, name, content, metadata ?? {});
      res.json(artifact);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.post('/api/robotics/propose/:artifactId', requireAdminAuth, async (req, res) => {
    try {
      const { generateRoboticsProposal } = await import('../roboticsIoTAdapter.js');
      const result = await generateRoboticsProposal(req.params.artifactId);
      if (!result) { res.status(404).json({ error: 'Artifact not found or proposal generation failed' }); return; }
      res.json(result);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.post('/api/robotics/approve/:proposalId', requireAdminAuth, async (req, res) => {
    try {
      const { approveRoboticsProposal } = await import('../roboticsIoTAdapter.js');
      const success = approveRoboticsProposal(req.params.proposalId);
      res.json({ success });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  console.log('[RoboticsIoT] v1.0: /api/robotics/* registered');

  // ─── Q4 2026: Novelty Search Routes ──────────────────────────────────────────────
  app.get('/api/novelty/stats', requireAdminAuth, async (req, res) => {
    try {
      const { getNoveltySearchStats } = await import('../noveltySearchEngine.js');
      res.json(getNoveltySearchStats());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.get('/api/novelty/archive', requireAdminAuth, async (req, res) => {
    try {
      const { getArchive } = await import('../noveltySearchEngine.js');
      res.json(getArchive());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.get('/api/novelty/discoveries', requireAdminAuth, async (req, res) => {
    try {
      const { getDiscoveries } = await import('../noveltySearchEngine.js');
      const limit = parseInt(String(req.query.limit ?? '20'), 10);
      res.json(getDiscoveries(limit));
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.post('/api/novelty/search', requireAdminAuth, async (req, res) => {
    try {
      const { runNoveltySearchCycle } = await import('../noveltySearchEngine.js');
      const result = await runNoveltySearchCycle();
      res.json(result ?? { message: 'No novel capability discovered in this cycle' });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  console.log('[NoveltySearch] v1.0: /api/novelty/* registered');

  // ─── Q4 2026: Zero-Shot Transfer Routes ──────────────────────────────────────────
  app.get('/api/transfer/stats', requireAdminAuth, async (req, res) => {
    try {
      const { getTransferStats } = await import('../zeroShotTransferEngine.js');
      res.json(getTransferStats());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.get('/api/transfer/principles/:domain', requireAdminAuth, async (req, res) => {
    try {
      const { getPrinciplesForDomain } = await import('../zeroShotTransferEngine.js');
      res.json(getPrinciplesForDomain(req.params.domain as import('../zeroShotTransferEngine.js').KnowledgeDomain));
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.post('/api/transfer/run/:domain', requireAdminAuth, async (req, res) => {
    try {
      const { transferAllToDomain } = await import('../zeroShotTransferEngine.js');
      const results = await transferAllToDomain(req.params.domain as import('../zeroShotTransferEngine.js').KnowledgeDomain);
      res.json({ transferred: results.length, results });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  console.log('[ZeroShotTransfer] v1.0: /api/transfer/* registered');
  // ─── v11.1.0: Behavioral Regression Engine Routes ────────────────────────────────────
  app.get('/api/behavioral-regression/stats', requireAdminAuth, async (req, res) => {
    try {
      const { getBehavioralRegressionStats } = await import('../behavioralRegressionEngine.js');
      res.json(getBehavioralRegressionStats());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  app.post('/api/behavioral-regression/check', requireAdminAuth, async (req, res) => {
    try {
      const { runBehavioralRegressionStage } = await import('../behavioralRegressionEngine.js');
      const { targetFile } = req.body as { targetFile: string };
      if (!targetFile) return res.status(400).json({ error: 'targetFile required' });
      const result = runBehavioralRegressionStage(targetFile);
      res.json(result);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  console.log('[BehavioralRegression] v11.1.0: /api/behavioral-regression/* registered');
  // ─── v11.1.0: RAG Context Optimizer Routes ────────────────────────────────────────────
  app.get('/api/rag-context/stats', requireAdminAuth, async (req, res) => {
    try {
      const { getRagContextStats } = await import('../ragContextOptimizer.js');
      res.json(getRagContextStats());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  app.post('/api/rag-context/build', requireAdminAuth, async (req, res) => {
    try {
      const { buildRagContext } = await import('../ragContextOptimizer.js');
      const { targetFile } = req.body as { targetFile: string };
      if (!targetFile) return res.status(400).json({ error: 'targetFile required' });
      const result = buildRagContext(targetFile);
      res.json(result);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  console.log('[RagContext] v11.1.0: /api/rag-context/* registered');
  // ─── v11.1.0: Hybrid Cost Router Routes ──────────────────────────────────────────────
  app.get('/api/hybrid-router/stats', requireAdminAuth, async (req, res) => {
    try {
      const { getHybridRouterStats } = await import('../hybridCostRouter.js');
      res.json(getHybridRouterStats());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  app.get('/api/hybrid-router/models', requireAdminAuth, async (req, res) => {
    try {
      const { getModelRegistry } = await import('../hybridCostRouter.js');
      res.json(getModelRegistry());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  app.post('/api/hybrid-router/select', requireAdminAuth, async (req, res) => {
    try {
      const { selectModelForProposal } = await import('../hybridCostRouter.js');
      const { complexityScore = 5, impact = 'medium', dependentCount = 0, consecutiveFailures = 0 } = req.body as any;
      const result = selectModelForProposal(complexityScore, impact, dependentCount, consecutiveFailures);
      res.json(result);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  console.log('[HybridCostRouter] v11.1.0: /api/hybrid-router/* registered');

  // ─── v11.293.0: Fix Any GitHub Repo endpoints ────────────────────────────────
  // POST /api/rsi/fix-external-repo — start an autonomous fix job
  app.post('/api/rsi/fix-external-repo', requireAdminAuth, async (req, res) => {
    try {
      const { startFixJob } = await import('../externalRepoFixer.js');
      const { repoUrl, githubPat, cycles, branchPrefix, prTitle, prBody } = req.body as {
        repoUrl: string;
        githubPat?: string;
        cycles?: number;
        branchPrefix?: string;
        prTitle?: string;
        prBody?: string;
      };
      if (!repoUrl || typeof repoUrl !== 'string') {
        return res.status(400).json({ error: 'repoUrl is required' });
      }
      if (!repoUrl.includes('github.com')) {
        return res.status(400).json({ error: 'Only GitHub repositories are supported' });
      }
      const job = await startFixJob({ repoUrl, githubPat, cycles, branchPrefix, prTitle, prBody });
      res.json({ jobId: job.id, status: job.status, message: 'Fix job started' });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // GET /api/rsi/fix-external-repo/:jobId — get job status
  app.get('/api/rsi/fix-external-repo/:jobId', requireAdminAuth, async (req, res) => {
    try {
      const { getJob } = await import('../externalRepoFixer.js');
      const job = getJob(req.params.jobId);
      if (!job) return res.status(404).json({ error: 'Job not found' });
      const { emitter: _e, ...rest } = job;
      res.json(rest);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // GET /api/rsi/fix-external-repo/:jobId/stream — SSE stream of job events
  app.get('/api/rsi/fix-external-repo/:jobId/stream', requireAdminAuth, async (req, res) => {
    try {
      const { getJob } = await import('../externalRepoFixer.js');
      const job = getJob(req.params.jobId);
      if (!job) return res.status(404).json({ error: 'Job not found' });
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      // Send all past events immediately
      for (const evt of job.events) {
        res.write(`data: ${JSON.stringify(evt)}\n\n`);
      }
      // If already done/failed, close immediately
      if (job.status === 'done' || job.status === 'failed') {
        res.end();
        return;
      }
      // Stream future events
      const onEvent = (evt: unknown) => {
        res.write(`data: ${JSON.stringify(evt)}\n\n`);
        const e = evt as { status: string };
        if (e.status === 'done' || e.status === 'failed') {
          res.end();
          job.emitter.off('event', onEvent);
        }
      };
      job.emitter.on('event', onEvent);
      req.on('close', () => {
        job.emitter.off('event', onEvent);
      });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // GET /api/rsi/fix-external-repo — list all jobs
  app.get('/api/rsi/fix-external-repo', requireAdminAuth, async (_req, res) => {
    try {
      const { listJobs } = await import('../externalRepoFixer.js');
      res.json(listJobs());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  console.log('[ExternalRepoFixer] v11.293.0: /api/rsi/fix-external-repo/* registered');
}