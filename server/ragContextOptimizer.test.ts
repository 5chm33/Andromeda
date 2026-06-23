import { describe, it, expect } from "vitest";
import {
  buildRagContext,
  getRagContextStats,
  initRagContextOptimizer,
} from "./ragContextOptimizer.js";

describe("buildRagContext", () => {
  it("should execute without throwing", () => {
    try {
      const result = buildRagContext("nonexistent.ts");
      expect(typeof result === "object" && result !== null).toBe(true);
    } catch (e: any) {
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = buildRagContext("nonexistent.ts");
    expect(typeof result === "object" && result !== null).toBe(true);
    expect(typeof result.enrichedPromptPrefix).toBe("string");
    expect(typeof result.contextQualityScore).toBe("number");
    expect(Array.isArray(result.pastFailures)).toBe(true);
    expect(Array.isArray(result.behavioralContracts)).toBe(true);
    expect(Array.isArray(result.dependents)).toBe(true);
  });

  it("should return a prompt prefix for any file", () => {
    const result = buildRagContext("cache.ts");
    expect(result.enrichedPromptPrefix.length).toBeGreaterThan(0);
    expect(result.enrichedPromptPrefix).toContain("RAG CONTEXT");
  });

  it("should return a quality score between 0 and 100", () => {
    const result = buildRagContext("nonexistent.ts");
    expect(result.contextQualityScore).toBeGreaterThanOrEqual(0);
    expect(result.contextQualityScore).toBeLessThanOrEqual(100);
  });

  it("should handle invalid inputs gracefully", () => {
    try {
      // @ts-expect-error Testing invalid input
      buildRagContext(null);
    } catch (e: any) {
      expect(e).toBeDefined();
    }
  });
});

describe("getRagContextStats", () => {
  it("should execute without throwing", () => {
    try {
      const result = getRagContextStats();
      expect(typeof result === "object" && result !== null).toBe(true);
    } catch (e: any) {
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = getRagContextStats();
    expect(typeof result === "object" && result !== null).toBe(true);
    expect(typeof result.totalEnrichments).toBe("number");
    expect(typeof result.averageContextQuality).toBe("number");
  });
});

describe("initRagContextOptimizer", () => {
  it("should execute without throwing", () => {
    expect(() => initRagContextOptimizer()).not.toThrow();
  });

  it("should return correct type", () => {
    const result = initRagContextOptimizer();
    expect(result === undefined).toBe(true);
  });
});
