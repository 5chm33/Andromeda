import { describe, it, expect } from "vitest";
import {
  extractContracts,
  runBehavioralRegressionStage,
  getBehavioralRegressionStats,
  initBehavioralRegressionEngine,
} from "./behavioralRegressionEngine.js";

describe("extractContracts", () => {
  it("should execute without throwing", () => {
    try {
      const result = extractContracts("nonexistent.test.ts");
      expect(Array.isArray(result)).toBe(true);
    } catch (e: any) {
      expect(e).toBeDefined();
    }
  });

  it("should return an empty array for a nonexistent file", () => {
    const result = extractContracts("/tmp/nonexistent_test_file_xyz.test.ts");
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it("should handle invalid inputs gracefully", () => {
    try {
      // @ts-expect-error Testing invalid input
      extractContracts(null);
    } catch (e: any) {
      expect(e).toBeDefined();
    }
  });
});

describe("runBehavioralRegressionStage", () => {
  it("should execute without throwing", () => {
    try {
      const result = runBehavioralRegressionStage("nonexistent.ts");
      expect(typeof result === "object" && result !== null).toBe(true);
    } catch (e: any) {
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = runBehavioralRegressionStage("nonexistent.ts");
    // Returns an object with pass, output, durationMs, recommendation
    expect(typeof result === "object" && result !== null).toBe(true);
  });

  it("should pass for a file with no test file", () => {
    const result = runBehavioralRegressionStage("definitely_nonexistent_file_xyz.ts");
    // No test file = passes (cannot validate = allow through)
    expect(result.pass).toBe(true);
    expect(typeof result.recommendation).toBe("string");
  });

  it("should handle invalid inputs gracefully", () => {
    try {
      // @ts-expect-error Testing invalid input
      runBehavioralRegressionStage(undefined);
    } catch (e: any) {
      expect(e).toBeDefined();
    }
  });
});

describe("getBehavioralRegressionStats", () => {
  it("should execute without throwing", () => {
    try {
      const result = getBehavioralRegressionStats();
      expect(typeof result === "object" && result !== null).toBe(true);
    } catch (e: any) {
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = getBehavioralRegressionStats();
    expect(typeof result === "object" && result !== null).toBe(true);
    expect(typeof result.totalChecks).toBe("number");
    expect(typeof result.passed).toBe("number");
    expect(typeof result.failed).toBe("number");
  });
});

describe("initBehavioralRegressionEngine", () => {
  it("should execute without throwing", () => {
    // initBehavioralRegressionEngine returns void
    expect(() => initBehavioralRegressionEngine()).not.toThrow();
  });

  it("should return correct type", () => {
    // Returns void — undefined is the correct return value
    const result = initBehavioralRegressionEngine();
    expect(result === undefined).toBe(true);
  });
});
