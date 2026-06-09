/**
 * godelRoutes.ts — Andromeda v9.0 Gödel Machine API Routes
 *
 * Exposes the Phase 12–15 modules via REST endpoints:
 *
 *   GET  /api/godel/proof/status          — proof verifier capabilities
 *   POST /api/godel/proof/verify          — verify a commit proposal
 *   GET  /api/godel/utility/snapshot      — current utility state snapshot
 *   GET  /api/godel/utility/weights       — current utility weights
 *   POST /api/godel/utility/calibrate     — trigger weight auto-calibration
 *   GET  /api/godel/semantic/stats        — semantic self-model stats
 *   GET  /api/godel/semantic/modules      — all tracked modules + utility maps
 *   POST /api/godel/semantic/predict      — predict utility delta for a proposal
 *   POST /api/godel/causal/analyze        — causal failure analysis
 *   POST /api/godel/mcts/plan             — plan an RSI goal using MCTS
 *   GET  /api/godel/epistemic/debates     — list active epistemic debates
 *   POST /api/godel/epistemic/debate      — start a new epistemic debate
 */

import type { Express } from "express";

export function registerGodelRoutes(app: Express): void {

  // ── Proof Verifier ──────────────────────────────────────────────────────────

  app.get("/api/godel/proof/status", async (_req, res) => {
    try {
      const { getProofCapabilities } = await import("../proofVerifier.js");
      res.json(getProofCapabilities());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.post("/api/godel/proof/verify", async (req, res) => {
    try {
      const { verifyCommitProposal } = await import("../proofVerifier.js");
      const { filePath, proposedContent, rationale, preConditions, postConditions, expectedUtilityDelta, warnOnly } = req.body ?? {};
      if (!filePath || !proposedContent || !rationale) {
        res.status(400).json({ error: "filePath, proposedContent, and rationale are required" });
        return;
      }
      const result = await verifyCommitProposal({
        filePath,
        proposedContent,
        rationale,
        preConditions: preConditions ?? {},
        postConditions: postConditions ?? {},
        expectedUtilityDelta: expectedUtilityDelta ?? 0.01,
        warnOnly: warnOnly ?? true,
      });
      res.json(result);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // ── Utility Function ────────────────────────────────────────────────────────

  app.get("/api/godel/utility/snapshot", async (_req, res) => {
    try {
      const { createStateSnapshot, compute } = await import("../utilityFunction.js");
      const snapshot = createStateSnapshot();
      const score = compute(snapshot);
      res.json({ snapshot, score });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.get("/api/godel/utility/weights", async (_req, res) => {
    try {
      const { getWeights } = await import("../utilityFunction.js");
      res.json(getWeights());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.post("/api/godel/utility/calibrate", async (_req, res) => {
    try {
      const { autoCalibrate } = await import("../utilityFunction.js");
      const result = autoCalibrate();
      res.json(result);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // ── Semantic Self-Model ─────────────────────────────────────────────────────

  app.get("/api/godel/semantic/stats", async (_req, res) => {
    try {
      const { getSemanticModelStats } = await import("../semanticSelfModel.js");
      res.json(getSemanticModelStats());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.get("/api/godel/semantic/modules", async (_req, res) => {
    try {
      const { getAllModules, getTopModulesByImpact, getHighRiskModules } = await import("../semanticSelfModel.js");
      res.json({
        all: getAllModules(),
        topByImpact: getTopModulesByImpact(10),
        highRisk: getHighRiskModules(0.7),
      });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.post("/api/godel/semantic/predict", async (req, res) => {
    try {
      const { impactPredict } = await import("../semanticSelfModel.js");
      const { targetModule, proposedChange, changeType, linesChanged } = req.body ?? {};
      if (!targetModule || !proposedChange) {
        res.status(400).json({ error: "targetModule and proposedChange are required" });
        return;
      }
      const prediction = impactPredict({
        targetModule,
        proposedChange,
        changeType: changeType ?? "refactor",
        linesChanged: linesChanged ?? 10,
      });
      res.json(prediction);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // ── Causal Reasoning ────────────────────────────────────────────────────────

  app.post("/api/godel/causal/analyze", async (req, res) => {
    try {
      const { analyzeFailure } = await import("../causalReasoning.js");
      const { symptom, context } = req.body ?? {};
      if (!symptom) {
        res.status(400).json({ error: "symptom is required" });
        return;
      }
      const analysis = await analyzeFailure(symptom, context ?? {});
      res.json(analysis);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // ── MCTS Planning ───────────────────────────────────────────────────────────

  app.post("/api/godel/mcts/plan", async (req, res) => {
    try {
      const { planWithMCTS } = await import("../mctsPlanningEngine.js");
      const { goal, context, iterations, useLLM } = req.body ?? {};
      if (!goal) {
        res.status(400).json({ error: "goal is required" });
        return;
      }
      const result = await planWithMCTS(
        goal,
        context ?? {},
        Math.min(iterations ?? 200, 500), // Cap at 500 iterations for API calls
        useLLM ?? false,
      );
      res.json(result);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // ── Epistemic Belief Model ──────────────────────────────────────────────────

  app.get("/api/godel/epistemic/debates", async (_req, res) => {
    try {
      const { listDebates } = await import("../epistemicBeliefModel.js");
      res.json(listDebates());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.post("/api/godel/epistemic/debate", async (req, res) => {
    try {
      const { startDebate } = await import("../epistemicBeliefModel.js");
      const { topic, agents, rounds } = req.body ?? {};
      if (!topic || !agents || !Array.isArray(agents)) {
        res.status(400).json({ error: "topic and agents[] are required" });
        return;
      }
      const debate = await startDebate(topic, agents, rounds ?? 3);
      res.json(debate);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // ── AST Knowledge Graph ─────────────────────────────────────────────────────

  app.get("/api/godel/ast/stats", async (_req, res) => {
    try {
      const { getGraphStats } = await import("../astKnowledgeGraph.js");
      res.json(getGraphStats());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.post("/api/godel/ast/impact", async (req, res) => {
    try {
      const { findImpactRadius } = await import("../astKnowledgeGraph.js");
      const { nodeId, maxDepth } = req.body ?? {};
      if (!nodeId) {
        res.status(400).json({ error: "nodeId is required" });
        return;
      }
      const impact = findImpactRadius(nodeId, maxDepth ?? 3);
      res.json(impact);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.post("/api/godel/ast/search", async (req, res) => {
    try {
      const { semanticSearch } = await import("../astKnowledgeGraph.js");
      const { query, limit } = req.body ?? {};
      if (!query) {
        res.status(400).json({ error: "query is required" });
        return;
      }
      const results = semanticSearch(query, limit ?? 10);
      res.json({ results });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
}
