import { describe, it, expect, vi, beforeEach } from "vitest";
import { publishToFederatedGraph, queryFederatedGraph } from "./federatedKnowledgeGraph.js";
import { discoverActiveSpecialization, recordSpecializationOutcome, getSpecializedPrompt } from "./emergentSpecialization.js";
import { recordTemporalEvent, evaluateCounterfactual, detectTemporalDrift } from "./temporalReasoningEngine.js";
import { reviewPullRequest } from "./autonomousCodeReviewer.js";
import { checkSystemHealth, applySelfHealing, _setMockApiRateLimit } from "./selfHealingInfra.js";
import { optimizeHyperparameters } from "./quantumInspiredOptimizer.js";
import fs from "fs";

// Mock the fs module
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

// Mock LLM provider
vi.mock("./llmProvider.js", () => {
  return {
    simpleChatCompletion: vi.fn().mockResolvedValue(JSON.stringify({
      approved: false,
      summary: "Needs security fixes",
      comments: [{ file: "test.ts", line: 10, comment: "XSS vulnerability", severity: "critical" }]
    }))
  };
});

describe("v27 Collective Superintelligence Enhancements", () => {
  beforeEach(() => {
    // @ts-ignore
    fs.__resetMockStorage?.();
  });

  describe("Federated Knowledge Graph", () => {
    it("should publish and query verified patterns", () => {
      publishToFederatedGraph("react_useeffect_memory_leak", "Add cleanup function", 0.95);
      publishToFederatedGraph("react_useeffect_memory_leak", "Ignore it", 0.1);
      
      const result = queryFederatedGraph("memory_leak");
      expect(result).not.toBeNull();
      expect(result?.solution).toBe("Add cleanup function");
      expect(result?.successRate).toBe(0.95);
    });

    it("should return null for unknown patterns", () => {
      expect(queryFederatedGraph("unknown_pattern")).toBeNull();
    });
  });

  describe("Emergent Specialization", () => {
    it("should discover active specialization based on competence", () => {
      // Train the security expert role
      for (let i = 0; i < 10; i++) recordSpecializationOutcome("security_expert", true);
      
      // Train generalist poorly
      for (let i = 0; i < 10; i++) recordSpecializationOutcome("generalist", false);
      
      const activeRole = discoverActiveSpecialization();
      expect(activeRole).toBe("security_expert");
      
      const prompt = getSpecializedPrompt(activeRole);
      expect(prompt).toContain("security researcher");
    });
  });

  describe("Temporal Reasoning Engine", () => {
    it("should evaluate counterfactuals correctly", () => {
      // Historical data
      recordTemporalEvent("refactor", "fileA.ts", 0.8);
      recordTemporalEvent("refactor", "fileB.ts", 0.9);
      
      // Actual data for target file
      recordTemporalEvent("lint", "target.ts", 0.4);
      recordTemporalEvent("lint", "target.ts", 0.5);
      
      // Counterfactual: what if we refactored target.ts instead of linting?
      // Avg refactor = 0.85. Avg lint = 0.45. Delta should be +0.40.
      const delta = evaluateCounterfactual("target.ts", "refactor");
      expect(delta).toBeCloseTo(0.40, 2);
    });

    it("should detect temporal drift", () => {
      // 10 good historical events
      for (let i = 0; i < 10; i++) recordTemporalEvent("test", "test.ts", 0.9);
      
      // 10 bad recent events
      for (let i = 0; i < 10; i++) recordTemporalEvent("test", "test.ts", 0.4);
      
      expect(detectTemporalDrift()).toBe(true);
    });
  });

  describe("Autonomous Code Reviewer", () => {
    it("should review a PR and return structured feedback", async () => {
      const pr = {
        id: "123",
        title: "Fix bug",
        description: "Fixes a bug",
        diff: "+ console.log('test')",
        author: "dev"
      };
      
      const result = await reviewPullRequest(pr);
      expect(result.approved).toBe(false);
      expect(result.comments.length).toBe(1);
      expect(result.comments[0].severity).toBe("critical");
    });
  });

  describe("Self-Healing Infrastructure", () => {
    it("should detect critical API rate limits", () => {
      _setMockApiRateLimit(5); // Critical
      const health = checkSystemHealth();
      expect(health.status).toBe("critical");
      
      const healed = applySelfHealing();
      expect(healed).toBe(true);
    });

    it("should report healthy when limits are fine", () => {
      _setMockApiRateLimit(1000); // Healthy
      const health = checkSystemHealth();
      // CPU/Mem might vary in real environment, but usually not critical in test
      if (health.memoryUsagePct < 75 && health.cpuLoad < 75) {
        expect(health.status).toBe("healthy");
        expect(applySelfHealing()).toBe(false);
      }
    });
  });

  describe("Quantum-Inspired Optimizer", () => {
    it("should optimize hyperparameters", () => {
      const initialParams = {
        temperature: 0.5,
        debateRounds: 2,
        concurrencyLevel: 4,
        critiquePasses: 1
      };
      
      // Simple fitness function: peak at temp=0.2, debate=3
      const fitnessFn = (p: any) => {
        return 1.0 - Math.abs(p.temperature - 0.2) - Math.abs(p.debateRounds - 3) * 0.1;
      };
      
      const result = optimizeHyperparameters(initialParams, fitnessFn, 50);
      expect(result.fitness).toBeGreaterThan(fitnessFn(initialParams));
      expect(result.params.debateRounds).toBeGreaterThanOrEqual(2);
    });
  });
});
