/**
 * v50.test.ts — Sub-Agent Economy V
 * Tests: agentKnowledgeSharer, agentSpecializationEngine, agentEvolutionTracker,
 *        agentCollectiveIntelligence, agentEmergenceDetectorV50, agentEconomyOptimizer
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  publishArtifact, requestKnowledge, searchArtifacts, getArtifact,
  _resetKnowledgeSharerForTest,
} from "./agentKnowledgeSharer.js";

import {
  recordSkillUsage, recommendSpecialization, getProfile,
  _resetSpecializationEngineForTest,
} from "./agentSpecializationEngine.js";

import {
  recordGeneration, recordMutation, getEvolutionTrend, getTopAgents,
  getGenerationHistory, _resetEvolutionTrackerForTest,
} from "./agentEvolutionTracker.js";

import {
  submitObservation, aggregateInsight, getObservationCount,
  _resetCollectiveIntelligenceForTest,
} from "./agentCollectiveIntelligence.js";

import {
  recordBehaviorSignal, getPatterns, getNoveltyScore,
  _resetEmergenceDetectorV50ForTest,
} from "./agentEmergenceDetectorV50.js";

import {
  optimize, getLatestResult, getOptimizationHistory,
  _resetEconomyOptimizerForTest,
} from "./agentEconomyOptimizer.js";

describe("v50 Sub-Agent Economy V", () => {
  // ─── agentKnowledgeSharer ─────────────────────────────────────────────────
  describe("agentKnowledgeSharer", () => {
    beforeEach(() => _resetKnowledgeSharerForTest());

    it("should publish and retrieve a public artifact", () => {
      const artifact = publishArtifact("agent1", "ml-patterns", { patterns: ["attention"] }, "public", ["ml"]);
      expect(artifact.artifactId).toBeTruthy();
      expect(artifact.version).toBe(1);
    });

    it("should fulfill knowledge request immediately for shared artifact", () => {
      publishArtifact("agent1", "deployment-guide", { steps: 5 }, "shared");
      const req = requestKnowledge("agent2", "deployment-guide");
      expect(req.fulfilled).toBe(true);
      expect(req.artifactId).toBeTruthy();
    });

    it("should deny access to private artifacts from other agents", () => {
      const artifact = publishArtifact("agent1", "secret-key", "top-secret", "private");
      const result = getArtifact(artifact.artifactId, "agent2");
      expect(result).toBeNull();
    });

    it("should search artifacts by tag", () => {
      publishArtifact("agent1", "gpu-optimization", { tips: 3 }, "public", ["gpu", "performance"]);
      const results = searchArtifacts("gpu", "agent2");
      expect(results.length).toBeGreaterThan(0);
    });

    it("should version artifacts on update", () => {
      publishArtifact("agent1", "config", { v: 1 }, "shared");
      const updated = publishArtifact("agent1", "config", { v: 2 }, "shared");
      expect(updated.version).toBe(2);
    });
  });

  // ─── agentSpecializationEngine ────────────────────────────────────────────
  describe("agentSpecializationEngine", () => {
    beforeEach(() => _resetSpecializationEngineForTest());

    it("should track skill usage and build profile", () => {
      for (let i = 0; i < 10; i++) recordSkillUsage("a1", "code", true);
      const profile = getProfile("a1");
      expect(profile).toBeTruthy();
      expect(profile!.skills.has("code")).toBe(true);
      expect(profile!.skills.get("code")!.level).toBeGreaterThan(0);
    });

    it("should recommend specialization based on skill and demand", () => {
      for (let i = 0; i < 20; i++) recordSkillUsage("a1", "ml", true);
      for (let i = 0; i < 5; i++) recordSkillUsage("a1", "code", true);
      const demand = new Map([["ml", 0.9], ["code", 0.5]]);
      const rec = recommendSpecialization("a1", demand);
      expect(rec.recommendedPath).toBe("ml");
      expect(rec.confidence).toBeGreaterThan(0);
    });

    it("should penalize skill level on failures", () => {
      recordSkillUsage("a1", "deploy", true);
      const before = getProfile("a1")!.skills.get("deploy")!.level;
      recordSkillUsage("a1", "deploy", false);
      const after = getProfile("a1")!.skills.get("deploy")!.level;
      expect(after).toBeLessThan(before);
    });
  });

  // ─── agentEvolutionTracker ────────────────────────────────────────────────
  describe("agentEvolutionTracker", () => {
    beforeEach(() => _resetEvolutionTrackerForTest());

    it("should record generations and track fitness", () => {
      const fitness = new Map([["a1", 0.6], ["a2", 0.8], ["a3", 0.5]]);
      const gen = recordGeneration(["a1", "a2", "a3"], fitness, 0.1, 0.5);
      expect(gen.generationId).toBe(1);
      expect(gen.maxFitness).toBe(0.8);
      expect(gen.avgFitness).toBeCloseTo(0.633, 1);
    });

    it("should detect improving evolution trend", () => {
      for (let i = 1; i <= 4; i++) {
        const fitness = new Map([["a1", i * 0.2]]);
        recordGeneration(["a1"], fitness, 0.1, 0.5);
      }
      expect(getEvolutionTrend()).toBe("improving");
    });

    it("should return top agents by fitness", () => {
      const fitness = new Map([["a1", 0.9], ["a2", 0.5], ["a3", 0.7]]);
      recordGeneration(["a1", "a2", "a3"], fitness, 0.1, 0.5);
      const top = getTopAgents(2);
      expect(top[0]).toBe("a1");
      expect(top[1]).toBe("a3");
    });

    it("should track mutations", () => {
      const fitness = new Map([["a1", 0.5]]);
      recordGeneration(["a1"], fitness, 0.1, 0.5);
      recordMutation("a1");
      recordMutation("a1");
      const history = getGenerationHistory();
      expect(history).toHaveLength(1);
    });
  });

  // ─── agentCollectiveIntelligence ──────────────────────────────────────────
  describe("agentCollectiveIntelligence", () => {
    beforeEach(() => _resetCollectiveIntelligenceForTest());

    it("should aggregate observations with weighted average", () => {
      submitObservation("a1", "market-sentiment", 0.8, 0.9);
      submitObservation("a2", "market-sentiment", 0.6, 0.5);
      submitObservation("a3", "market-sentiment", 0.7, 0.8);
      const insight = aggregateInsight("market-sentiment", "weighted-avg");
      expect(insight).not.toBeNull();
      expect(insight!.aggregatedValue).toBeGreaterThan(0.6);
      expect(insight!.observationCount).toBe(3);
    });

    it("should detect consensus when observations agree", () => {
      for (let i = 0; i < 5; i++) submitObservation(`a${i}`, "risk-level", 0.75 + i * 0.01, 0.9);
      const insight = aggregateInsight("risk-level");
      expect(insight!.consensus).toBe(true);
    });

    it("should use majority vote method", () => {
      submitObservation("a1", "buy-signal", 0.8, 0.9);
      submitObservation("a2", "buy-signal", 0.7, 0.8);
      submitObservation("a3", "buy-signal", 0.3, 0.6);
      const insight = aggregateInsight("buy-signal", "majority-vote");
      expect(insight!.aggregatedValue).toBeCloseTo(0.667, 1);
    });
  });

  // ─── agentEmergenceDetectorV50 ────────────────────────────────────────────
  describe("agentEmergenceDetectorV50", () => {
    beforeEach(() => _resetEmergenceDetectorV50ForTest());

    it("should detect collaboration pattern when 3+ agents share behavior", () => {
      recordBehaviorSignal({ agentId: "a1", behavior: "task-sharing", frequency: 2, associatedAgents: ["a2"], timestamp: Date.now() });
      recordBehaviorSignal({ agentId: "a2", behavior: "task-sharing", frequency: 2, associatedAgents: ["a1"], timestamp: Date.now() });
      recordBehaviorSignal({ agentId: "a3", behavior: "task-sharing", frequency: 2, associatedAgents: ["a1"], timestamp: Date.now() });
      const patterns = getPatterns("collaboration");
      expect(patterns.length).toBeGreaterThan(0);
    });

    it("should detect knowledge cascade", () => {
      recordBehaviorSignal({ agentId: "a1", behavior: "knowledge-propagation", frequency: 5, associatedAgents: ["a2", "a3"], timestamp: Date.now() });
      const patterns = getPatterns("knowledge-cascade");
      expect(patterns.length).toBeGreaterThan(0);
    });

    it("should compute novelty score", () => {
      recordBehaviorSignal({ agentId: "a1", behavior: "novel-behavior", frequency: 5, associatedAgents: ["a2", "a3"], timestamp: Date.now() });
      const score = getNoveltyScore();
      expect(score).toBeGreaterThan(0);
    });
  });

  // ─── agentEconomyOptimizer ────────────────────────────────────────────────
  describe("agentEconomyOptimizer", () => {
    beforeEach(() => _resetEconomyOptimizerForTest());

    it("should recommend spawn action for throughput gap", () => {
      const result = optimize([
        { metric: "throughput", weight: 1.0, currentValue: 0.4, targetValue: 0.8 },
      ]);
      expect(result.actions.some(a => a.type === "spawn")).toBe(true);
    });

    it("should recommend terminate action for cost reduction", () => {
      const result = optimize([
        { metric: "cost", weight: 1.0, currentValue: 0.9, targetValue: 0.5 },
      ]);
      expect(result.actions.some(a => a.type === "terminate")).toBe(true);
    });

    it("should compute overall score", () => {
      const result = optimize([
        { metric: "throughput", weight: 0.5, currentValue: 0.8, targetValue: 1.0 },
        { metric: "cost", weight: 0.5, currentValue: 0.6, targetValue: 0.6 },
      ]);
      expect(result.overallScore).toBeGreaterThan(0);
      expect(result.overallScore).toBeLessThanOrEqual(1.0);
    });

    it("should return no actions when targets are met", () => {
      const result = optimize([
        { metric: "throughput", weight: 1.0, currentValue: 0.98, targetValue: 1.0 },
      ]);
      expect(result.actions).toHaveLength(0);
    });
  });
});
