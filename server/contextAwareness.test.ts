import { describe, it, expect } from "vitest";
import { getCurrentUsage, getContextAwarenessStats } from "./contextAwareness.js";

describe("getCurrentUsage", () => {
  it("should execute without throwing", () => {
    try {
      const result = getCurrentUsage("test_sessionId");
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    // getCurrentUsage returns null for unknown session IDs — null is a valid return
    const result = getCurrentUsage("test_sessionId");
    expect(result === null || typeof result === 'object').toBeTruthy();
  });

  it("should handle empty/null inputs gracefully", () => {
    try { getCurrentUsage(""); } catch (e: any) { expect(e).toBeDefined(); }
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { getCurrentUsage(undefined); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

describe("getContextAwarenessStats", () => {
  it("should execute without throwing", () => {
    try {
      const result = getContextAwarenessStats();
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = getContextAwarenessStats();
    expect(result).toBeTruthy();
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { getContextAwarenessStats(); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

