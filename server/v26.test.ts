import { describe, it, expect, vi, beforeEach } from "vitest";
import { runSpeculativeDebate, calculateCosineSimilarity } from "./speculativeExecutionEngine.js";
import { routePrompt, getModelForTier } from "./moePromptRouter.js";
import { getDistilledReward } from "./onlineRewardDistiller.js";
import { isSemanticDuplicate, recordSemanticEmbedding } from "./semanticDedup.js";
import { determineSampleCount, selectBestSample } from "./adaptiveSelfConsistency.js";
import { startExperiment, assignVariant, recordVariantOutcome, calculateSignificance } from "./abTestingFramework.js";
import fs from "fs";

// Mock the fs module to avoid writing to disk during tests
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  let mockStorage: Record<string, string> = {};
  return {
    default: {
      ...actual,
      existsSync: vi.fn((path: string) => !!mockStorage[path]),
      readFileSync: vi.fn((path: string) => mockStorage[path] || "{}"),
      writeFileSync: vi.fn((path: string, data: string) => {
        mockStorage[path] = data;
      }),
      mkdirSync: vi.fn(),
      __resetMockStorage: () => { mockStorage = {}; }
    }
  };
});

describe("v26 Zero-Waste Intelligence Enhancements", () => {
  beforeEach(() => {
    // Reset mock storage before each test
    // @ts-ignore
    fs.__resetMockStorage?.();
  });

  describe("Speculative Execution Engine", () => {
    it("should calculate cosine similarity correctly", () => {
      const sim1 = calculateCosineSimilarity("const x = 1;", "const x = 1;");
      expect(sim1).toBe(1.0);
      
      const sim2 = calculateCosineSimilarity("const x = 1;", "let y = 2;");
      expect(sim2).toBeLessThan(1.0);
    });

    it("should reuse debate outcome if similarity is > 0.85", async () => {
      const draft = { draftCode: "const x = 1;", draftConfidence: 0.9 };
      // @ts-ignore
      const finalProposal = { diff: "const x = 1;" };
      
      const result = await runSpeculativeDebate(draft, finalProposal);
      expect(result.reused).toBe(true);
      expect(result.debateOutcome).toBe(true);
    });

    it("should not reuse debate outcome if similarity is <= 0.85", async () => {
      const draft = { draftCode: "const x = 1;", draftConfidence: 0.9 };
      // @ts-ignore
      const finalProposal = { diff: "function complexRefactor() { return false; }" };
      
      const result = await runSpeculativeDebate(draft, finalProposal);
      expect(result.reused).toBe(false);
      expect(result.debateOutcome).toBe(false);
    });
  });

  describe("MoE Prompt Router", () => {
    it("should route syntax tasks to mini tier", () => {
      const result = routePrompt("Fix the syntax error in this file", 500);
      expect(result.tier).toBe("mini");
      expect(getModelForTier(result.tier)).toBe("gpt-4o-mini");
    });

    it("should route architectural tasks to frontier tier", () => {
      const result = routePrompt("Redesign the architecture of the core engine", 5000);
      expect(result.tier).toBe("frontier");
      expect(getModelForTier(result.tier)).toBe("o1-preview");
    });

    it("should route documentation tasks to local tier", () => {
      const result = routePrompt("Generate jsdoc for these functions", 500);
      expect(result.tier).toBe("local");
      expect(getModelForTier(result.tier)).toBe("llama-3.1-8b");
    });
  });

  describe("Online Reward Distiller", () => {
    it("should return high confidence for syntax fixes", async () => {
      // @ts-ignore
      const proposal = { title: "Fix syntax error", rationale: "syntax" };
      const result = await getDistilledReward(proposal);
      expect(result.source).toBe("local_model");
      expect(result.score).toBeGreaterThan(0.9);
    });

    it("should fallback to API for uncertain tasks", async () => {
      // @ts-ignore
      const proposal = { title: "Complex refactor", rationale: "complex" };
      const result = await getDistilledReward(proposal);
      expect(result.source).toBe("api_fallback");
    });
  });

  describe("Semantic Deduplication", () => {
    it("should detect semantic duplicates", () => {
      const code = "function test() { return true; }";
      recordSemanticEmbedding(code);
      
      expect(isSemanticDuplicate(code)).toBe(true);
      expect(isSemanticDuplicate("function completelyDifferent() {}")).toBe(false);
    });
  });

  describe("Adaptive Self-Consistency", () => {
    it("should skip extra samples for high confidence", () => {
      expect(determineSampleCount(0.95)).toBe(1);
    });

    it("should take 2 samples for medium confidence", () => {
      expect(determineSampleCount(0.75)).toBe(2);
    });

    it("should take 3 samples for low confidence", () => {
      expect(determineSampleCount(0.4)).toBe(3);
    });

    it("should select the best sample", () => {
      const samples = [
        { code: "A", confidence: 0.5 },
        { code: "B", confidence: 0.9 },
        { code: "C", confidence: 0.7 }
      ];
      
      const best = selectBestSample(samples);
      expect(best?.code).toBe("B");
    });
  });

  describe("A/B Testing Framework", () => {
    it("should run experiments and calculate significance", () => {
      startExperiment("test_exp", "A", "B");
      
      const variant = assignVariant("test_exp");
      expect(["A", "B"]).toContain(variant);
      
      // Simulate 30 successful A trials
      for (let i = 0; i < 30; i++) recordVariantOutcome("test_exp", "A", 1.0);
      
      // Simulate 30 failed B trials
      for (let i = 0; i < 30; i++) recordVariantOutcome("test_exp", "B", 0.0);
      
      const result = calculateSignificance("test_exp");
      expect(result.significant).toBe(true);
      expect(result.winner).toBe("A");
    });
  });
});
