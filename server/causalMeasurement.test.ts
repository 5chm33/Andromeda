import { describe, it, expect } from "vitest";
import { evaluateFeaturePromotion, type FeatureMetrics } from "./causalMeasurement.js";

describe("causalMeasurement", () => {
  it("promotes features that improve resolved rate without severe regression", () => {
    const metrics: FeatureMetrics = {
      featureName: "test-feature",
      resolvedDelta: 0.05,
      applyReliabilityDelta: 0.01,
      costDeltaUSD: 0.10,
      latencyDeltaSec: 5,
      securityTestDelta: 0
    };
    expect(evaluateFeaturePromotion(metrics)).toBe(true);
  });

  it("rejects features that severely regress cost even with lift", () => {
    const metrics: FeatureMetrics = {
      featureName: "expensive-feature",
      resolvedDelta: 0.01,
      applyReliabilityDelta: 0,
      costDeltaUSD: 2.00, // Severe regression
      latencyDeltaSec: 5,
      securityTestDelta: 0
    };
    expect(evaluateFeaturePromotion(metrics)).toBe(false);
  });
});
