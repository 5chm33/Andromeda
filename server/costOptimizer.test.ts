/**
 * costOptimizer.test.ts — Unit tests for Phase 1 cost optimization
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  scoreProposalComplexity,
  selectCostOptimalModel,
  getCostStats,
  recordCost,
  getModelProfiles,
} from "./costOptimizer.js";

describe("costOptimizer", () => {
  describe("scoreProposalComplexity", () => {
    it("scores critical RSI files high", () => {
      const result = scoreProposalComplexity("rsiEngine.ts", "+line1\n+line2\n-old", "security");
      expect(result.score).toBeGreaterThanOrEqual(7);
      expect(result.fileCriticality).toBe("critical");
    });

    it("scores test files low", () => {
      const result = scoreProposalComplexity("cache.test.ts", "+line1\n-old", "readability");
      expect(result.score).toBeLessThanOrEqual(4);
    });

    it("increases score for large diffs", () => {
      const smallDiff = "+line\n-old";
      const largeDiff = Array(120).fill("+line").join("\n");
      const small = scoreProposalComplexity("utils.ts", smallDiff, "readability");
      const large = scoreProposalComplexity("utils.ts", largeDiff, "readability");
      expect(large.score).toBeGreaterThan(small.score);
    });

    it("returns a score between 0 and 10", () => {
      const result = scoreProposalComplexity("anyFile.ts", "+change", "feature");
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(10);
    });
  });

  describe("selectCostOptimalModel", () => {
    it("selects a local model for low complexity when Ollama is available", () => {
      const complexity = scoreProposalComplexity("cache.test.ts", "+line", "readability");
      const result = selectCostOptimalModel(complexity, true);
      expect(result.profile.isLocal).toBe(true);
    });

    it("selects a non-local model when Ollama is unavailable", () => {
      const complexity = scoreProposalComplexity("cache.test.ts", "+line", "readability");
      const result = selectCostOptimalModel(complexity, false);
      expect(result.modelId).toBeTruthy();
    });

    it("selects premium model for critical complexity", () => {
      const complexity = { score: 10, diffLines: 200, fileCriticality: "critical" as const, area: "security", reasoning: "" };
      const result = selectCostOptimalModel(complexity, false);
      // Premium model should have high maxComplexityScore
      expect(result.profile.maxComplexityScore).toBeGreaterThanOrEqual(10);
    });

    it("returns a reason string", () => {
      const complexity = scoreProposalComplexity("utils.ts", "+change", "feature");
      const result = selectCostOptimalModel(complexity, false);
      expect(typeof result.reason).toBe("string");
      expect(result.reason.length).toBeGreaterThan(0);
    });
  });

  describe("getCostStats", () => {
    it("returns valid stats structure", () => {
      const stats = getCostStats();
      expect(typeof stats.totalSpentUsd).toBe("number");
      expect(typeof stats.todaySpentUsd).toBe("number");
      expect(typeof stats.thisHourSpentUsd).toBe("number");
      expect(typeof stats.totalCalls).toBe("number");
      expect(typeof stats.byModel).toBe("object");
    });
  });

  describe("recordCost", () => {
    it("records a cost entry and updates stats", () => {
      const before = getCostStats();
      recordCost("deepseek-chat", 1000, 500, "test-proposal", "feature");
      const after = getCostStats();
      expect(after.totalCalls).toBe(before.totalCalls + 1);
    });

    it("handles unknown model gracefully", () => {
      expect(() => recordCost("unknown-model-xyz", 100, 50)).not.toThrow();
    });
  });

  describe("getModelProfiles", () => {
    it("returns an array of model profiles", () => {
      const profiles = getModelProfiles();
      expect(Array.isArray(profiles)).toBe(true);
      expect(profiles.length).toBeGreaterThan(0);
    });

    it("includes both local and cloud models", () => {
      const profiles = getModelProfiles();
      expect(profiles.some(p => p.isLocal)).toBe(true);
      expect(profiles.some(p => !p.isLocal)).toBe(true);
    });
  });
});
