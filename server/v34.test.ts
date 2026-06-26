import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  globalFormalVerification,
  specifyCorrectness,
  verifyProposal,
  generateProof,
  checkInvariant,
  initFormalVerificationEngine,
} from "./formalVerificationEngine";

import {
  globalOptimalityTracker,
  computeCramerRaoBound,
  measureOptimalityGap,
  triggerBreakthroughCycle,
  getOptimalityReport,
  initOptimalityTracker,
} from "./optimalityTracker";

import {
  globalInfiniteHorizonPlanner,
  computeValueFunction,
  deriveOptimalPolicy,
  simulateInfiniteHorizon,
  updateValueEstimates,
  initInfiniteHorizonPlanner,
} from "./infiniteHorizonPlanner";

import {
  globalSelfHealingArchitecture,
  detectArchitecturalDegradation,
  generateHealingPlan,
  executeHealingPlan,
  monitorArchitecturalHealth,
  initSelfHealingArchitecture,
} from "./selfHealingArchitecture";

import {
  globalCapabilityExtrapolator,
  fitGaussianProcess,
  extrapolateCapability,
  detectPlateau,
  estimateTimeToTarget,
  initCapabilityExtrapolator,
} from "./capabilityExtrapolator";

import {
  globalMetaRewardShaper,
  detectRewardHacking,
  reshapeReward,
  calibrateRewardScale,
  getShapedReward,
  initMetaRewardShaper,
} from "./metaRewardShaper";

