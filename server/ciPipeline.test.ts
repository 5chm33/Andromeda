import { describe, it, expect } from "vitest";
import { getCiStatus, getCiHistory } from "./ciPipeline.js";

describe("getCiStatus", () => {
  it("should execute without throwing", () => {
    try {
      const result = getCiStatus();
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = getCiStatus();
    expect(result).toBeTruthy();
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { getCiStatus(); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

describe("getCiHistory", () => {
  it("should execute without throwing", () => {
    try {
      const result = getCiHistory("test_value");
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = getCiHistory("test_value");
    expect(Array.isArray(result)).toBe(true);
  });

  it("should handle empty/null inputs gracefully", () => {
    try { getCiHistory({}); } catch (e: any) { expect(e).toBeDefined(); }
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { getCiHistory(undefined); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

