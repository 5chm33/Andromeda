/**
 * godelRoutes.ts — Andromeda v9.0 Gödel Machine API Routes
 *
 * Exposes the Phase 12–15 modules via REST endpoints.
 * All function names verified against actual module exports.
 *
 *   GET  /api/godel/proof/status          — proof verifier stats
 *   POST /api/godel/proof/verify          — verify a commit proposal
 *   GET  /api/godel/utility/snapshot      — current utility state snapshot + score
 *   GET  /api/godel/utility/weights       — current utility weights
 *   POST /api/godel/utility/calibrate     — trigger weight auto-calibration
 *   GET  /api/godel/semantic/stats        — semantic self-model stats
 *   GET  /api/godel/semantic/modules      — all tracked modules + utility maps
 *   POST /api/godel/semantic/predict      — predict utility delta for a proposal
 *   POST /api/godel/causal/analyze        — causal failure analysis
 *   POST /api/godel/mcts/plan             — plan an RSI goal using MCTS
 *   GET  /api/godel/epistemic/debates     — list active epistemic debates
 *   POST /api/godel/epistemic/debate      — start a new epistemic debate
 *   GET  /api/godel/ast/stats             — AST knowledge graph stats
 *   POST /api/godel/ast/impact            — find impact radius for a node
 *   POST /api/godel/ast/search            — semantic search over the AST graph
 */

import type { Express } from "express";

export function registerGodelRoutes(app: Express): void {

  // ── Proof Verifier ──────────────────────────────────────────────────────────

  app.get("/api/godel/proof/status", async (_req, res) => {
    try {
      const { getVerificationStats } = await import("../proofVerifier.js");
      res.json(getVerificationStats());
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
      });
      res.json(result);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // ── Utility Function ────────────────────────────────────────────────────────

  app.get("/api/godel/utility/snapshot", async (_req, res) => {
    try {
      const { createStateSnapshot, compute, explain, getWeights } = await import("../utilityFunction.js");
      const snapshot = createStateSnapshot();
      const score = compute(snapshot);
      const weights = getWeights();
      res.json({ snapshot, score, explanation: explain(score), weights });
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
      const { calibrate, getUtilityHistory, setWeights } = await import("../utilityFunction.js");
      const history = getUtilityHistory();
      const newWeights = calibrate(history);
      setWeights(newWeights);
      res.json({ success: true, newWeights, historyPoints: history.length });
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
      const { targetModule, changeType } = req.body ?? {};
      if (!targetModule) {
        res.status(400).json({ error: "targetModule is required" });
        return;
      }
      const prediction = impactPredict(
        targetModule,
        changeType ?? "refactor",
      );
      res.json(prediction);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // ── Causal Reasoning ────────────────────────────────────────────────────────

  app.post("/api/godel/causal/analyze", async (req, res) => {
    try {
      const { getRootCauseAnalyzer } = await import("../causalReasoning.js");
      const { failures, maxChains } = req.body ?? {};
      if (!failures || !Array.isArray(failures) || failures.length === 0) {
        res.status(400).json({ error: "failures[] array is required (each: { id, description, timestamp, severity })" });
        return;
      }
      const analyzer = getRootCauseAnalyzer();
      const chains = analyzer.analyzeFailures(failures);
      res.json({ chains: chains.slice(0, maxChains ?? 10) });
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
      const { getEpistemicModel } = await import("../epistemicBeliefModel.js");
      const model = getEpistemicModel();
      res.json(model.getDebates());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.post("/api/godel/epistemic/debate", async (req, res) => {
    try {
      const { getEpistemicModel } = await import("../epistemicBeliefModel.js");
      const { proposalId, topic } = req.body ?? {};
      if (!proposalId || !topic) {
        res.status(400).json({ error: "proposalId and topic are required" });
        return;
      }
      const model = getEpistemicModel();
      const debate = model.startDebate(proposalId, topic);
      res.json(debate);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // ── AST Knowledge Graph ─────────────────────────────────────────────────────

  app.get("/api/godel/ast/stats", async (_req, res) => {
    try {
      const { getKnowledgeGraph } = await import("../astKnowledgeGraph.js");
      const kg = getKnowledgeGraph();
      res.json(kg.getStats());
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.post("/api/godel/ast/impact", async (req, res) => {
    try {
      const { getKnowledgeGraph } = await import("../astKnowledgeGraph.js");
      const { nodeId, maxDepth } = req.body ?? {};
      if (!nodeId) {
        res.status(400).json({ error: "nodeId is required" });
        return;
      }
      const kg = getKnowledgeGraph();
      const impact = kg.findImpactRadius(nodeId);
      res.json(impact);
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  app.post("/api/godel/ast/search", async (req, res) => {
    try {
      const { getKnowledgeGraph } = await import("../astKnowledgeGraph.js");
      const { query, type: nodeType, limit } = req.body ?? {};
      if (!query && !nodeType) {
        res.status(400).json({ error: "query or type is required" });
        return;
      }
      const kg = getKnowledgeGraph();
      // Search by node type if provided, otherwise return all nodes matching query substring
      const allNodes = kg.getNodes();
      const results = allNodes
        .filter(n =>
          (!nodeType || n.type === nodeType) &&
          (!query || n.label.toLowerCase().includes(query.toLowerCase()) ||
            n.filePath.toLowerCase().includes(query.toLowerCase()))
        )
        .slice(0, limit ?? 20);
      res.json({ results, total: results.length });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
}
