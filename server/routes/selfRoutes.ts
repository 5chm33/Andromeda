import { validateBody } from "./validate.js";
import { selfAnalyzeSchema, selfApplySchema } from "./zodSchemas.js";
import type { Express } from "express";
import { analyzeAndPropose, applyProposal, listProposals, rejectProposal, getAnalyzableFiles } from "../selfImprove.js";
import { dbLoadProposals } from "../rsiDb.js";
import { requireAdminAuth } from "../adminAuth.js";

/**
 * registerSelfRoutes — Self-improvement endpoints extracted from streamRouter.ts (v6.02)
 */
export function registerSelfRoutes(
  app: Express,
  streamLimiter: any,
  heavyLimiter: any,
  setSseHeaders: (res: any) => void,
  sseWrite: (res: any, data: object) => void,
  deps: Record<string, any>
) {
  // v6.25: mutation endpoints require admin auth
  app.post("/api/self/analyze", requireAdminAuth, heavyLimiter, validateBody(selfAnalyzeSchema), async (req, res) => {
    const { file, area } = req.body as { file: string; area?: string };
    if (!file?.trim()) { res.status(400).json({ error: "file is required" }); return; }
    try {
      const proposal = await analyzeAndPropose(file.trim(), area);
      res.json({ proposal });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Analysis failed" });
    }
  });

  app.post("/api/self/apply", requireAdminAuth, validateBody(selfApplySchema), async (req, res) => {
    const { proposalId } = req.body as { proposalId: string };
    if (!proposalId) { res.status(400).json({ error: "proposalId is required" }); return; }
    const result = await applyProposal(proposalId);
    res.json(result);
  });

  app.get("/api/self/proposals", async (req, res) => {
    const status = req.query.status as string | undefined;
    try {
      // v6.31: Read from DB when available, fall back to JSON store
      let proposals = await dbLoadProposals();
      if (proposals.length === 0) {
        proposals = listProposals(status as any);
      } else if (status) {
        proposals = proposals.filter((p: any) => p.status === status);
      }
      // Don't send full file contents in list view — too large
      res.json({
        proposals: proposals.map((p: any) => ({ ...p, originalContent: undefined, proposedContent: undefined })),
        source: "db",
      });
    } catch {
      const proposals = listProposals(status as any);
      res.json({
        proposals: proposals.map(p => ({ ...p, originalContent: undefined, proposedContent: undefined })),
        source: "json",
      });
    }
  });

  app.get("/api/self/proposals/:id", (req, res) => {
    const proposals = listProposals();
    const proposal = proposals.find(p => p.id === req.params.id);
    if (!proposal) { res.status(404).json({ error: "Proposal not found" }); return; }
    res.json({ proposal });
  });

  app.delete("/api/self/proposals/:id", requireAdminAuth, (req, res) => {
    const rejected = rejectProposal(req.params.id);
    res.json({ success: rejected });
  });

  app.get("/api/self/files", (req, res) => {
    res.json({ files: getAnalyzableFiles() });
  });

  // v6.32: Approve a proposal (alias for apply with cleaner REST semantics)
  app.post("/api/self/proposals/:id/approve", requireAdminAuth, async (req, res) => {
    const result = await applyProposal(req.params.id);
    res.json(result);
  });

  // v6.32: Reject a proposal via POST (UI-friendly alternative to DELETE)
  app.post("/api/self/proposals/:id/reject", requireAdminAuth, (req, res) => {
    const rejected = rejectProposal(req.params.id);
    res.json({ success: rejected });
  });

  // v6.32: RSI proof history (for eval trend chart)
  app.get("/api/rsi/proof-history", async (_req, res) => {
    try {
      const fs = await import("fs");
      const path = await import("path");
      const p = path.join(process.cwd(), "data", "rsi_proof_history.json");
      if (!fs.existsSync(p)) { res.json({ entries: [] }); return; }
      const entries = JSON.parse(fs.readFileSync(p, "utf8"));
      res.json({ entries: Array.isArray(entries) ? entries : [] });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // v6.32: RSI scheduler status
  app.get("/api/rsi/scheduler", async (_req, res) => {
    try {
      const { getRsiSchedulerStatus } = await import("../rsiScheduler.js");
      res.json(getRsiSchedulerStatus());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // v6.32: Pause/resume/trigger/configure RSI scheduler
  app.post("/api/rsi/scheduler/pause", requireAdminAuth, async (_req, res) => {
    const { pauseRsiScheduler } = await import("../rsiScheduler.js");
    res.json({ success: pauseRsiScheduler() });
  });

  app.post("/api/rsi/scheduler/resume", requireAdminAuth, async (_req, res) => {
    const { resumeRsiScheduler } = await import("../rsiScheduler.js");
    res.json({ success: resumeRsiScheduler() });
  });

  app.post("/api/rsi/scheduler/trigger", requireAdminAuth, async (_req, res) => {
    const { triggerRsiNow } = await import("../rsiScheduler.js");
    const result = await triggerRsiNow();
    res.json(result);
  });

  app.post("/api/rsi/scheduler/set-hours", requireAdminAuth, async (req, res) => {
    const hours = Number(req.body?.hours);
    if (!hours || hours < 1 || hours > 168) {
      res.status(400).json({ error: "hours must be 1-168" }); return;
    }
    const { setRsiScheduleHours } = await import("../rsiScheduler.js");
    res.json({ success: setRsiScheduleHours(hours) });
  });

  // v6.32: Episodic memory consolidation endpoints
  app.get("/api/memory/episodic/stats", async (_req, res) => {
    try {
      const { getEpisodicConsolidationStats } = await import("../episodicConsolidation.js");
      res.json(getEpisodicConsolidationStats());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/memory/episodic/lessons", async (req, res) => {
    try {
      const { getConsolidatedLessons } = await import("../episodicConsolidation.js");
      const tag = req.query.tag as string | undefined;
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      res.json({ lessons: getConsolidatedLessons({ tag, limit }) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // v6.36: Unsupervised goal discovery history
  app.get("/api/rsi/discoveries", async (req, res) => {
    try {
      const { getRecentDiscoveries } = await import("../evalGoalDiscovery.js");
      const limit = req.query.limit ? Number(req.query.limit) : 20;
      res.json({ discoveries: getRecentDiscoveries(limit) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/memory/episodic/consolidate", requireAdminAuth, async (req, res) => {
    try {
      const { consolidateEpisodicMemory } = await import("../episodicConsolidation.js");
      const olderThanDays = req.body?.olderThanDays ?? 7;
      const forceRun = req.body?.forceRun ?? true;
      const result = await consolidateEpisodicMemory({ olderThanDays, forceRun });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── v9.14: RLHF feedback endpoints ─────────────────────────────────────────
  app.post("/api/feedback", async (req, res) => {
    try {
      const { recordFeedback, recordEval, getFeedbackSummary } = await import("../andromedaDb.js");
      const { sessionId, messageId, query, response, rating, comment, module: mod } = req.body;
      if (!sessionId || !messageId || !query || !response || ![1, -1].includes(rating)) {
        res.status(400).json({ error: "Missing required fields: sessionId, messageId, query, response, rating (1 or -1)" }); return;
      }
      const id = recordFeedback({ sessionId, messageId, query, response, rating, comment, module: mod });
      recordEval({ sessionId, query, response, toolsUsed: [], model: req.body.model });
      const summary = getFeedbackSummary();
      res.json({ id, summary });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/feedback/summary", async (_req, res) => {
    try {
      const { getFeedbackSummary, getLowRatedModules } = await import("../andromedaDb.js");
      res.json({
        summary: getFeedbackSummary(),
        lowRatedModules: getLowRatedModules(10),
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ─── Phase 2b: Federated RSI Swarm (Gossip Protocol) ────────────────────

  // POST /api/federated/sync — Receive a sync payload from a peer
  app.post("/api/federated/sync", async (req, res) => {
    try {
      const { processSyncPayload } = await import("../federatedLearning.js");
      const token = (req.headers["x-federated-token"] as string) ?? "";
      const result = processSyncPayload(req.body, token);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/federated/proposals — Fetch recent high-confidence proposals
  app.get("/api/federated/proposals", async (req, res) => {
    try {
      const { prepareSyncPayload } = await import("../federatedLearning.js");
      const payload = await prepareSyncPayload();
      res.json({ proposals: payload.proposals });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/federated/stats — Get swarm status and metrics
  app.get("/api/federated/stats", async (_req, res) => {
    try {
      const { getFederatedStats } = await import("../federatedLearning.js");
      res.json(getFederatedStats());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ─── Phase 3a: Self-Distillation (RLHF to DPO) ──────────────────────────

  // POST /api/distillation/export-dpo — Export RLHF data as DPO dataset
  app.post("/api/distillation/export-dpo", requireAdminAuth, async (_req, res) => {
    try {
      const { exportDpoDataset } = await import("../selfDistillation.js");
      const result = exportDpoDataset();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/distillation/train-lora — Trigger local LoRA fine-tuning
  app.post("/api/distillation/train-lora", requireAdminAuth, async (req, res) => {
    try {
      const { runLocalLoraTraining } = await import("../localLora.js");
      const { modelId, datasetPath, batchSize, epochs, learningRate } = req.body;
      if (!modelId) {
        res.status(400).json({ error: "modelId is required" });
        return;
      }
      
      // We don't await the training here because it takes hours.
      // We start it and return immediately.
      runLocalLoraTraining({ modelId, datasetPath, batchSize, epochs, learningRate })
        .catch(err => console.error("[LoRA] Training failed:", err));
        
      res.json({ success: true, message: "LoRA training started in background" });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── v9.14: Parallel RSI endpoints ──────────────────────────────────────────
  app.get("/api/rsi/parallel/status", async (_req, res) => {
    try {
      const { getParallelRsiStatus } = await import("../parallelRsi.js");
      res.json(getParallelRsiStatus());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/rsi/parallel/trigger", requireAdminAuth, async (req, res) => {
    try {
      const { runParallelCycle } = await import("../parallelRsi.js");
      const result = await runParallelCycle(req.body ?? {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── v9.14: Benchmark trend endpoint ────────────────────────────────────────
  app.get("/api/rsi/benchmark/trend", async (req, res) => {
    try {
      const { getBenchmarkTrend } = await import("../andromedaDb.js");
      const limit = req.query.limit ? Number(req.query.limit) : 30;
      res.json({ trend: getBenchmarkTrend(limit) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── v9.14: SSE stream for real-time RSI events ───────────────────────────────
  // Replaces the 15-second polling in ProposalNotifier.tsx with instant push.
  // Query params:
  //   ?since=<timestamp>  — replay events since this Unix timestamp (ms)
  app.get("/api/rsi/events", (req, res) => {
    const { registerSseClient } = require("../rsiEventBus.js");
    const since = req.query.since ? Number(req.query.since) : undefined;
    registerSseClient(res, since);
    // Keep connection open — cleanup is handled by the event bus on close
  });

  app.get("/api/rsi/events/history", (req, res) => {
    const { getEventHistory, getSseClientCount } = require("../rsiEventBus.js");
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    res.json({
      events: getEventHistory(limit),
      connectedClients: getSseClientCount(),
    });
  });

  // ─── Phase 2a: Dynamic Tool Generation (Tool Synthesis) ───────────────────

  // POST /api/tools/synthesize — Generate a new tool at runtime
  app.post("/api/tools/synthesize", requireAdminAuth, async (req, res) => {
    try {
      const { name, description, parameters, proposalId } = req.body;
      if (!name || !description || !parameters) {
        res.status(400).json({ error: "Missing required fields: name, description, parameters" });
        return;
      }
      const { synthesizeTool } = await import("../toolSynthesis.js");
      const result = await synthesizeTool(name, description, JSON.stringify(parameters), proposalId);
      if (!result.success) {
        res.status(500).json({ error: result.error });
        return;
      }
      res.json({ success: true, tool: result.tool });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/tools/synthesized — List all dynamically generated tools
  app.get("/api/tools/synthesized", async (req, res) => {
    try {
      const { listSynthesizedTools } = await import("../toolSynthesis.js");
      res.json({ tools: listSynthesizedTools() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // DELETE /api/tools/synthesized/:name — Delete a synthesized tool
  app.delete("/api/tools/synthesized/:name", requireAdminAuth, async (req, res) => {
    try {
      const { deleteSynthesizedTool } = await import("../toolSynthesis.js");
      const success = deleteSynthesizedTool(req.params.name);
      if (success) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "Tool not found" });
      }
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── v9.15: Filesystem watcher endpoints ────────────────────────────────────────────────────────────────

  // GET /api/fs/watches — list all active watches
  app.get("/api/fs/watches", async (_req, res) => {
    try {
      const { listWatches } = await import("../fsWatcher.js");
      res.json({ watches: listWatches() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/fs/watch — start watching a directory
  // Body: { id?, directory, patterns?, ignorePatterns?, recursive?, notifyRsi? }
  app.post("/api/fs/watch", requireAdminAuth, async (req, res) => {
    try {
      const { startWatch } = await import("../fsWatcher.js");
      const { nanoid } = await import("nanoid");
      const {
        id = `watch_${nanoid(8)}`,
        directory,
        patterns = ["**/*"],
        ignorePatterns = [],
        recursive = true,
        notifyRsi = false,
      } = req.body ?? {};
      if (!directory) { res.status(400).json({ error: "directory is required" }); return; }
      const watchId = startWatch({ id, directory, patterns, ignorePatterns, recursive, notifyRsi });
      res.json({ watchId, directory });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // DELETE /api/fs/watch/:id — stop a watch
  app.delete("/api/fs/watch/:id", requireAdminAuth, async (req, res) => {
    try {
      const { stopWatch } = await import("../fsWatcher.js");
      await stopWatch(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/fs/events — recent file change events
  // Query: ?watchId=<id>&limit=<n>
  app.get("/api/fs/events", async (req, res) => {
    try {
      const { getRecentEvents, getWatchStats } = await import("../fsWatcher.js");
      const watchId = req.query.watchId as string | undefined;
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const events = getRecentEvents(watchId, limit);
      const stats = watchId ? getWatchStats(watchId) : null;
      res.json({ events, stats, count: events.length });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── v9.16.2: Phase 4a — RLAIF Judge endpoints ─────────────────────────────────────
  // POST /api/rlaif/judge — run the RLAIF judge to generate synthetic DPO pairs
  app.post("/api/rlaif/judge", requireAdminAuth, async (req, res) => {
    try {
      const { generateRlaifPairs } = await import("../rlaifJudge.js");
      const limit = req.body?.limit ?? 10;
      const pairs = await generateRlaifPairs(limit);
      res.json({ success: true, pairsGenerated: pairs.length, pairs });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── v9.16.2: Phase 4b — Evolutionary Search endpoints ──────────────────────────────
  // POST /api/evolution/run — run a single evolutionary generation on a target file
  app.post("/api/evolution/run", requireAdminAuth, async (req, res) => {
    try {
      const { runEvolutionaryGeneration } = await import("../evolutionarySearch.js");
      const { targetFile = "selfImprove.ts", generation = 1 } = req.body ?? {};
      const result = await runEvolutionaryGeneration(targetFile, generation);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── v9.16.2: Phase 5a — Native VLM endpoints ────────────────────────────────────────
  // POST /api/vlm/analyze — analyze a screenshot with native VLM
  app.post("/api/vlm/analyze", requireAdminAuth, async (req, res) => {
    try {
      const { analyzeRawScreenshot } = await import("../nativeVlm.js");
      const { imagePath, query } = req.body ?? {};
      if (!imagePath || !query) {
        res.status(400).json({ error: "imagePath and query are required" });
        return;
      }
      const result = await analyzeRawScreenshot(imagePath, query);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── v9.16.2: Phase 5b — Algorithmic Discovery endpoints ────────────────────────────
  // POST /api/discovery/run — run algorithmic discovery for a capability
  app.post("/api/discovery/run", requireAdminAuth, async (req, res) => {
    try {
      const { discoverAlgorithm } = await import("../algorithmicDiscovery.js");
      const { capability = "proposal_ranking" } = req.body ?? {};
      const result = await discoverAlgorithm(capability);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── v9.16.2: Phase 5c — Continuous Fine-Tuning endpoints ────────────────────────────
  // POST /api/fine-tuning/run — run the nightly fine-tuning cycle manually
  app.post("/api/fine-tuning/run", requireAdminAuth, async (req, res) => {
    try {
      const { runNightlyFineTuningCycle } = await import("../continuousFineTuning.js");
      const { modelId } = req.body ?? {};
      // Run in background — don't block the HTTP response
      runNightlyFineTuningCycle(modelId).then(result => {
        console.log("[FineTuning] Cycle completed:", result);
      }).catch(err => {
        console.error("[FineTuning] Cycle failed:", err);
      });
      res.json({ success: true, message: "Fine-tuning cycle started in background" });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
}
