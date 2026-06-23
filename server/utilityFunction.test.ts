/**
 * utilityFunction.test.ts — Tests for Phase 14: Unified Utility Function
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  compute,
  computeDelta,
  explain,
  calibrate,
  recordRSIOutcome,
  createStateSnapshot,
  getWeights,
  setWeights,
  resetWeights,
  getUtilityHistory,
  getUtilityStats,
  type SystemState,
  type UtilityWeights,
  type RSICycleOutcome,
} from "./utilityFunction.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<SystemState> = {}): SystemState {
  return {
    testPassRate: 1.0,
    benchmarkDelta: 0.0,
    avgLatencyMs: 1500,
    tokenOverheadRatio: 2.0,
    safetyScore: 0.9,
    newCapabilities: 0,
    regressions: 0,
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeOutcome(overrides: Partial<RSICycleOutcome> = {}): RSICycleOutcome {
  return {
    cycleId: `cycle-${Date.now()}`,
    proposalId: `proposal-${Date.now()}`,
    stateBefore: makeState(),
    stateAfter: makeState({ testPassRate: 1.0, benchmarkDelta: 0.1 }),
    utilityDelta: 0.02,
    accepted: true,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ─── compute() Tests ──────────────────────────────────────────────────────────

describe("compute", () => {
  it("returns a score between 0 and 1", () => {
    const score = compute(makeState());
    expect(score.total).toBeGreaterThanOrEqual(0);
    expect(score.total).toBeLessThanOrEqual(1);
  });

  it("returns all component scores between 0 and 1", () => {
    const score = compute(makeState());
    for (const [, v] of Object.entries(score.components)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("perfect state scores near 1.0", () => {
    const score = compute(makeState({
      testPassRate: 1.0,
      benchmarkDelta: 1.0,
      avgLatencyMs: 0,
      tokenOverheadRatio: 1.0,
      safetyScore: 1.0,
      newCapabilities: 10,
      regressions: 0,
    }));
    expect(score.total).toBeGreaterThan(0.8);
  });

  it("worst state scores near 0.0", () => {
    const score = compute(makeState({
      testPassRate: 0.0,
      benchmarkDelta: -1.0,
      avgLatencyMs: 10000,
      tokenOverheadRatio: 10.0,
      safetyScore: 0.0,
      newCapabilities: 0,
      regressions: 10,
    }));
    expect(score.total).toBeLessThan(0.3);
  });

  it("higher test pass rate increases score", () => {
    const low = compute(makeState({ testPassRate: 0.5 }));
    const high = compute(makeState({ testPassRate: 1.0 }));
    expect(high.total).toBeGreaterThan(low.total);
  });

  it("lower latency increases score", () => {
    const slow = compute(makeState({ avgLatencyMs: 8000 }));
    const fast = compute(makeState({ avgLatencyMs: 500 }));
    expect(fast.total).toBeGreaterThan(slow.total);
  });

  it("regressions decrease score", () => {
    const clean = compute(makeState({ regressions: 0 }));
    const regressed = compute(makeState({ regressions: 3 }));
    expect(clean.total).toBeGreaterThan(regressed.total);
  });

  it("returns weights in the score", () => {
    const score = compute(makeState());
    expect(score.weights).toBeDefined();
    const weightSum = Object.values(score.weights).reduce((a, b) => a + b, 0);
    expect(weightSum).toBeCloseTo(1.0, 2);
  });

  it("accepts custom weight overrides", () => {
    const defaultScore = compute(makeState({ testPassRate: 0.5 }));
    const highTestWeight = compute(makeState({ testPassRate: 0.5 }), { testPassRate: 0.9 });
    // Higher weight on a low component should lower the score
    expect(highTestWeight.total).toBeLessThan(defaultScore.total);
  });

  it("returns explanation array", () => {
    const score = compute(makeState({ testPassRate: 0.5 }));
    expect(Array.isArray(score.explanation)).toBe(true);
    expect(score.explanation.length).toBeGreaterThan(0);
  });

  it("includes timestamp", () => {
    const score = compute(makeState());
    expect(score.timestamp).toBeGreaterThan(0);
  });
});

// ─── computeDelta() Tests ─────────────────────────────────────────────────────

describe("computeDelta", () => {
  it("returns positive delta when after state is better", () => {
    const before = makeState({ testPassRate: 0.8, benchmarkDelta: 0.0 });
    const after = makeState({ testPassRate: 1.0, benchmarkDelta: 0.2 });
    const delta = computeDelta(before, after);
    expect(delta.delta).toBeGreaterThan(0);
  });

  it("returns negative delta when after state is worse", () => {
    const before = makeState({ testPassRate: 1.0, safetyScore: 1.0 });
    const after = makeState({ testPassRate: 0.5, safetyScore: 0.3, regressions: 3 });
    const delta = computeDelta(before, after);
    expect(delta.delta).toBeLessThan(0);
  });

  it("meetsThreshold is true when delta >= minDelta", () => {
    const before = makeState({ testPassRate: 0.8 });
    const after = makeState({ testPassRate: 1.0 });
    const delta = computeDelta(before, after, 0.0);
    expect(delta.meetsThreshold).toBe(true);
  });

  it("meetsThreshold is false when delta < minDelta", () => {
    const before = makeState({ testPassRate: 1.0 });
    const after = makeState({ testPassRate: 1.0 }); // No change
    const delta = computeDelta(before, after, 0.1); // Require 10% improvement
    expect(delta.meetsThreshold).toBe(false);
  });

  it("returns before and after scores", () => {
    const before = makeState();
    const after = makeState({ testPassRate: 0.9 });
    const delta = computeDelta(before, after);
    expect(delta.before).toBeDefined();
    expect(delta.after).toBeDefined();
    expect(delta.before.total).toBeGreaterThanOrEqual(0);
    expect(delta.after.total).toBeGreaterThanOrEqual(0);
  });

  it("explanation contains APPROVED for positive delta", () => {
    const before = makeState({ testPassRate: 0.7 });
    const after = makeState({ testPassRate: 1.0 });
    const delta = computeDelta(before, after, 0.0);
    expect(delta.explanation).toContain("APPROVED");
  });

  it("explanation contains REJECTED for insufficient delta", () => {
    const before = makeState({ testPassRate: 1.0 });
    const after = makeState({ testPassRate: 1.0 });
    const delta = computeDelta(before, after, 0.5);
    expect(delta.explanation).toContain("REJECTED");
  });
});

// ─── explain() Tests ──────────────────────────────────────────────────────────

describe("explain", () => {
  it("returns a multi-line string", () => {
    const score = compute(makeState());
    const text = explain(score);
    expect(typeof text).toBe("string");
    expect(text.split("\n").length).toBeGreaterThan(5);
  });

  it("includes all utility components", () => {
    const score = compute(makeState());
    const text = explain(score);
    expect(text).toContain("Test Pass Rate");
    expect(text).toContain("Benchmark Delta");
    expect(text).toContain("Latency Score");
    expect(text).toContain("Safety Score");
    expect(text).toContain("Stability Score");
  });

  it("includes the total score", () => {
    const score = compute(makeState());
    const text = explain(score);
    expect(text).toContain("Utility Score:");
  });
});

// ─── createStateSnapshot() Tests ─────────────────────────────────────────────

describe("createStateSnapshot", () => {
  it("returns a valid SystemState with defaults", () => {
    const state = createStateSnapshot();
    expect(state.testPassRate).toBe(1.0);
    expect(state.safetyScore).toBe(0.85);
    expect(state.timestamp).toBeGreaterThan(0);
  });

  it("applies overrides correctly", () => {
    const state = createStateSnapshot({ testPassRate: 0.75, regressions: 2 });
    expect(state.testPassRate).toBe(0.75);
    expect(state.regressions).toBe(2);
    expect(state.safetyScore).toBe(0.85); // Default preserved
  });
});

// ─── Weight Management Tests ──────────────────────────────────────────────────

describe("weight management", () => {
  afterEach(() => {
    resetWeights();
  });

  it("getWeights returns weights that sum to 1.0", () => {
    const weights = getWeights();
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 2);
  });

  it("setWeights updates weights and normalizes them", () => {
    setWeights({ testPassRate: 0.9 });
    const weights = getWeights();
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 2);
    // testPassRate should be the largest weight
    expect(weights.testPassRate).toBeGreaterThan(weights.benchmarkDelta);
  });

  it("resetWeights restores defaults", () => {
    setWeights({ testPassRate: 0.9 });
    resetWeights();
    const weights = getWeights();
    expect(weights.testPassRate).toBeCloseTo(0.30, 1);
  });
});

// ─── calibrate() Tests ────────────────────────────────────────────────────────

describe("calibrate", () => {
  it("returns current weights when not enough history", () => {
    const weights = calibrate([]);
    expect(weights).toBeDefined();
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 2);
  });

  it("returns weights that sum to 1.0 after calibration", () => {
    const history: RSICycleOutcome[] = Array.from({ length: 10 }, (_, i) =>
      makeOutcome({
        cycleId: `cycle-${i}`,
        proposalId: `proposal-${i}`,
        utilityDelta: i % 2 === 0 ? 0.05 : -0.02,
        accepted: i % 2 === 0,
      })
    );
    const weights = calibrate(history);
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 2);
  });

  it("all calibrated weights are positive", () => {
    const history: RSICycleOutcome[] = Array.from({ length: 8 }, (_, i) =>
      makeOutcome({ cycleId: `c-${i}`, proposalId: `p-${i}`, accepted: true })
    );
    const weights = calibrate(history);
    for (const [, v] of Object.entries(weights)) {
      expect(v).toBeGreaterThan(0);
    }
  });
});

// ─── getUtilityStats() Tests ──────────────────────────────────────────────────

describe("getUtilityStats", () => {
  it("returns stats with correct shape", () => {
    const stats = getUtilityStats();
    expect(stats).toHaveProperty("totalCycles");
    expect(stats).toHaveProperty("acceptedCycles");
    expect(stats).toHaveProperty("avgUtilityDelta");
    expect(stats).toHaveProperty("currentWeights");
    expect(typeof stats.totalCycles).toBe("number");
    expect(typeof stats.avgUtilityDelta).toBe("number");
  });

  it("currentWeights sum to 1.0", () => {
    const stats = getUtilityStats();
    const sum = Object.values(stats.currentWeights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 2);
  });
});

// ─── getUtilityHistory() Tests ────────────────────────────────────────────────

describe("getUtilityHistory", () => {
  it("returns an array", () => {
    const history = getUtilityHistory();
    expect(Array.isArray(history)).toBe(true);
  });
});
