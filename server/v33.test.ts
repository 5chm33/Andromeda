import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  globalComputeEconomy,
  earnCredits,
  spendCredits,
  clearMarket,
  getEconomyReport,
  initComputeEconomyManager,
} from "./computeEconomyManager";

import {
  globalGovernanceConstitution,
  proposeAmendment,
  voteOnAmendment,
  enforceConstitution,
  getConstitutionText,
  initGovernanceConstitution,
} from "./governanceConstitution";

import {
  globalLongRangePlanner,
  buildPlanningTree,
  simulateTrajectory,
  selectOptimalPlan,
  updatePlanFromObservations,
  initLongRangePlanner,
} from "./longRangePlanner";

import {
  globalRedTeam,
  generateAdversarialProposal,
  testConstitutionalRobustness,
  reportVulnerabilities,
  hardenAgainstFindings,
  initAdversarialRedTeam,
} from "./adversarialRedTeam";

import {
  globalTemporalAbstractionEngine,
  planAtTimescale,
  alignTimescales,
  detectTemporalConflict,
  synthesizeMultiTimescalePlan,
  initTemporalAbstractionEngine,
} from "./temporalAbstractionEngine";

import {
  globalAIBootstrapper,
  specifyArchitecture,
  generateTrainingCurriculum,
  evaluateBootstrappedSystem,
  transferKnowledge,
  initAIBootstrapper,
} from "./aiBootstrapper";

