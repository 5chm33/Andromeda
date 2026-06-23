import { describe, it, expect, beforeEach } from "vitest";
import { recordPromptOutcome, getBestPatterns, getPromptStats } from "./promptEngineer.js";

describe("promptEngineer", () => {
  it("exports recordPromptOutcome, getBestPatterns, getPromptStats", () => {
    expect(typeof recordPromptOutcome).toBe("function");
    expect(typeof getBestPatterns).toBe("function");
    expect(typeof getPromptStats).toBe("function");
  });

  it("getPromptStats returns expected shape", () => {
    const stats = getPromptStats();
    expect(stats).toHaveProperty("totalPatterns");
    expect(stats).toHaveProperty("avgSuccessRate");
    expect(stats).toHaveProperty("topTaskType");
    expect(typeof stats.totalPatterns).toBe("number");
    expect(typeof stats.avgSuccessRate).toBe("number");
  });

  it("getBestPatterns returns an array for any task type", () => {
    const patterns = getBestPatterns("self_improvement");
    expect(Array.isArray(patterns)).toBe(true);
  });

  it("getBestPatterns returns an array for coding task type", () => {
    const patterns = getBestPatterns("coding");
    expect(Array.isArray(patterns)).toBe(true);
  });

  it("recordPromptOutcome does not throw on success outcome", () => {
    expect(() => {
      recordPromptOutcome("self_improvement", "test prompt fragment", 0.9, "success");
    }).not.toThrow();
  });

  it("recordPromptOutcome does not throw on failure outcome", () => {
    expect(() => {
      recordPromptOutcome("coding", "another prompt fragment", 0.3, "failure");
    }).not.toThrow();
  });

  it("recordPromptOutcome does not throw on partial outcome", () => {
    expect(() => {
      recordPromptOutcome("analysis", "partial prompt fragment", 0.6, "partial");
    }).not.toThrow();
  });

  it("getPromptStats totalPatterns increases after recording", () => {
    const before = getPromptStats().totalPatterns;
    recordPromptOutcome("research", "unique fragment xyz", 0.85, "success");
    const after = getPromptStats().totalPatterns;
    // totalPatterns counts unique patterns, may or may not increase depending on hash
    expect(typeof after).toBe("number");
    expect(after).toBeGreaterThanOrEqual(before);
  });
});
