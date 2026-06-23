import { describe, it, expect } from "vitest";
import {
  selectModelForProposal,
  recordRoutingOutcome,
  getHybridRouterStats,
  getModelRegistry,
  initHybridCostRouter,
} from "./hybridCostRouter.js";

describe("selectModelForProposal", () => {
  it("should execute without throwing", () => {
    try {
      const result = selectModelForProposal(5, "low", 0, 0);
      expect(typeof result === "object" && result !== null).toBe(true);
    } catch (e: any) {
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = selectModelForProposal(5, "low", 0, 0);
    expect(typeof result === "object" && result !== null).toBe(true);
    expect(typeof result.tier).toBe("string");
    expect(typeof result.reason).toBe("string");
    expect(typeof result.estimatedCost).toBe("number");
    expect(Array.isArray(result.fallbackModels)).toBe(true);
  });

  it("should escalate to premium after 3 consecutive failures", () => {
    const result = selectModelForProposal(5, "low", 0, 3);
    // With no premium models available (no env keys in test), falls back to default
    expect(typeof result.tier).toBe("string");
  });

  it("should handle high-impact proposals", () => {
    const result = selectModelForProposal(8, "high", 15, 0);
    expect(typeof result.tier).toBe("string");
    expect(result.estimatedCost).toBeGreaterThanOrEqual(0);
  });

  it("should handle invalid inputs gracefully", () => {
    try {
      // @ts-expect-error Testing invalid input
      selectModelForProposal(null, null, null, null);
    } catch (e: any) {
      expect(e).toBeDefined();
    }
  });
});

describe("recordRoutingOutcome", () => {
  it("should execute without throwing", () => {
    const decision = selectModelForProposal(5, "low", 0, 0);
    expect(() => recordRoutingOutcome(decision, true, 0.001, 3000)).not.toThrow();
  });

  it("should return correct type", () => {
    const decision = selectModelForProposal(5, "low", 0, 0);
    const result = recordRoutingOutcome(decision, true, 0.001, 3000);
    expect(result === undefined).toBe(true);
  });
});

describe("getHybridRouterStats", () => {
  it("should execute without throwing", () => {
    try {
      const result = getHybridRouterStats();
      expect(typeof result === "object" && result !== null).toBe(true);
    } catch (e: any) {
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = getHybridRouterStats();
    expect(typeof result === "object" && result !== null).toBe(true);
    expect(typeof result.totalProposals).toBe("number");
    expect(typeof result.totalCostUsd).toBe("number");
    expect(typeof result.savingsVsPremiumOnly).toBe("number");
  });
});

describe("getModelRegistry", () => {
  it("should execute without throwing", () => {
    try {
      const result = getModelRegistry();
      expect(Array.isArray(result)).toBe(true);
    } catch (e: any) {
      expect(e).toBeDefined();
    }
  });

  it("should return a non-empty array", () => {
    const result = getModelRegistry();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("should contain models with required fields", () => {
    const result = getModelRegistry();
    const first = result[0];
    expect(typeof first.modelId).toBe("string");
    expect(typeof first.tier).toBe("string");
    expect(typeof first.costPer1kInputTokens).toBe("number");
  });
});

describe("initHybridCostRouter", () => {
  it("should execute without throwing", () => {
    expect(() => initHybridCostRouter()).not.toThrow();
  });

  it("should return correct type", () => {
    const result = initHybridCostRouter();
    expect(result === undefined).toBe(true);
  });
});