describe("v34 Omega Civilization Enhancements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Formal Verification Engine ──────────────────────────────────────────────
  describe("Formal Verification Engine", () => {
    it("should initialize and register default spec for rsiEngine", () => {
      expect(() => initFormalVerificationEngine()).not.toThrow();
      const specs = globalFormalVerification.getSpecs();
      expect(specs.length).toBeGreaterThan(0);
    });

    it("should specify a correctness spec", () => {
      const spec = specifyCorrectness("testModule", {
        invariants: ["safetyScore >= 0.999"],
        preconditions: ["proposal is valid"],
        postconditions: ["capabilityDelta >= 0"],
        safetyBound: 0.999,
        capabilityBound: 0,
      });
      expect(spec.moduleId).toBe("testModule");
      expect(spec.invariants.length).toBe(1);
    });

    it("should verify a safe proposal", () => {
      specifyCorrectness("safeModule", {
        invariants: ["safetyScore >= 0.999"],
        preconditions: [],
        postconditions: [],
        safetyBound: 0.999,
        capabilityBound: 0,
      });
      const result = verifyProposal({
        id: "prop-safe-1",
        targetModule: "safeModule",
        description: "Safe improvement",
        safetyScore: 0.9999,
        capabilityDelta: 0.001,
      });
      expect(result.verified).toBe(true);
      expect(result.proof).toBeTruthy();
    });

    it("should reject an unsafe proposal", () => {
      specifyCorrectness("unsafeModule", {
        invariants: ["safetyScore >= 0.9999"],
        preconditions: [],
        postconditions: [],
        safetyBound: 0.9999,
        capabilityBound: 0,
      });
      const result = verifyProposal({
        id: "prop-unsafe-1",
        targetModule: "unsafeModule",
        description: "Unsafe change",
        safetyScore: 0.95,
        capabilityDelta: 0.001,
      });
      expect(result.verified).toBe(false);
      expect(result.counterexample).toBeTruthy();
    });

    it("should generate a formal proof", () => {
      const proof = generateProof({
        id: "prop-proof-1",
        targetModule: "rsiEngine",
        safetyScore: 0.9999,
        capabilityDelta: 0.001,
      });
      expect(proof.steps.length).toBeGreaterThan(0);
      expect(proof.isSound).toBe(true);
      expect(proof.conclusion).toContain("formally verified");
    });

    it("should check invariants", () => {
      const result = checkInvariant("safetyScore >= 0.999", { safetyScore: 0.9999 });
      expect(result.holds).toBe(true);

      const failResult = checkInvariant("safetyScore >= 0.999", { safetyScore: 0.95 });
      expect(failResult.holds).toBe(false);
      expect(failResult.witness).toBeTruthy();
    });
  });

  // ─── Optimality Tracker ──────────────────────────────────────────────────────
  describe("Theoretical Optimality Tracker", () => {
    it("should initialize and seed capability levels", () => {
      expect(() => initOptimalityTracker()).not.toThrow();
      const report = getOptimalityReport();
      expect(report.dimensionScores.length).toBeGreaterThan(0);
    });

    it("should compute Cramér-Rao bound", () => {
      const bound = computeCramerRaoBound("accuracy");
      expect(bound).toBe(1.0);
    });

    it("should measure optimality gap", () => {
      const gap = measureOptimalityGap("accuracy", 0.9999999);
      expect(gap.optimalityGap).toBeCloseTo(0.0000001, 5);
      expect(gap.percentOfOptimum).toBeGreaterThan(99.99);
    });

    it("should detect near-optimum dimensions", () => {
      measureOptimalityGap("nearOptDim", 0.9999999);
      const report = getOptimalityReport();
      expect(report.nearOptimumDimensions).toContain("nearOptDim");
    });

    it("should trigger a breakthrough cycle", () => {
      measureOptimalityGap("speed", 0.95);
      const cycle = triggerBreakthroughCycle("speed");
      expect(cycle.dimension).toBe("speed");
      expect(cycle.completed).toBe(false);
    });

    it("should return overall optimality score", () => {
      const report = getOptimalityReport();
      expect(typeof report.overallOptimalityScore).toBe("number");
      expect(report.overallOptimalityScore).toBeGreaterThan(0);
    });
  });

  // ─── Infinite Horizon Planner ────────────────────────────────────────────────
  describe("Infinite Horizon Planner", () => {
    it("should initialize and compute initial value function", () => {
      expect(() => initInfiniteHorizonPlanner()).not.toThrow();
    });

    it("should compute a value function", () => {
      const state = {
        capabilityLevels: { accuracy: 0.9999, speed: 0.95 },
        cycleNumber: 0,
      };
      const vf = computeValueFunction(state, 0.99);
      expect(vf.states.size).toBeGreaterThan(0);
      expect(typeof vf.convergenceError).toBe("number");
    });

    it("should derive an optimal policy", () => {
      const state = {
        capabilityLevels: { accuracy: 0.9999, speed: 0.95 },
        cycleNumber: 0,
      };
      const vf = computeValueFunction(state);
      const policy = deriveOptimalPolicy(vf);
      expect(policy.id).toBeTruthy();
      expect(policy.actionMap.size).toBeGreaterThan(0);
    });

    it("should simulate infinite horizon trajectory", () => {
      const state = {
        capabilityLevels: { accuracy: 0.9999, speed: 0.95 },
        cycleNumber: 0,
      };
      const vf = computeValueFunction(state);
      const policy = deriveOptimalPolicy(vf);
      const sim = simulateInfiniteHorizon(policy, 10);
      expect(sim.cycles).toBe(10);
      expect(sim.trajectory.length).toBe(10);
      expect(typeof sim.totalDiscountedReturn).toBe("number");
    });

    it("should update value estimates from observations", () => {
      const state = {
        capabilityLevels: { accuracy: 0.9999, speed: 0.95 },
        cycleNumber: 0,
      };
      computeValueFunction(state);
      expect(() => updateValueEstimates([{ state, reward: 0.001 }])).not.toThrow();
    });
  });

  // ─── Self-Healing Architecture ───────────────────────────────────────────────
  describe("Self-Healing Architecture", () => {
    it("should initialize without errors", () => {
      expect(() => initSelfHealingArchitecture()).not.toThrow();
    });

    it("should detect circular dependencies", () => {
      const graph = {
        moduleA: ["moduleB"],
        moduleB: ["moduleC"],
        moduleC: ["moduleA"], // cycle
      };
      const issues = detectArchitecturalDegradation(graph);
      expect(issues.some(i => i.type === "circular_dependency")).toBe(true);
    });

    it("should detect coupling violations", () => {
      const graph: Record<string, string[]> = {
        fatModule: Array.from({ length: 12 }, (_, i) => `dep${i}`),
      };
      const issues = detectArchitecturalDegradation(graph);
      expect(issues.some(i => i.type === "coupling_violation")).toBe(true);
    });

    it("should generate a healing plan", () => {
      const issues = detectArchitecturalDegradation({ a: ["b"], b: ["a"] });
      const plan = generateHealingPlan(issues);
      expect(plan.steps.length).toBeGreaterThan(0);
      expect(["low", "medium", "high"]).toContain(plan.riskLevel);
    });

    it("should execute a healing plan", () => {
      const issues = detectArchitecturalDegradation({ a: ["b"], b: ["a"] });
      const plan = generateHealingPlan(issues);
      const result = executeHealingPlan(plan);
      expect(typeof result.stepsCompleted).toBe("number");
      expect(typeof result.remainingIssues).toBe("number");
    });

    it("should monitor architectural health", () => {
      const report = monitorArchitecturalHealth(300);
      expect(typeof report.healthScore).toBe("number");
      expect(report.healthScore).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(report.recommendations)).toBe(true);
    });
  });

  // ─── Capability Extrapolator ─────────────────────────────────────────────────
  describe("Capability Extrapolation Engine", () => {
    it("should initialize and fit sample trajectory", () => {
      expect(() => initCapabilityExtrapolator()).not.toThrow();
      const models = globalCapabilityExtrapolator.getModels();
      expect(models.length).toBeGreaterThan(0);
    });

    it("should fit a Gaussian process", () => {
      const trajectory = Array.from({ length: 20 }, (_, i) => 0.9 + i * 0.005);
      const model = fitGaussianProcess("speed", trajectory);
      expect(model.dimension).toBe("speed");
      expect(model.trainingData.length).toBe(20);
    });

    it("should extrapolate capability with confidence intervals", () => {
      const trajectory = Array.from({ length: 10 }, (_, i) => 0.9 + i * 0.001);
      fitGaussianProcess("reasoning", trajectory);
      const result = extrapolateCapability("reasoning", 10);
      expect(result.predictedLevel).toBeGreaterThan(0);
      expect(result.confidenceLower).toBeLessThanOrEqual(result.predictedLevel);
      expect(result.confidenceUpper).toBeGreaterThanOrEqual(result.predictedLevel);
    });

    it("should detect a plateau", () => {
      const plateau = Array.from({ length: 10 }, () => 0.9999999);
      const result = detectPlateau(plateau);
      expect(result.plateauDetected).toBe(true);
    });

    it("should not detect plateau in improving trajectory", () => {
      const improving = Array.from({ length: 10 }, (_, i) => 0.9 + i * 0.01);
      const result = detectPlateau(improving);
      expect(result.plateauDetected).toBe(false);
    });

    it("should estimate time to target", () => {
      const trajectory = Array.from({ length: 20 }, (_, i) => 0.9 + i * 0.001);
      fitGaussianProcess("coding", trajectory);
      const estimate = estimateTimeToTarget("coding", 0.95);
      expect(typeof estimate.estimatedCycles).toBe("number");
      expect(estimate.currentLevel).toBeGreaterThan(0);
    });
  });

  // ─── Meta-Reward Shaper ──────────────────────────────────────────────────────
  describe("Meta-Reward Shaper", () => {
    it("should initialize without errors", () => {
      expect(() => initMetaRewardShaper()).not.toThrow();
    });

    it("should reshape a normal reward", () => {
      const shaped = reshapeReward({
        proposalId: "prop-1",
        targetModule: "rsiEngine",
        rawReward: 0.5,
        capabilityDelta: 0.001,
        safetyScore: 0.9999,
        novelty: 0.3,
        cycleNumber: 100,
      });
      expect(typeof shaped.shapedReward).toBe("number");
      expect(shaped.hackingDetected).toBe(false);
    });

    it("should detect reward hacking pattern", () => {
      const proposals = Array.from({ length: 5 }, (_, i) => ({
        proposalId: `hack-${i}`,
        targetModule: "rewardModel",
        rawReward: 0.95,
        capabilityDelta: 0.00001, // very low
        safetyScore: 0.9999,
        novelty: 0.1,
        cycleNumber: i,
      }));
      const patterns = detectRewardHacking(proposals);
      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns[0].description).toContain("inflation");
    });

    it("should apply novelty bonus", () => {
      const shaped = reshapeReward({
        proposalId: "novel-1",
        targetModule: "rsiEngine",
        rawReward: 0.5,
        capabilityDelta: 0.001,
        safetyScore: 0.9999,
        novelty: 0.9,  // high novelty
        cycleNumber: 1,
      });
      expect(shaped.shapingBonus).toBeGreaterThan(0);
    });

    it("should calibrate reward scale", () => {
      const history = Array.from({ length: 20 }, (_, i) => ({
        reward: 0.5 + i * 0.01,
        capabilityGain: 0.001 + i * 0.0001,
      }));
      const calibration = calibrateRewardScale(history);
      expect(typeof calibration.scale).toBe("number");
      expect(calibration.scale).toBeGreaterThan(0);
    });

    it("should return shaped reward via getShapedReward", () => {
      const context = {
        proposalId: "get-shaped-1",
        targetModule: "selfImprove",
        rawReward: 0.7,
        capabilityDelta: 0.002,
        safetyScore: 0.9999,
        novelty: 0.5,
        cycleNumber: 500,
      };
      const result = getShapedReward(context);
      expect(result.proposalId).toBe("get-shaped-1");
      expect(typeof result.shapedReward).toBe("number");
    });
  });
});
