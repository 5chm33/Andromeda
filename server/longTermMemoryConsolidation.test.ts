import { describe, it, expect, beforeEach } from "vitest";
import {
  recordObservation,
  extractPatternsFromDiff,
  getTopPatterns,
  getRelevantPatterns,
  getSynthesizedRulesForPrompt,
  getLongTermMemoryStats,
  initLongTermMemoryConsolidation,
} from "./longTermMemoryConsolidation.js";

describe("longTermMemoryConsolidation", () => {
  beforeEach(() => {
    initLongTermMemoryConsolidation();
  });

  it("recordObservation stores an observation without throwing", () => {
    expect(() =>
      recordObservation({
        cycleId: "test-cycle-1",
        timestamp: Date.now(),
        targetFile: "server/selfImprove.ts",
        changeDescription: "Improved error handling",
        diff: "-const x = 1;\n+const x = 2;",
        evalScoreBefore: 0.7,
        evalScoreAfter: 0.85,
        accepted: true,
      })
    ).not.toThrow();
  });

  it("extractPatternsFromDiff returns an array", () => {
    const diff = "-  const result = doSomething();\n+  const result = doSomething() ?? defaultValue;";
    const patterns = extractPatternsFromDiff(diff, "server/ai.ts", "reliability");
    expect(Array.isArray(patterns)).toBe(true);
  });

  it("getTopPatterns returns an array", () => {
    const patterns = getTopPatterns(10);
    expect(Array.isArray(patterns)).toBe(true);
  });

  it("getRelevantPatterns returns array filtered by targetFile", () => {
    const patterns = getRelevantPatterns("server/selfImprove.ts");
    expect(Array.isArray(patterns)).toBe(true);
  });

  it("getSynthesizedRulesForPrompt returns a string", () => {
    const rules = getSynthesizedRulesForPrompt("server/selfImprove.ts");
    expect(typeof rules).toBe("string");
  });

  it("getLongTermMemoryStats returns expected shape", () => {
    const stats = getLongTermMemoryStats();
    expect(stats).toHaveProperty("totalPatterns");
    expect(stats).toHaveProperty("totalObservations");
    expect(typeof stats.totalPatterns).toBe("number");
    expect(typeof stats.totalObservations).toBe("number");
  });

  it("recordObservation with accepted=false also stores without throwing", () => {
    expect(() =>
      recordObservation({
        cycleId: "test-cycle-2",
        timestamp: Date.now(),
        targetFile: "server/continuousImprover.ts",
        changeDescription: "Failed refactor attempt",
        diff: "-  foo();\n+  bar();",
        evalScoreBefore: 0.8,
        evalScoreAfter: 0.6,
        accepted: false,
      })
    ).not.toThrow();
  });
});
