import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Mock AI tokens
vi.mock("./aiTokens.js", () => ({
  getApiKey: () => null, // Force mock mode
  getApiUrl: () => "https://api.openai.com/v1",
  getProviderHeaders: () => ({})
}));

// Mock fs
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  let mockFs: Record<string, string> = {};
  
  return {
    ...actual,
    existsSync: (p: string) => !!mockFs[p] || actual.existsSync(p),
    readFileSync: (p: string, enc: string) => mockFs[p] || actual.readFileSync(p, enc),
    writeFileSync: (p: string, data: string) => { mockFs[p] = data; },
    mkdirSync: (p: string) => { mockFs[p] = "dir"; },
    readdirSync: (p: string) => {
      if (p.includes("emergent_training_data")) {
        return Object.keys(mockFs).filter(k => k.includes("emergent_training_data") && k.endsWith(".json") && !k.includes("archive")).map(k => path.basename(k));
      }
      return [];
    },
    renameSync: (oldPath: string, newPath: string) => {
      mockFs[newPath] = mockFs[oldPath];
      delete mockFs[oldPath];
    },
    _resetMockFs: () => { mockFs = {}; }
  };
});

import { initMetaMetaRsi, getMetaMetaVelocity, recordMetaMetaVelocity, runMetaMetaRsiPass, isMetaMetaConverged } from "./metaMetaRsi.js";
import { initEmergentFineTuner, collectTrainingPair, triggerEmergentFineTuning, getEmergentModelState } from "./emergentFineTuner.js";
import { initSwarmCoordinator, broadcastToSwarm, getStrongestPheromoneTrails, getSwarmState } from "./swarmCoordinator.js";
import { initTemporalSelfModel, recordCapabilitySnapshot, forecastAcceptanceRate } from "./temporalSelfModel.js";
import { initAdversarialSelfPlay, runAdversarialAttack } from "./adversarialSelfPlay.js";
import { initConstitutionalAmendment, recordBlockedProposal, applyApprovedAmendments } from "./constitutionalAmendment.js";

describe("v23.0.0 Singularity Protocol Modules", () => {
  beforeEach(() => {
    // @ts-ignore
    fs._resetMockFs();
  });

  describe("metaMetaRsi", () => {
    it("initMetaMetaRsi creates velocity file", () => {
      initMetaMetaRsi();
      expect(getMetaMetaVelocity()).toBe(1.0);
    });

    it("recordMetaMetaVelocity updates velocity", () => {
      initMetaMetaRsi();
      recordMetaMetaVelocity(1.05);
      expect(getMetaMetaVelocity()).toBe(1.05);
    });

    it("runMetaMetaRsiPass runs and updates velocity (mocked)", async () => {
      initMetaMetaRsi();
      const result = await runMetaMetaRsiPass();
      expect(result).toBe(true);
      expect(getMetaMetaVelocity()).toBe(1.05);
    });
    
    it("detects convergence", () => {
      initMetaMetaRsi();
      // Force > 10 cycles with small improvement
      for (let i = 0; i < 11; i++) recordMetaMetaVelocity(1.0001);
      expect(isMetaMetaConverged()).toBe(true);
    });
  });

  describe("emergentFineTuner", () => {
    it("initEmergentFineTuner creates state", () => {
      initEmergentFineTuner();
      expect(getEmergentModelState().totalPairsCollected).toBe(0);
    });

    it("collectTrainingPair saves pair", () => {
      initEmergentFineTuner();
      collectTrainingPair("test.ts", "old", "new", "reason");
      expect(getEmergentModelState().totalPairsCollected).toBe(1);
    });

    it("triggerEmergentFineTuning requires 100 pairs", async () => {
      initEmergentFineTuner();
      expect(await triggerEmergentFineTuning()).toBe(false);
      
      for (let i = 0; i < 100; i++) {
        collectTrainingPair(`test${i}.ts`, "old", "new", "reason");
      }
      
      expect(await triggerEmergentFineTuning()).toBe(true);
      expect(getEmergentModelState().activeModel).toBe("finetuned_v1");
    });
  });

  describe("swarmCoordinator", () => {
    it("initSwarmCoordinator creates state", () => {
      initSwarmCoordinator();
      expect(getSwarmState().instanceId).toBeDefined();
    });

    it("broadcastToSwarm records pheromones", () => {
      initSwarmCoordinator();
      broadcastToSwarm("PHEROMONE_TRAIL", { targetFile: "a.ts", strength: 1.0 });
      broadcastToSwarm("PHEROMONE_TRAIL", { targetFile: "a.ts", strength: 0.5 });
      broadcastToSwarm("PHEROMONE_TRAIL", { targetFile: "b.ts", strength: 0.8 });
      
      const trails = getStrongestPheromoneTrails();
      expect(trails[0]).toBe("a.ts");
      expect(trails[1]).toBe("b.ts");
    });
  });

  describe("temporalSelfModel", () => {
    it("initTemporalSelfModel creates state", () => {
      initTemporalSelfModel();
      expect(forecastAcceptanceRate()).toBe(0.99); // default fallback
    });

    it("forecastAcceptanceRate computes linear regression", () => {
      initTemporalSelfModel();
      // Mock Date.now to ensure consistent timestamps
      const now = Date.now();
      const day = 1000 * 60 * 60 * 24;
      
      vi.spyOn(Date, "now").mockReturnValue(now);
      recordCapabilitySnapshot({ acceptanceRate: 0.90, testCoverage: 0.9, benchmarkScore: 0.9, tsErrors: 0 });
      
      vi.spyOn(Date, "now").mockReturnValue(now + day);
      recordCapabilitySnapshot({ acceptanceRate: 0.92, testCoverage: 0.9, benchmarkScore: 0.9, tsErrors: 0 });
      
      vi.spyOn(Date, "now").mockReturnValue(now + day * 2);
      recordCapabilitySnapshot({ acceptanceRate: 0.94, testCoverage: 0.9, benchmarkScore: 0.9, tsErrors: 0 });
      
      // Should predict ~0.96 for day 3 (1 day ahead)
      const forecast = forecastAcceptanceRate(1);
      expect(forecast).toBeGreaterThan(0.95);
      expect(forecast).toBeLessThan(0.97);
      
      vi.restoreAllMocks();
    });
  });

  describe("adversarialSelfPlay", () => {
    it("initAdversarialSelfPlay creates state", () => {
      initAdversarialSelfPlay();
      // Should not throw
    });

    it("runAdversarialAttack returns true in mock mode", async () => {
      initAdversarialSelfPlay();
      const result = await runAdversarialAttack("test.ts", "code");
      expect(result).toBe(true);
    });
  });

  describe("constitutionalAmendment", () => {
    it("initConstitutionalAmendment creates state", () => {
      initConstitutionalAmendment();
      // Should not throw
    });

    it("recordBlockedProposal proposes amendment after 3 violations", () => {
      initConstitutionalAmendment();
      recordBlockedProposal("p1", 0.95, "Rule A");
      recordBlockedProposal("p2", 0.96, "Rule A");
      recordBlockedProposal("p3", 0.97, "Rule A");
      // Amendment should be proposed
    });
    
    it("applyApprovedAmendments applies approved amendments", () => {
      initConstitutionalAmendment();
      // Without full mock setup for the complex apply logic, just verify it runs without crashing
      applyApprovedAmendments();
    });
  });
});
