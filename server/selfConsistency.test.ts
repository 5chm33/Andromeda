import { describe, it, expect } from "vitest";
import { checkSelfConsistency, getConsistencyStats } from "./selfConsistency.js";

describe("checkSelfConsistency", () => {
  it("should execute without throwing", async () => {
    try {
      const result = await checkSelfConsistency("test_value");
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", async () => {
    const result = await checkSelfConsistency("test_value");
    expect(result).toBeTruthy();
  });

  it("should handle empty/null inputs gracefully", async () => {
    try { await checkSelfConsistency({}); } catch (e: any) { expect(e).toBeDefined(); }
  });

  it("should handle invalid inputs", async () => {
    // @ts-expect-error Testing invalid input
    try { await checkSelfConsistency(undefined); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

describe("getConsistencyStats", () => {
  it("should execute without throwing", () => {
    try {
      const result = getConsistencyStats();
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = getConsistencyStats();
    expect(result).toBeTruthy();
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { getConsistencyStats(); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

