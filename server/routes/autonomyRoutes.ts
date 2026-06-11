import { validateBody } from "./validate.js";
import { 
  goalCreateSchema, subGoalCreateSchema, checkpointCreateSchema, metaGoalCreateSchema,
  scheduledTaskCreateSchema, busPublishSchema, busSubscribeSchema, busQuerySchema,
  apiKeyCreateSchema, testGenerateSchema
} from "./zodSchemas.js";
import type { Express } from "express";
import {
  createGoal, getGoal, listGoals, deleteGoal, startGoal, pauseGoal, resumeGoal,
  cancelGoal, completeGoal, addSubGoal, completeSubGoal, failSubGoal, getNextSubGoal,
  getParallelSubGoals, createCheckpoint, resolveCheckpoint, getPendingCheckpoints,
  decomposeGoal, addLearning, evaluateGoal, getGoalStats, getGoalEvents,
  getActiveGoalsSummary, runReprioritization, getOptimalGoalOrder,
  getReprioritizationHistory, getReprioritizationStats, listReprioritizationRules,
  setReprioritizationEnabled, isReprioritizationEnabled,
} from "../goalManager.js";
import {
  recordMetric, getMonitorConfig, setMonitorConfig, getHealthReport, getAlerts,
  resolveAlert, getMetricHistory, getMonitorSummary, startMonitor, stopMonitor,
  isMonitorRunning, recordProviderSample, recalculateBaselines, getAdaptiveThresholds,
  isProviderDegraded, getAllBaselines, getAdaptiveConfig, setAdaptiveConfig, getAdaptiveStats,
} from "../selfMonitor.js";
import type { MetricType } from "../selfMonitor.js";
import {
  trackMemory, recordAccess, runConsolidation, getConsolidationConfig, setConsolidationConfig,
  getConsolidationStats, getScoredMemories, startConsolidation, stopConsolidation,
  isConsolidationRunning, runDeduplication, getDedupConfig, setDedupConfig, getDedupHistory, getDedupStats,
} from "../memoryConsolidation.js";
import {
  analyzeComplexity, decomposeQuery, getReadySubTasks, completeSubTask, failSubTask,
  getDecomposerConfig, setDecomposerConfig, getDecomposedQuery, listDecomposedQueries,
  getDecomposerStats, shouldAutoDecompose,
} from "../taskDecomposer.js";
import {
  createTask, getTask, listTasks, pauseTask, resumeTask, cancelTask, deleteTask,
  getTaskExecutions, triggerTaskNow, handleWebhook, getWebhookSecret, getSchedulerStats,
} from "../scheduler.js";
import {
  scanImportsForDependencies, getResolverConfig, setResolverConfig, getInstallHistory,
} from "../dependencyResolver.js";
import {
  reviewCode, reviewAndGate, getReviewConfig, setReviewConfig, getReviewHistory, getReviewStats,
} from "../selfReview.js";
import {
  generateTests, runAllTests, getTestGenConfig, setTestGenConfig, getTestResults, getTestGenStats,
} from "../testGenerator.js";
import {
  publish, subscribe, unsubscribe, unsubscribeAgent, query as queryBus, markRead,
  getUnreadCount, claimWork, releaseWork, getActiveClaims, getContextSummaryForAgent,
  getThread, getBusStats, createChannel, listChannels, deleteChannel, resetBus,
} from "../contextBus.js";
import {
  generateDiffPreview, guardedApply, rollbackToBackup, getGuardConfig, updateGuardConfig,
  listBackups, getAuditLog as getGuardAuditLog, sweepExpiredProposals,
} from "../selfImproveGuard.js";
import {
  listProposals as listProposalsStore,
  loadProposals as loadProposalsStore,
  saveProposals as saveProposalsStore,
} from "../selfImprove.js";
import {
  createApiKey, revokeApiKey, deleteApiKey, listApiKeys, getAuditLog as getSecurityAuditLog,
  getAuditStats, getSecurityConfig, updateSecurityConfig, getSecurityStats,
} from "../security.js";

