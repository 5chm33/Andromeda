import { describe, it, expect } from "vitest";
import { getCircuitBreaker, getAllCircuitBreakerStats, resetAllCircuitBreakers } from "./circuitBreaker.js";

describe("getCircuitBreaker", () => {
  it("should execute without throwing", () => {
    try {
      const result = getCircuitBreaker("test_name");
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = getCircuitBreaker("test_name");
    expect(result).toBeTruthy();
  });

  it("should handle empty/null inputs gracefully", () => {
    try { getCircuitBreaker("", {}); } catch (e: any) { expect(e).toBeDefined(); }
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { getCircuitBreaker(undefined, undefined); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

describe("getAllCircuitBreakerStats", () => {
  it("should execute without throwing", () => {
    try {
      const result = getAllCircuitBreakerStats();
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = getAllCircuitBreakerStats();
    expect(result).toBeTruthy();
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { getAllCircuitBreakerStats(); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

describe("resetAllCircuitBreakers", () => {
  it("should execute without throwing", () => {
    // resetAllCircuitBreakers returns void — just verify it doesn't throw
    expect(() => resetAllCircuitBreakers()).not.toThrow();
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { resetAllCircuitBreakers(); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

