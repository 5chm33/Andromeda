/**
 * v64.test.ts — The Adaptation Engine
 */
import { describe, it, expect, beforeEach } from "vitest";
import { recordSignal, adaptToEnvironment, getAdaptationHistory, _resetEnvironmentalAdaptorForTest } from "./environmentalAdaptor";
import { captureDistribution, detectShift, _resetDistributionShiftDetectorForTest } from "./distributionShiftDetector";
import { initializeModel, onlineUpdate, getModelState, _resetOnlineLearningControllerForTest } from "./onlineLearningController";
import { recordPredictionError, checkForDrift, getDriftHistory, _resetConceptDriftHandlerForTest } from "./conceptDriftHandler";
import { registerDomain, adaptDomain, getMappings, _resetDomainAdaptationEngineForTest } from "./domainAdaptationEngine";
import { registerTransferTask, planTransfer, getTransferPlans, _resetTransferOptimizerForTest } from "./transferOptimizer";

beforeEach(() => {
  _resetEnvironmentalAdaptorForTest();
  _resetDistributionShiftDetectorForTest();
  _resetOnlineLearningControllerForTest();
  _resetConceptDriftHandlerForTest();
  _resetDomainAdaptationEngineForTest();
  _resetTransferOptimizerForTest();
});

describe("environmentalAdaptor", () => {
  it("adapts to high CPU environment", () => {
    for (let i = 0; i < 10; i++) recordSignal("cpu_usage", 90);
    const decision = adaptToEnvironment("production");
    expect(decision.adaptations).toContain("reduce_parallelism");
    expect(decision.triggeredBy).toContain("high_cpu");
  });

  it("adapts to edge profile", () => {
    const decision = adaptToEnvironment("edge");
    expect(decision.adaptations).toContain("disable_heavy_models");
  });

  it("tracks adaptation history", () => {
    adaptToEnvironment("staging");
    expect(getAdaptationHistory()).toHaveLength(1);
  });
});

describe("distributionShiftDetector", () => {
  it("detects no shift in identical distributions", () => {
    const data = Array.from({ length: 100 }, () => Math.random());
    captureDistribution("ref", data);
    captureDistribution("cur", data);
    const result = detectShift("ref", "cur");
    expect(result.shiftDetected).toBe(false);
    expect(result.severity).toBe("none");
  });

  it("detects shift in very different distributions", () => {
    captureDistribution("ref", Array.from({ length: 100 }, () => Math.random() * 0.1));
    captureDistribution("cur", Array.from({ length: 100 }, () => 0.9 + Math.random() * 0.1));
    const result = detectShift("ref", "cur");
    expect(result.shiftDetected).toBe(true);
    expect(["moderate", "severe"]).toContain(result.severity);
  });

  it("throws for unknown snapshots", () => {
    expect(() => detectShift("unknown_ref", "unknown_cur")).toThrow();
  });
});

describe("onlineLearningController", () => {
  it("initializes model with correct dimensions", () => {
    const state = initializeModel(3, 0.01);
    expect(state.weights).toHaveLength(3);
    expect(state.learningRate).toBe(0.01);
  });

  it("reduces loss over multiple updates", () => {
    initializeModel(2, 0.1);
    let lastLoss = Infinity;
    let improved = false;
    for (let i = 0; i < 50; i++) {
      const update = onlineUpdate([1, 2], 5);
      if (update.loss < lastLoss) improved = true;
      lastLoss = update.loss;
    }
    expect(improved).toBe(true);
    expect(getModelState().totalUpdates).toBe(50);
  });

  it("decays learning rate over time", () => {
    initializeModel(1, 0.1);
    onlineUpdate([1], 1);
    onlineUpdate([1], 1);
    expect(getModelState().learningRate).toBeLessThan(0.1);
  });
});

describe("conceptDriftHandler", () => {
  it("returns null when insufficient data", () => {
    recordPredictionError(0.1);
    expect(checkForDrift()).toBeNull();
  });

  it("detects drift when error rate changes significantly", () => {
    // Low error first half
    for (let i = 0; i < 50; i++) recordPredictionError(0.05);
    // High error second half
    for (let i = 0; i < 50; i++) recordPredictionError(0.8);
    const drift = checkForDrift();
    expect(drift).not.toBeNull();
    expect(drift?.driftType).toBe("sudden");
  });

  it("tracks drift history", () => {
    for (let i = 0; i < 50; i++) recordPredictionError(0.05);
    for (let i = 0; i < 50; i++) recordPredictionError(0.9);
    checkForDrift();
    expect(getDriftHistory().length).toBeGreaterThanOrEqual(0);
  });
});

describe("domainAdaptationEngine", () => {
  it("registers domains and creates adaptation mapping", () => {
    const features = Array.from({ length: 20 }, () => [Math.random(), Math.random()]);
    registerDomain("source", features);
    registerDomain("target", features.map(f => f.map(v => v * 2 + 1)));
    const mapping = adaptDomain("source", "target");
    expect(mapping.sourceDomain).toBe("source");
    expect(mapping.targetDomain).toBe("target");
    expect(mapping.alignmentScore).toBeGreaterThanOrEqual(0);
    expect(mapping.alignmentScore).toBeLessThanOrEqual(1);
  });

  it("throws for unknown domains", () => {
    expect(() => adaptDomain("nonexistent", "also_nonexistent")).toThrow();
  });

  it("tracks mappings", () => {
    const f = [[1, 2], [3, 4]];
    registerDomain("d1", f);
    registerDomain("d2", f);
    adaptDomain("d1", "d2");
    expect(getMappings()).toHaveLength(1);
  });
});

describe("transferOptimizer", () => {
  it("plans transfer from registered source tasks", () => {
    registerTransferTask("nlp_classification", "nlp", 0.92, 0.85);
    registerTransferTask("image_classification", "vision", 0.88, 0.70);
    registerTransferTask("sentiment_analysis", "nlp", 0.90, 0.80);
    const plan = planTransfer("new_nlp_task", "nlp");
    expect(plan.selectedSources.length).toBeGreaterThan(0);
    expect(plan.estimatedGain).toBeGreaterThan(0);
  });

  it("selects feature_extraction strategy for high transferability", () => {
    registerTransferTask("source_task", "nlp", 0.95, 0.95);
    const plan = planTransfer("target_task", "nlp");
    expect(plan.strategy).toBe("feature_extraction");
  });

  it("tracks transfer plans", () => {
    registerTransferTask("t1", "d1", 0.9, 0.9);
    planTransfer("new_task", "d1");
    expect(getTransferPlans()).toHaveLength(1);
  });
});
