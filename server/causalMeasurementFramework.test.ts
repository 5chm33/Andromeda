import { describe, it, expect, beforeEach } from "vitest";
import {
  computeDelta,
  recordAblation,
  getRecords,
  getLatestRecord,
  isEligibleForPromotion,
  summarizeAblations,
  _resetCausalMeasurementForTest,
  type AblationMetrics,
} from "./causalMeasurementFramework.js";

const makeMetrics = (overrides: Partial<AblationMetrics> = {}): AblationMetrics => ({
  resolvedRate: 0.20,
  applyRate: 0.85,
  avgCostUsd: 0.12,
  avgLatencyMs: 45000,
  instanceCount: 100,
  runId: "run-baseline",
  timestamp: Date.now(),
  featureName: "test-feature",
  baselineRunId: "run-baseline",
  ...overrides,
});

describe("causalMeasurementFramework", () => {
  beforeEach(() => _resetCausalMeasurementForTest());

  it("detects lift when resolved rate improves by >= 1pp", () => {
    const baseline = makeMetrics({ resolvedRate: 0.20, runId: "b1" });
    const treatment = makeMetrics({ resolvedRate: 0.22, runId: "t1" });
    const delta = computeDelta(baseline, treatment);
    expect(delta.liftDetected).toBe(true);
    expect(delta.regressionDetected).toBe(false);
    expect(delta.eligible).toBe(true);
  });

  it("does not detect lift when improvement is below threshold", () => {
    const baseline = makeMetrics({ resolvedRate: 0.20, runId: "b2" });
    const treatment = makeMetrics({ resolvedRate: 0.205, runId: "t2" });
    const delta = computeDelta(baseline, treatment);
    expect(delta.liftDetected).toBe(false);
    expect(delta.eligible).toBe(false);
  });

  it("detects cost regression when cost increases by > 15%", () => {
    const baseline = makeMetrics({ resolvedRate: 0.22, avgCostUsd: 0.10, runId: "b3" });
    const treatment = makeMetrics({ resolvedRate: 0.24, avgCostUsd: 0.12, runId: "t3" });
    const delta = computeDelta(baseline, treatment);
    expect(delta.liftDetected).toBe(true);
    expect(delta.regressionDetected).toBe(true);
    expect(delta.eligible).toBe(false);
  });

  it("records ablation and retrieves it", () => {
    const baseline = makeMetrics({ runId: "b4" });
    const treatment = makeMetrics({ resolvedRate: 0.22, runId: "t4", featureName: "my-feature" });
    const record = recordAblation(baseline, treatment);
    expect(record.featureName).toBe("my-feature");
    expect(getRecords().length).toBe(1);
    expect(getLatestRecord("my-feature")).not.toBeNull();
  });

  it("isEligibleForPromotion returns false when no record exists", () => {
    expect(isEligibleForPromotion("nonexistent-feature")).toBe(false);
  });

  it("isEligibleForPromotion returns true for an eligible feature", () => {
    const baseline = makeMetrics({ runId: "b5" });
    const treatment = makeMetrics({ resolvedRate: 0.22, runId: "t5", featureName: "good-feature" });
    recordAblation(baseline, treatment);
    expect(isEligibleForPromotion("good-feature")).toBe(true);
  });

  it("summarizeAblations returns a non-empty string after recording", () => {
    const baseline = makeMetrics({ runId: "b6" });
    const treatment = makeMetrics({ resolvedRate: 0.22, runId: "t6" });
    recordAblation(baseline, treatment);
    const summary = summarizeAblations();
    expect(typeof summary).toBe("string");
    expect(summary.length).toBeGreaterThan(0);
    expect(summary).toContain("test-feature");
  });
});
