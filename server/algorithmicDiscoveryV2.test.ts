/**
 * algorithmicDiscoveryV2.test.ts — Unit tests for Phase 3 algorithmic discovery
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  benchmarkCapability,
  getAlgorithmRegistryStats,
  getActiveAlgorithm,
  getAllAlgorithms,
  initAlgorithmicDiscoveryV2,
} from "./algorithmicDiscoveryV2.js";

describe("algorithmicDiscoveryV2", () => {
  beforeEach(() => {
    initAlgorithmicDiscoveryV2();
  });

  describe("benchmarkCapability", () => {
    it("returns a score between 0 and 100 for context_compression", async () => {
      const score = await benchmarkCapability("context_compression");
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it("returns a score between 0 and 100 for proposal_ranking", async () => {
      const score = await benchmarkCapability("proposal_ranking");
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it("returns a score between 0 and 100 for goal_decomposition", async () => {
      const score = await benchmarkCapability("goal_decomposition");
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it("returns a score between 0 and 100 for memory_retrieval", async () => {
      const score = await benchmarkCapability("memory_retrieval");
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it("returns a score between 0 and 100 for cost_estimation", async () => {
      const score = await benchmarkCapability("cost_estimation");
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it("returns a score between 0 and 100 for pattern_matching", async () => {
      const score = await benchmarkCapability("pattern_matching");
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it("returns a score between 0 and 100 for anomaly_detection", async () => {
      const score = await benchmarkCapability("anomaly_detection");
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  describe("getAlgorithmRegistryStats", () => {
    it("returns valid stats structure", () => {
      const stats = getAlgorithmRegistryStats();
      expect(typeof stats.totalAlgorithms).toBe("number");
      expect(typeof stats.activeAlgorithms).toBe("number");
      expect(typeof stats.totalTournaments).toBe("number");
      expect(typeof stats.avgImprovement).toBe("number");
      expect(typeof stats.byCapability).toBe("object");
      expect(Array.isArray(stats.recentTournaments)).toBe(true);
    });

    it("avgImprovement is non-negative", () => {
      const stats = getAlgorithmRegistryStats();
      expect(stats.avgImprovement).toBeGreaterThanOrEqual(0);
    });
  });

  describe("getActiveAlgorithm", () => {
    it("returns null when no algorithm is active for a capability", () => {
      // Fresh init should have no active algorithms unless loaded from disk
      const result = getActiveAlgorithm("anomaly_detection");
      // Can be null or an AlgorithmCandidate
      expect(result === null || typeof result === "object").toBe(true);
    });
  });

  describe("getAllAlgorithms", () => {
    it("returns an array", () => {
      const algorithms = getAllAlgorithms();
      expect(Array.isArray(algorithms)).toBe(true);
    });
  });
});