/**
 * registerAutonomyRoutes — Goal management, scheduler, meta-goals, task decomposition,
 * monitor, context bus, guard, security, review, and test routes extracted from streamRouter.ts (v6.03).
 */
export function registerAutonomyRoutes(app: Express) {
  // ─── v5.5 Tier 2: Self-Improvement Guard ──────────────────────────────────
  app.post("/api/guard/preview", (req, res) => {
    const { proposalId } = req.body;
    if (!proposalId) return res.status(400).json({ error: "proposalId required" });
    const proposals = listProposalsStore();
    const proposal = proposals.find((p: any) => p.id === proposalId);
    if (!proposal) return res.status(404).json({ error: "Proposal not found" });
    res.json(generateDiffPreview(proposal));
  });
  app.post("/api/guard/apply", async (req, res) => {
    const { proposalId } = req.body;
    if (!proposalId) return res.status(400).json({ error: "proposalId required" });
    const result = await guardedApply(proposalId);
    // v10.3: Update proposal status to 'applied' in the proposals store after successful apply
    if (result.success) {
      try {
        const store = loadProposalsStore();
        const prop = store.proposals.find((p: any) => p.id === proposalId);
        if (prop) {
          prop.status = "applied";
          (prop as any).appliedAt = Date.now();
          saveProposalsStore(store);
          console.log(`[Guard API] Marked proposal ${proposalId} as applied in proposals store`);
        } else {
          // Proposal injected externally — create a minimal applied record
          store.proposals.push({
            id: proposalId, status: "applied", appliedAt: Date.now(),
            title: "External proposal", targetFile: "unknown", rationale: "",
            category: "readability", impact: "low", confidence: 1.0,
            diff: "", originalSnippet: "", proposedSnippet: "",
            originalContent: "", proposedContent: "", createdAt: Date.now(),
          } as any);
          saveProposalsStore(store);
          console.log(`[Guard API] Created applied record for external proposal ${proposalId}`);
        }
      } catch (err) {
        console.warn("[Guard API] Failed to update proposal status (non-fatal):", (err as Error).message);
      }
    }
    res.json(result);
  });
  app.post("/api/guard/rollback", (req, res) => {
    const { backupId } = req.body;
    if (!backupId) return res.status(400).json({ error: "backupId required" });
    res.json(rollbackToBackup(backupId));
  });
  app.get("/api/guard/backups", (req, res) => {
    const filename = req.query.filename as string | undefined;
    res.json({ backups: listBackups(filename) });
  });
  app.get("/api/guard/config", (req, res) => res.json(getGuardConfig()));
  app.post("/api/guard/config", (req, res) => {
    const updated = updateGuardConfig(req.body);
    res.json({ success: true, config: updated });
  });
  app.get("/api/guard/audit", (req, res) => {
    const limit = parseInt(String(req.query.limit ?? "50"));
    res.json({ entries: getGuardAuditLog(limit) });
  });
  app.post("/api/guard/sweep", (req, res) => {
    const expired = sweepExpiredProposals();
    res.json({ success: true, expired });
  });

  // ─── v5.5 Tier 3: Security — API Keys, Rate Limiting, Audit ──────────────
  app.post("/api/security/keys", validateBody(apiKeyCreateSchema), (req, res) => {
    try {
      const result = createApiKey(req.body);
      res.json({ success: true, key: result.key, plaintext: result.plaintext });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
  app.get("/api/security/keys", (req, res) => res.json({ keys: listApiKeys() }));
  app.post("/api/security/keys/:id/revoke", (req, res) => res.json({ success: revokeApiKey(req.params.id) }));
  app.delete("/api/security/keys/:id", (req, res) => res.json({ success: deleteApiKey(req.params.id) }));
  app.get("/api/security/audit", (req, res) => {
    const limit = parseInt(String(req.query.limit ?? "100"));
    const apiKeyId = req.query.apiKeyId as string | undefined;
    const path = req.query.path as string | undefined;
    const since = req.query.since as string | undefined;
    res.json({ entries: getSecurityAuditLog({ limit, apiKeyId, path, since }) });
  });
  app.get("/api/security/audit/stats", (req, res) => res.json(getAuditStats()));
  app.get("/api/security/config", (req, res) => res.json(getSecurityConfig()));
  app.post("/api/security/config", (req, res) => {
    const updated = updateSecurityConfig(req.body);
    res.json({ success: true, config: updated });
  });
  app.get("/api/security/stats", (req, res) => res.json(getSecurityStats()));

  // ─── v5.5 Autonomy: Goal Manager ──────────────────────────────────────────
  app.post("/api/goals", validateBody(goalCreateSchema), (req, res) => {
    try {
      const goal = createGoal(req.body);
      res.json(goal);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });
  app.get("/api/goals", (req, res) => res.json(listGoals(req.query as any)));
  app.get("/api/goals/stats", (req, res) => res.json(getGoalStats()));
  app.get("/api/goals/active/summary", (req, res) => res.json(getActiveGoalsSummary()));
  app.get("/api/goals/:id", (req, res) => {
    const goal = getGoal(req.params.id);
    if (!goal) return res.status(404).json({ error: "Goal not found" });
    res.json(goal);
  });
  app.delete("/api/goals/:id", (req, res) => res.json({ success: deleteGoal(req.params.id) }));
  app.post("/api/goals/:id/start", (req, res) => res.json({ success: startGoal(req.params.id) }));
  app.post("/api/goals/:id/pause", (req, res) => res.json({ success: pauseGoal(req.params.id) }));
  app.post("/api/goals/:id/resume", (req, res) => res.json({ success: resumeGoal(req.params.id) }));
  app.post("/api/goals/:id/cancel", (req, res) => res.json({ success: cancelGoal(req.params.id) }));
  app.post("/api/goals/:id/complete", (req, res) => {
    const { outcome } = req.body || {};
    res.json({ success: completeGoal(req.params.id, outcome) });
  });
  app.post("/api/goals/:id/subgoals", validateBody(subGoalCreateSchema), (req, res) => {
    try {
      const subgoal = addSubGoal(req.params.id, req.body);
      res.json(subgoal);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });
  app.post("/api/goals/:id/subgoals/:subId/complete", (req, res) => res.json({ success: completeSubGoal(req.params.id, req.params.subId, req.body.result || "") }));
  app.post("/api/goals/:id/subgoals/:subId/fail", (req, res) => res.json({ success: failSubGoal(req.params.id, req.params.subId, req.body.reason || "") }));
  app.get("/api/goals/:id/next", (req, res) => res.json({ next: getNextSubGoal(req.params.id) }));
  app.get("/api/goals/:id/parallel", (req, res) => res.json({ parallel: getParallelSubGoals(req.params.id) }));
  app.post("/api/goals/:id/checkpoint", validateBody(checkpointCreateSchema), (req, res) => {
    try {
      const cp = createCheckpoint(req.params.id, req.body);
      res.json(cp);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });
  app.post("/api/goals/:id/checkpoint/:cpId/resolve", (req, res) => res.json({ success: resolveCheckpoint(req.params.id, req.params.cpId, req.body.resolution) }));
  app.get("/api/goals/:id/checkpoints", (req, res) => res.json({ checkpoints: getPendingCheckpoints(req.params.id) }));
  app.post("/api/goals/:id/decompose", async (req, res) => {
    try {
      const result = await decomposeGoal(req.params.id, req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
  app.post("/api/goals/:id/learning", (req, res) => {
    const { lesson } = req.body || {};
    if (!lesson) return res.status(400).json({ error: "lesson required" });
    res.json({ success: addLearning(req.params.id, lesson) });
  });
  app.get("/api/goals/:id/evaluate", (req, res) => res.json(evaluateGoal(req.params.id)));
  app.get("/api/goals/:id/events", (req, res) => {
    const limit = parseInt(String(req.query.limit ?? "50"));
    res.json({ events: getGoalEvents(req.params.id, limit) });
  });

  // ─── Goal Reprioritization ─────────────────────────────────────────────────
  app.post("/api/goals/reprioritize", (_req, res) => res.json({ events: runReprioritization() }));
  app.get("/api/goals/optimal-order", (_req, res) => res.json(getOptimalGoalOrder()));
  app.get("/api/goals/reprioritization/history", (req, res) => res.json(getReprioritizationHistory(parseInt(req.query.limit as string) || 50)));
  app.get("/api/goals/reprioritization/stats", (_req, res) => res.json(getReprioritizationStats()));
  app.get("/api/goals/reprioritization/rules", (_req, res) => res.json({ rules: listReprioritizationRules() }));
  app.put("/api/goals/reprioritization/enabled", (req, res) => {
    const { enabled } = req.body;
    setReprioritizationEnabled(enabled !== false);
    res.json({ enabled: isReprioritizationEnabled() });
  });

  // ─── v5.5 Autonomy: Monitor ────────────────────────────────────────────────
  app.get("/api/monitor/health", (req, res) => res.json(getHealthReport()));
  app.get("/api/monitor/config", (req, res) => res.json(getMonitorConfig()));
  app.post("/api/monitor/config", (req, res) => {
    const updated = setMonitorConfig(req.body);
    res.json({ success: true, config: updated });
  });
  app.get("/api/monitor/alerts", (req, res) => {
    const _limit = parseInt(String(req.query.limit ?? "50"));
    res.json({ alerts: getAlerts(false) });
  });
  app.post("/api/monitor/alerts/:id/resolve", (req, res) => res.json({ success: resolveAlert(req.params.id) }));
  app.get("/api/monitor/metrics/:type", (req, res) => {
    const limit = parseInt(String(req.query.limit ?? "100"));
    res.json({ metrics: getMetricHistory(req.params.type as MetricType, limit) });
  });
  app.post("/api/monitor/record", (req, res) => {
    const { type, value, metadata } = req.body;
    if (!type || value === undefined) return res.status(400).json({ error: "type and value required" });
    recordMetric(type as MetricType, value, typeof metadata === "string" ? metadata : undefined);
    res.json({ success: true });
  });
  app.post("/api/monitor/start", (req, res) => { startMonitor(); res.json({ running: true }); });
  app.post("/api/monitor/stop", (req, res) => { stopMonitor(); res.json({ running: false }); });
  app.get("/api/monitor/status", (req, res) => {
    res.json({ running: isMonitorRunning(), summary: getMonitorSummary() });
  });
  app.post("/api/monitor/provider-sample", (req, res) => {
    const { providerId, latencyMs, success } = req.body;
    recordProviderSample({ providerId, latency: latencyMs, success: success !== false, timestamp: Date.now() });
    res.json({ success: true });
  });
  app.post("/api/monitor/recalculate-baselines", (_req, res) => { recalculateBaselines(); res.json({ success: true }); });
  app.get("/api/monitor/baselines", (_req, res) => res.json(getAllBaselines()));
  app.get("/api/monitor/adaptive-thresholds/:providerId", (req, res) => res.json(getAdaptiveThresholds(req.params.providerId)));
  app.get("/api/monitor/provider-degraded/:providerId", (req, res) => res.json(isProviderDegraded(req.params.providerId)));
  app.get("/api/monitor/adaptive-config", (_req, res) => res.json(getAdaptiveConfig()));
  app.put("/api/monitor/adaptive-config", (req, res) => res.json(setAdaptiveConfig(req.body)));
  app.get("/api/monitor/adaptive-stats", (_req, res) => res.json(getAdaptiveStats()));

  // ─── Memory Consolidation ──────────────────────────────────────────────────
  app.get("/api/memory/consolidation/config", (req, res) => res.json(getConsolidationConfig()));
  app.post("/api/memory/consolidation/config", (req, res) => {
    const updated = setConsolidationConfig(req.body);
    res.json({ success: true, config: updated });
  });
  app.get("/api/memory/consolidation/stats", (req, res) => res.json(getConsolidationStats()));
  app.post("/api/memory/consolidation/run", (req, res) => {
    const result = runConsolidation();
    res.json({ success: true, result });
  });
  app.get("/api/memory/consolidation/scored", (req, res) => {
    const sortBy = (req.query.sortBy as string) || "score";
    const limit = parseInt(req.query.limit as string) || 50;
    res.json(getScoredMemories(sortBy as any, limit));
  });
  app.post("/api/memory/consolidation/track", (req, res) => {
    const { id, text, type } = req.body;
    trackMemory(id, text, type);
    res.json({ success: true });
  });
  app.post("/api/memory/consolidation/access", (req, res) => {
    recordAccess(req.body.id);
    res.json({ success: true });
  });
  app.post("/api/memory/consolidation/start", (req, res) => { startConsolidation(); res.json({ success: true, running: true }); });
  app.post("/api/memory/consolidation/stop", (req, res) => { stopConsolidation(); res.json({ success: true, running: false }); });
  app.get("/api/memory/consolidation/status", (req, res) => res.json({ running: isConsolidationRunning() }));

  // ─── Memory Deduplication ──────────────────────────────────────────────────
  app.post("/api/memory/dedup/run", (_req, res) => res.json(runDeduplication()));
  app.get("/api/memory/dedup/config", (_req, res) => res.json(getDedupConfig()));
  app.put("/api/memory/dedup/config", (req, res) => res.json(setDedupConfig(req.body)));
  app.get("/api/memory/dedup/history", (req, res) => res.json(getDedupHistory(parseInt(req.query.limit as string) || 20)));
  app.get("/api/memory/dedup/stats", (_req, res) => res.json(getDedupStats()));

  // ─── Task Decomposer ──────────────────────────────────────────────────────
  app.post("/api/decompose/analyze", (req, res) => {
    const { query } = req.body;
    if (!query?.trim()) { res.status(400).json({ error: "Query is required" }); return; }
    res.json(analyzeComplexity(query.trim()));
  });
  app.post("/api/decompose", (req, res) => {
    const { query } = req.body;
    if (!query?.trim()) { res.status(400).json({ error: "Query is required" }); return; }
    res.json(decomposeQuery(query.trim()));
  });
  app.post("/api/decompose/auto", (req, res) => {
    const { query } = req.body;
    if (!query?.trim()) { res.status(400).json({ error: "Query is required" }); return; }
    res.json(shouldAutoDecompose(query.trim()));
  });
  app.get("/api/decompose/config", (req, res) => res.json(getDecomposerConfig()));
  app.post("/api/decompose/config", (req, res) => {
    const updated = setDecomposerConfig(req.body);
    res.json({ success: true, config: updated });
  });
  app.get("/api/decompose/:id", (req, res) => {
    const dq = getDecomposedQuery(req.params.id);
    if (!dq) { res.status(404).json({ error: "Not found" }); return; }
    res.json(dq);
  });
  app.get("/api/decompose/:id/ready", (req, res) => res.json(getReadySubTasks(req.params.id)));
  app.post("/api/decompose/:id/tasks/:taskId/complete", (req, res) => res.json({ success: completeSubTask(req.params.id, req.params.taskId, req.body.result) }));
  app.post("/api/decompose/:id/tasks/:taskId/fail", (req, res) => res.json({ success: failSubTask(req.params.id, req.params.taskId, req.body.error) }));
  app.get("/api/decompose/list/recent", (req, res) => {
    const limit = parseInt(req.query.limit as string) || 20;
    res.json(listDecomposedQueries(limit));
  });
  app.get("/api/decompose/stats/overview", (req, res) => res.json(getDecomposerStats()));

  // ─── Scheduler ────────────────────────────────────────────────────────────
  app.post("/api/scheduler/tasks", validateBody(scheduledTaskCreateSchema), (req, res) => {
    try {
      const task = createTask(req.body);
      res.json(task);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });
  app.get("/api/scheduler/tasks", (req, res) => res.json(listTasks(req.query as any)));
  app.get("/api/scheduler/tasks/:id", (req, res) => {
    const task = getTask(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });
    res.json(task);
  });
  app.post("/api/scheduler/tasks/:id/pause", (req, res) => res.json({ success: pauseTask(req.params.id) }));
  app.post("/api/scheduler/tasks/:id/resume", (req, res) => res.json({ success: resumeTask(req.params.id) }));
  app.post("/api/scheduler/tasks/:id/cancel", (req, res) => res.json({ success: cancelTask(req.params.id) }));
  app.post("/api/scheduler/tasks/:id/trigger", (req, res) => res.json(triggerTaskNow(req.params.id)));
  app.delete("/api/scheduler/tasks/:id", (req, res) => res.json({ success: deleteTask(req.params.id) }));
  app.get("/api/scheduler/tasks/:id/executions", (req, res) => {
    const limit = parseInt(String(req.query.limit ?? "20"));
    res.json({ executions: getTaskExecutions(req.params.id, limit) });
  });
  app.get("/api/scheduler/stats", (req, res) => res.json(getSchedulerStats()));
  app.post("/api/webhook/:eventType", (req, res) => {
    const result = handleWebhook(req.params.eventType, req.body as Record<string, unknown>);
    res.json(result);
  });
  app.get("/api/webhook/secret", (req, res) => res.json({ secret: getWebhookSecret() }));

  // ─── Dependency Resolver ──────────────────────────────────────────────────
  app.post("/api/deps/scan", async (req, res) => {
    try {
      const result = await scanImportsForDependencies(req.body.code || "", req.body.language || "typescript");
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.get("/api/deps/config", (_req, res) => res.json(getResolverConfig()));
  app.put("/api/deps/config", (req, res) => res.json(setResolverConfig(req.body)));
  app.get("/api/deps/history", (req, res) => res.json(getInstallHistory()));

  // ─── Code Review ──────────────────────────────────────────────────────────
  app.post("/api/review/code", async (req, res) => {
    try {
      const result = await reviewCode(req.body);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/review/react-step", async (req, res) => {
    try {
      const result = await reviewAndGate(req.body);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/review/config", (_req, res) => res.json(getReviewConfig()));
  app.put("/api/review/config", (req, res) => res.json(setReviewConfig(req.body)));
  app.get("/api/review/history", (req, res) => res.json(getReviewHistory(parseInt(req.query.limit as string) || 20)));
  app.get("/api/review/stats", (_req, res) => res.json(getReviewStats()));

  // ─── Test Generator ───────────────────────────────────────────────────────
  app.post("/api/tests/generate", validateBody(testGenerateSchema), async (req, res) => {
    try {
      const { code, filePath, language } = req.body;
      if (!code || !filePath) { res.status(400).json({ error: "code and filePath required" }); return; }
      const result = generateTests(code, filePath, language);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/tests/run", async (req, res) => {
    try {
      const result = runAllTests();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/tests/generate-and-run", validateBody(testGenerateSchema), async (req, res) => {
    try {
      const { code, filePath, language } = req.body;
      if (!code || !filePath) { res.status(400).json({ error: "code and filePath required" }); return; }
      const generated = generateTests(code, filePath, language);
      const run = runAllTests();
      res.json({ generated, run });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/tests/config", (_req, res) => res.json(getTestGenConfig()));
  app.put("/api/tests/config", (req, res) => res.json(setTestGenConfig(req.body)));
  app.get("/api/tests/history", (req, res) => res.json(getTestResults(parseInt(req.query.limit as string) || 20)));
  app.get("/api/tests/stats", (_req, res) => res.json(getTestGenStats()));

  // ─── Context Bus (Multi-Agent Shared Context) ─────────────────────────────
  app.post("/api/bus/channels", (req, res) => res.json(createChannel(req.body.name, req.body.description || "")));
  app.get("/api/bus/channels", (_req, res) => res.json(listChannels()));
  app.delete("/api/bus/channels/:name", (req, res) => res.json({ deleted: deleteChannel(req.params.name) }));
  app.post("/api/bus/publish", validateBody(busPublishSchema), (req, res) => {
    try {
      const entry = publish(req.body);
      res.json(entry);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post("/api/bus/subscribe", validateBody(busSubscribeSchema), (req, res) => {
    const sub = subscribe({ agentId: req.body.agentId, channel: req.body.channel, filter: req.body.filter });
    res.json(sub);
  });
  app.delete("/api/bus/subscribe/:id", (req, res) => res.json({ removed: unsubscribe(req.params.id) }));
  app.delete("/api/bus/agent/:agentId/subscriptions", (req, res) => res.json({ removed: unsubscribeAgent(req.params.agentId) }));
  app.post("/api/bus/query", validateBody(busQuerySchema), (req, res) => {
    const results = queryBus(req.body);
    res.json(results.map((e: any) => ({ ...e, readBy: Array.from(e.readBy) })));
  });
  app.post("/api/bus/mark-read", (req, res) => res.json({ marked: markRead(req.body.agentId, req.body.entryIds || []) }));
  app.get("/api/bus/unread/:agentId", (req, res) => res.json(getUnreadCount(req.params.agentId)));
  app.post("/api/bus/claim-work", (req, res) => {
    const claim = claimWork(req.body.agentId, req.body.taskDescription, req.body.channel, req.body.ttlMs);
    res.json(claim ? { claimed: true, claim } : { claimed: false, reason: "Similar work already claimed" });
  });
  app.post("/api/bus/release-work", (req, res) => res.json({ released: releaseWork(req.body.agentId, req.body.taskDescription) }));
  app.get("/api/bus/claims", (_req, res) => res.json(getActiveClaims()));
  app.get("/api/bus/summary/:agentId", (req, res) => {
    const limit = parseInt(req.query.limit as string) || 10;
    res.json({ summary: getContextSummaryForAgent(req.params.agentId, limit) });
  });
  app.get("/api/bus/thread/:entryId", (req, res) => {
    const thread = getThread(req.params.entryId);
    res.json(thread.map((e: any) => ({ ...e, readBy: Array.from(e.readBy) })));
  });
  app.get("/api/bus/stats", (_req, res) => res.json(getBusStats()));
  app.post("/api/bus/reset", (_req, res) => { resetBus(); res.json({ ok: true }); });

  // ─── Meta-Goals (v5.17: Recursive Self-Improvement) ──────────────────────
  app.get("/api/meta-goals", async (req, res) => {
    try {
      const { listMetaGoals } = await import("../recursiveGoals.js");
      const filter = req.query as any;
      res.json({ goals: listMetaGoals(filter) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/meta-goals", validateBody(metaGoalCreateSchema), async (req, res) => {
    try {
      const { createMetaGoal } = await import("../recursiveGoals.js");
      const goal = createMetaGoal(req.body);
      res.json(goal);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/meta-goals/progress", async (_req, res) => {
    try {
      const { getImprovementProgress } = await import("../recursiveGoals.js");
      res.json(getImprovementProgress());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/meta-goals/next", async (_req, res) => {
    try {
      const { getNextGoal } = await import("../recursiveGoals.js");
      const goal = getNextGoal();
      res.json({ goal });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/meta-goals/scan", async (_req, res) => {
    try {
      const { scanForImprovementOpportunities } = await import("../recursiveGoals.js");
      const result = scanForImprovementOpportunities();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/meta-goals/:id/activate", async (req, res) => {
    try {
      const { activateGoal } = await import("../recursiveGoals.js");
      const success = activateGoal(req.params.id);
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/meta-goals/:id/complete", async (req, res) => {
    try {
      const { completeGoal: completeMetaGoal } = await import("../recursiveGoals.js");
      const { outcome, lessons } = req.body || {};
      const success = completeMetaGoal(req.params.id, outcome || "Completed", lessons);
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Graceful Degradation ─────────────────────────────────────────────────
  app.get("/api/degradation/status", async (_req, res) => {
    try {
      const { getDegradationStatus } = await import("../gracefulDegradation.js");
      res.json(getDegradationStatus());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/degradation/history", async (req, res) => {
    try {
      const { getDegradationHistory } = await import("../gracefulDegradation.js");
      const limit = parseInt(req.query.limit as string) || 50;
      res.json({ events: getDegradationHistory(limit) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/degradation/reset-service", async (req, res) => {
    try {
      const { resetService } = await import("../gracefulDegradation.js");
      const { service } = req.body || {};
      if (!service) return res.status(400).json({ error: "'service' required" });
      res.json(resetService(service));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/degradation/config", async (req, res) => {
    try {
      const { setDegradationConfig } = await import("../gracefulDegradation.js");
      res.json(setDegradationConfig(req.body || {}));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
