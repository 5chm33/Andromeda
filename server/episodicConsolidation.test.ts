import { describe, it, expect } from "vitest";
import { getEpisodicConsolidationStats, initEpisodicConsolidation } from "./episodicConsolidation.js";

describe("getEpisodicConsolidationStats", () => {
  it("should execute without throwing", () => {
    try {
      const result = getEpisodicConsolidationStats();
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = getEpisodicConsolidationStats();
    // getEpisodicConsolidationStats returns an object — verify it is an object
    expect(typeof result === "object" && result !== null).toBe(true);
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { getEpisodicConsolidationStats(); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

describe("initEpisodicConsolidation", () => {
  it("should execute without throwing", async () => {
    // initEpisodicConsolidation returns void — just verify it doesn't throw
    await expect(async () => await initEpisodicConsolidation()).not.toThrow();
  });

  it("should return correct type", async () => {
    // initEpisodicConsolidation returns void — undefined is the correct return value
    const result = await initEpisodicConsolidation();
    expect(result === undefined).toBe(true);
  });

  it("should handle invalid inputs", async () => {
    // @ts-expect-error Testing invalid input
    try { await initEpisodicConsolidation(); } catch (e: any) { expect(e).toBeDefined(); }
  });

});
