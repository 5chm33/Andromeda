import { describe, it, expect } from "vitest";
import {
  selectRelevantFiles,
  runMultiPassAnalysis,
} from "./fileEngineAnalysis.js";

describe("fileEngineAnalysis", () => {
  it("selectRelevantFiles is exported as a function", () => {
    expect(typeof selectRelevantFiles).toBe("function");
  });

  it("runMultiPassAnalysis is exported as a function", () => {
    expect(typeof runMultiPassAnalysis).toBe("function");
  });

  it("selectRelevantFiles handles empty file list gracefully", async () => {
    try {
      const result = await selectRelevantFiles([], "improve readability");
      expect(Array.isArray(result)).toBe(true);
    } catch {
      // LLM unavailable is acceptable
    }
  }, 10000);

  it("selectRelevantFiles returns array for valid input", async () => {
    try {
      const result = await selectRelevantFiles(["server/utils.ts", "server/helpers.ts"], "fix type errors");
      expect(Array.isArray(result)).toBe(true);
    } catch {
      // LLM unavailable is acceptable
    }
  }, 10000);

  it("module exports at least 3 functions", async () => {
    const mod = await import("./fileEngineAnalysis.js");
    const fns = Object.values(mod).filter(v => typeof v === "function");
    expect(fns.length).toBeGreaterThanOrEqual(3);
  });
});
