/**
 * mctsPlanningEngine.test.ts
 * Tests for the Monte Carlo Tree Search planning engine.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  MCTSEngine,
  planWithMCTS,
  comparePlans,
  type PlanState,
  type PlanStep,
  type MCTSResult,
} from "./mctsPlanningEngine.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStep(id: string, gain = 0.7, risk = 0.2): PlanStep {
  return {
    id,
    action: "modify_file",
    target: "server/test.ts",
    description: `Step ${id}`,
    estimatedRisk: risk,
    estimatedGain: gain,
  };
}

function makeRootState(goal = "Improve performance"): PlanState {
  return {
    goal,
    steps: [],
    completedSteps: [],
    context: {},
  };
}

// ── MCTSEngine ────────────────────────────────────────────────────────────────

describe("MCTSEngine", () => {
  let engine: MCTSEngine;

  beforeEach(() => {
    engine = new MCTSEngine({ maxDepth: 4, useLLMRollout: false });
  });

  it("returns a result with bestPlan and bestScore", async () => {
    const result = await engine.search(makeRootState(), 20);
    expect(result).toBeDefined();
    expect(result.bestPlan).toBeDefined();
    expect(Array.isArray(result.bestPlan)).toBe(true);
    expect(typeof result.bestScore).toBe("number");
  });

  it("bestScore is between 0 and 1", async () => {
    const result = await engine.search(makeRootState(), 30);
    expect(result.bestScore).toBeGreaterThanOrEqual(0);
    expect(result.bestScore).toBeLessThanOrEqual(1);
  });

  it("returns the correct number of iterations", async () => {
    const result = await engine.search(makeRootState(), 50);
    expect(result.iterations).toBe(50);
  });

  it("explores at least some nodes", async () => {
    const result = await engine.search(makeRootState(), 30);
    expect(result.exploredNodes).toBeGreaterThan(0);
  });

  it("confidence increases with more iterations", async () => {
    const low = await engine.search(makeRootState(), 10);
    engine.reset();
    const high = await engine.search(makeRootState(), 100);
    expect(high.confidence).toBeGreaterThanOrEqual(low.confidence);
  });

  it("returns alternative plans", async () => {
    const result = await engine.search(makeRootState(), 50);
    expect(Array.isArray(result.alternativePlans)).toBe(true);
  });

  it("handles empty goal gracefully", async () => {
    const result = await engine.search(makeRootState(""), 10);
    expect(result).toBeDefined();
    expect(result.bestScore).toBeGreaterThanOrEqual(0);
  });

  it("respects maxDepth — plan length does not exceed maxDepth", async () => {
    const result = await engine.search(makeRootState(), 100);
    expect(result.bestPlan.length).toBeLessThanOrEqual(4);
  });

  it("reset clears node count", async () => {
    await engine.search(makeRootState(), 20);
    engine.reset();
    const result = await engine.search(makeRootState(), 5);
    // After reset, node count starts fresh
    expect(result.exploredNodes).toBeGreaterThan(0);
    expect(result.exploredNodes).toBeLessThan(100);
  });

  it("plans that include test steps score higher than pure modify plans", async () => {
    // Run multiple searches and check that test-inclusive plans appear
    const results: MCTSResult[] = [];
    for (let i = 0; i < 5; i++) {
      engine.reset();
      results.push(await engine.search(makeRootState(), 50));
    }
    // At least one result should have a plan with run_tests action
    const hasTestPlan = results.some(r =>
      r.bestPlan.some(s => s.action === "run_tests")
    );
    expect(hasTestPlan).toBe(true);
  });
});

// ── planWithMCTS convenience function ────────────────────────────────────────

describe("planWithMCTS", () => {
  it("returns a valid MCTSResult", async () => {
    const result = await planWithMCTS("Reduce memory usage", {}, 30, false);
    expect(result).toBeDefined();
    expect(result.bestPlan).toBeDefined();
    expect(result.bestScore).toBeGreaterThanOrEqual(0);
  });

  it("accepts context object", async () => {
    const result = await planWithMCTS(
      "Optimize database queries",
      { currentScore: 0.7, targetScore: 0.9 },
      20,
      false
    );
    expect(result).toBeDefined();
  });

  it("works with 0 iterations gracefully", async () => {
    const result = await planWithMCTS("test goal", {}, 0, false);
    expect(result).toBeDefined();
    expect(result.iterations).toBe(0);
  });
});

// ── comparePlans ──────────────────────────────────────────────────────────────

describe("comparePlans", () => {
  it("returns true when planA has higher gain/risk ratio", () => {
    const planA: PlanStep[] = [makeStep("a1", 0.9, 0.1)];
    const planB: PlanStep[] = [makeStep("b1", 0.3, 0.8)];
    expect(comparePlans(planA, planB)).toBe(true);
  });

  it("returns false when planB has higher gain/risk ratio", () => {
    const planA: PlanStep[] = [makeStep("a1", 0.2, 0.9)];
    const planB: PlanStep[] = [makeStep("b1", 0.9, 0.1)];
    expect(comparePlans(planA, planB)).toBe(false);
  });

  it("handles empty plans", () => {
    expect(comparePlans([], [])).toBe(false);
    expect(comparePlans([makeStep("a")], [])).toBe(true);
    expect(comparePlans([], [makeStep("b")])).toBe(false);
  });

  it("handles equal plans", () => {
    const plan: PlanStep[] = [makeStep("x", 0.5, 0.5)];
    expect(comparePlans(plan, plan)).toBe(false);
  });

  it("correctly scores multi-step plans", () => {
    const planA: PlanStep[] = [
      makeStep("a1", 0.8, 0.2),
      makeStep("a2", 0.7, 0.1),
    ];
    const planB: PlanStep[] = [
      makeStep("b1", 0.4, 0.6),
      makeStep("b2", 0.3, 0.7),
    ];
    expect(comparePlans(planA, planB)).toBe(true);
  });
});