describe("v33 Civilization Protocol Enhancements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Compute Economy Manager ─────────────────────────────────────────────────
  describe("Compute Economy Manager", () => {
    it("should initialize and seed core module credits", () => {
      expect(() => initComputeEconomyManager()).not.toThrow();
      const report = getEconomyReport();
      expect(report.totalCreditsInCirculation).toBeGreaterThan(0);
    });

    it("should earn credits proportional to capability gain", () => {
      const earned = earnCredits("testModule", 0.01);
      expect(earned).toBe(10);
      expect(globalComputeEconomy.getBalance("testModule")).toBeGreaterThan(0);
    });

    it("should spend credits and reduce balance", () => {
      earnCredits("spendTest", 0.1); // 100 credits
      const balanceBefore = globalComputeEconomy.getBalance("spendTest");
      const success = spendCredits("spendTest", 50);
      expect(success).toBe(true);
      expect(globalComputeEconomy.getBalance("spendTest")).toBeLessThan(balanceBefore);
    });

    it("should reject spend if insufficient balance", () => {
      const success = spendCredits("emptyModule", 99999);
      expect(success).toBe(false);
    });

    it("should clear market and allocate compute", () => {
      earnCredits("bidder1", 0.5);
      earnCredits("bidder2", 0.3);
      const result = clearMarket([
        { moduleId: "bidder1", requestedTokens: 1000, requestedCpuMs: 500, valuationScore: 0.9, bidPrice: 100 },
        { moduleId: "bidder2", requestedTokens: 500, requestedCpuMs: 250, valuationScore: 0.7, bidPrice: 50 },
      ]);
      expect(result.allocations instanceof Map).toBe(true);
      expect(typeof result.clearingPrice).toBe("number");
      expect(result.utilizationRate).toBeGreaterThanOrEqual(0);
    });

    it("should return economy report with Gini coefficient", () => {
      const report = getEconomyReport();
      expect(typeof report.giniCoefficient).toBe("number");
      expect(report.giniCoefficient).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(report.topEarners)).toBe(true);
    });
  });

  // ─── Governance Constitution ─────────────────────────────────────────────────
  describe("Governance Constitution Engine", () => {
    it("should initialize with default articles", () => {
      expect(() => initGovernanceConstitution()).not.toThrow();
      const articles = globalGovernanceConstitution.getArticles();
      expect(articles.length).toBeGreaterThanOrEqual(5);
    });

    it("should return constitution text", () => {
      const text = getConstitutionText();
      expect(text).toContain("Primacy of Safety");
      expect(text).toContain("Monotonic Capability Improvement");
    });

    it("should enforce constitution and allow safe proposals", () => {
      const result = enforceConstitution({
        targetFile: "utils/helper.ts",
        description: "Add utility function",
        safetyScore: 0.9999,
        capabilityDelta: 0.001,
      });
      expect(result.allowed).toBe(true);
      expect(result.violations.length).toBe(0);
    });

    it("should enforce constitution and block unsafe proposals", () => {
      const result = enforceConstitution({
        targetFile: "utils/helper.ts",
        description: "Risky change",
        safetyScore: 0.95, // below 0.9999 threshold
        capabilityDelta: -0.01, // regression
      });
      expect(result.allowed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it("should block modifications to core modules", () => {
      const result = enforceConstitution({
        targetFile: "server/rsiEngine.ts",
        description: "Modify core RSI engine",
        safetyScore: 0.9999,
        capabilityDelta: 0.001,
      });
      expect(result.allowed).toBe(false);
    });

    it("should propose and vote on amendments", () => {
      const amendment = proposeAmendment(
        "art-2",
        "All accepted proposals must demonstrate a net positive capability gain of at least 0.0001.",
        "Tighten the threshold",
        "system"
      );
      expect(amendment.id).toBeTruthy();
      expect(amendment.status).toBe("pending");

      // Cast 7 yes votes to pass
      for (let i = 0; i < 7; i++) {
        voteOnAmendment(amendment.id, `voter-${i}`, "yes");
      }
      const amendments = globalGovernanceConstitution.getAmendments();
      const passed = amendments.find(a => a.id === amendment.id);
      expect(passed?.status).toBe("passed");
    });
  });

  // ─── Long-Range Planner ──────────────────────────────────────────────────────
  describe("Long-Range Planning Engine (MCTS)", () => {
    it("should initialize without errors", () => {
      expect(() => initLongRangePlanner()).not.toThrow();
    });

    it("should build a planning tree", () => {
      const state = {
        capabilityLevels: { accuracy: 0.9999, speed: 0.95 },
        cycleNumber: 0,
        accumulatedReward: 0,
      };
      const tree = buildPlanningTree(state, 5);
      expect(tree.id).toBeTruthy();
      expect(tree.children.length).toBeGreaterThan(0);
    });

    it("should select an optimal plan from tree", () => {
      const state = {
        capabilityLevels: { accuracy: 0.9999, speed: 0.95 },
        cycleNumber: 0,
        accumulatedReward: 0,
      };
      const tree = buildPlanningTree(state, 5);
      const plan = selectOptimalPlan(tree);
      expect(plan.actions.length).toBeGreaterThan(0);
      expect(typeof plan.expectedTotalReward).toBe("number");
    });

    it("should simulate trajectory", () => {
      const state = {
        capabilityLevels: { accuracy: 0.9999, speed: 0.95 },
        cycleNumber: 0,
        accumulatedReward: 0,
      };
      const tree = buildPlanningTree(state, 3);
      const plan = selectOptimalPlan(tree);
      const sim = simulateTrajectory(plan, 10);
      expect(typeof sim.totalReward).toBe("number");
      expect(Array.isArray(sim.reachedTargets)).toBe(true);
    });

    it("should update plan from observations", () => {
      expect(() => updatePlanFromObservations({ action: "improve_accuracy", reward: 0.001 })).not.toThrow();
    });
  });

  // ─── Adversarial Red Team ────────────────────────────────────────────────────
  describe("Adversarial Red Team", () => {
    it("should initialize without errors", () => {
      expect(() => initAdversarialRedTeam()).not.toThrow();
    });

    it("should generate adversarial proposals", () => {
      const proposal = generateAdversarialProposal("rewardModel.ts");
      expect(proposal.id).toBeTruthy();
      expect(proposal.adversarialContent).toBeTruthy();
      expect(["critical", "high", "medium", "low"]).toContain(proposal.severity);
    });

    it("should test constitutional robustness", () => {
      const vulns = testConstitutionalRobustness(globalGovernanceConstitution);
      expect(Array.isArray(vulns)).toBe(true);
    });

    it("should generate a security report", () => {
      const vulns = testConstitutionalRobustness(globalGovernanceConstitution);
      const report = reportVulnerabilities(vulns);
      expect(typeof report.overallSecurityScore).toBe("number");
      expect(report.overallSecurityScore).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(report.recommendations)).toBe(true);
    });

    it("should harden against findings", () => {
      const vulns = testConstitutionalRobustness(globalGovernanceConstitution);
      const report = reportVulnerabilities(vulns);
      const result = hardenAgainstFindings(report);
      expect(typeof result.patchesApplied).toBe("number");
      expect(typeof result.remainingVulnerabilities).toBe("number");
    });
  });

  // ─── Temporal Abstraction Engine ─────────────────────────────────────────────
  describe("Temporal Abstraction Engine", () => {
    it("should initialize and create default multi-timescale plan", () => {
      expect(() => initTemporalAbstractionEngine()).not.toThrow();
    });

    it("should plan at each timescale", () => {
      for (const timescale of ["second", "minute", "hour", "day"] as const) {
        const plan = planAtTimescale(timescale, `Test goal at ${timescale} scale`);
        expect(plan.timescale).toBe(timescale);
        expect(plan.actions.length).toBeGreaterThan(0);
      }
    });

    it("should align timescales", () => {
      const plans = [
        planAtTimescale("day", "Reach omega convergence"),
        planAtTimescale("hour", "Complete 10 improvement cycles"),
        planAtTimescale("minute", "Run one RSI cycle"),
        planAtTimescale("second", "Evaluate proposal"),
      ];
      const aligned = alignTimescales(plans);
      expect(aligned.length).toBe(4);
      // Lower timescale plans should reference higher ones
      const minutePlan = aligned.find(p => p.timescale === "minute");
      expect(minutePlan?.goal).toContain("aligned with");
    });

    it("should detect temporal conflicts", () => {
      const plans = [
        planAtTimescale("hour", "reduce compute usage"),
        planAtTimescale("day", "increase capability coverage"),
      ];
      const conflicts = detectTemporalConflict(plans);
      expect(Array.isArray(conflicts)).toBe(true);
    });

    it("should synthesize a multi-timescale plan", () => {
      const multiPlan = synthesizeMultiTimescalePlan({
        second: "Evaluate proposal",
        minute: "Run improvement cycle",
        hour: "Advance capability metrics",
        day: "Reach omega convergence",
      });
      expect(multiPlan.secondPlan).toBeTruthy();
      expect(multiPlan.dayPlan).toBeTruthy();
      expect(typeof multiPlan.alignmentScore).toBe("number");
    });
  });

  // ─── AI Bootstrapper ─────────────────────────────────────────────────────────
  describe("AI Bootstrapper", () => {
    it("should initialize without errors", () => {
      expect(() => initAIBootstrapper()).not.toThrow();
    });

    it("should specify an architecture", () => {
      const spec = specifyArchitecture({
        targetCapabilities: ["reasoning", "coding"],
        computeBudget: "medium",
        latencyTarget: 200,
        memoryBudget: 4096,
      });
      expect(spec.id).toBeTruthy();
      expect(spec.layers.length).toBeGreaterThan(0);
      expect(spec.totalParameters).toBeGreaterThan(0);
    });

    it("should generate a training curriculum", () => {
      const spec = specifyArchitecture({
        targetCapabilities: ["accuracy"],
        computeBudget: "low",
        latencyTarget: 50,
        memoryBudget: 1024,
      });
      const curriculum = generateTrainingCurriculum(spec);
      expect(curriculum.phases.length).toBeGreaterThan(0);
      expect(curriculum.totalEstimatedEpochs).toBeGreaterThan(0);
    });

    it("should evaluate a bootstrapped system", () => {
      const spec = specifyArchitecture({
        targetCapabilities: ["speed"],
        computeBudget: "low",
        latencyTarget: 100,
        memoryBudget: 512,
      });
      const curriculum = generateTrainingCurriculum(spec);
      const system = {
        id: "test-system",
        architecture: spec,
        curriculum,
        benchmarkScores: {},
        transferredKnowledge: [],
        bootstrappedAt: Date.now(),
      };
      const scores = evaluateBootstrappedSystem(system);
      expect(typeof scores.accuracy).toBe("number");
      expect(scores.accuracy).toBeGreaterThan(0.8);
    });

    it("should transfer knowledge to a bootstrapped system", () => {
      const spec = specifyArchitecture({
        targetCapabilities: ["generalization"],
        computeBudget: "high",
        latencyTarget: 1000,
        memoryBudget: 16384,
      });
      const curriculum = generateTrainingCurriculum(spec);
      const system = {
        id: "test-system-2",
        architecture: spec,
        curriculum,
        benchmarkScores: {},
        transferredKnowledge: [],
        bootstrappedAt: Date.now(),
      };
      const knowledge = ["lesson 1: always validate inputs", "lesson 2: prefer monotonic improvements"];
      transferKnowledge(knowledge, system);
      expect(system.transferredKnowledge).toEqual(knowledge);
    });
  });
});
