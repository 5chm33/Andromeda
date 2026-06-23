/**
 * evalGoalDiscovery.test.ts — Andromeda v11.16.0 Audit 8
 * Real function-level tests for evalGoalDiscovery.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  discoverGoalsFromEval, getDiscoveryHistory, getRecentDiscoveries,
} from "./evalGoalDiscovery.js";

// Mock LLM to avoid network calls
vi.mock("./_core/llm.js", () => ({
  invokeLLM: vi.fn().mockResolvedValue(
    JSON.stringify([
      { title: "Improve accuracy", description: "Boost eval accuracy", priority: "high", estimatedImpact: 0.8 },
    ])
  ),
}));

describe("evalGoalDiscovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("module loads without throwing", async () => {
    await expect(import("./evalGoalDiscovery.js")).resolves.toBeDefined();
  });

  it("exports discoverGoalsFromEval, getDiscoveryHistory, getRecentDiscoveries", async () => {
    const mod = await import("./evalGoalDiscovery.js");
    expect(typeof mod.discoverGoalsFromEval).toBe("function");
    expect(typeof mod.getDiscoveryHistory).toBe("function");
    expect(typeof mod.getRecentDiscoveries).toBe("function");
  });

  it("getDiscoveryHistory returns an object", () => {
    const history = getDiscoveryHistory();
    expect(history).toBeDefined();
    expect(typeof history).toBe("object");
  });

  it("getRecentDiscoveries returns an array", () => {
    const recent = getRecentDiscoveries();
    expect(Array.isArray(recent)).toBe(true);
  });

  it("getRecentDiscoveries respects limit parameter", () => {
    const recent = getRecentDiscoveries(5);
    expect(Array.isArray(recent)).toBe(true);
    expect(recent.length).toBeLessThanOrEqual(5);
  });

  it("discoverGoalsFromEval returns an array of goals", async () => {
    const evalRun = {
      id: "eval-run-1",
      timestamp: Date.now(),
      scores: { accuracy: 0.75, latency: 0.9 },
      baseline: { accuracy: 0.85, latency: 0.88 },
    };
    const result = await discoverGoalsFromEval(evalRun as any);
    expect(Array.isArray(result)).toBe(true);
  });
});
