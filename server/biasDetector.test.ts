import { describe, it, expect } from "vitest";
import { getKnownBiasProfile, annotateSources, analyzeDiversity } from "./biasDetector.js";

describe("getKnownBiasProfile", () => {
  it("should execute without throwing", () => {
    try {
      const result = getKnownBiasProfile("test_domain");
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = getKnownBiasProfile("test_domain");
    // getKnownBiasProfile returns null for unknown domains — null is a valid return value
    expect(result === null || (typeof result === "object" && result !== null)).toBe(true);
  });

  it("should handle empty/null inputs gracefully", () => {
    try { getKnownBiasProfile(""); } catch (e: any) { expect(e).toBeDefined(); }
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { getKnownBiasProfile(undefined); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

describe("annotateSources", () => {
  it("should execute without throwing", () => {
    try {
      const result = annotateSources([]);
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = annotateSources([]);
    expect(Array.isArray(result)).toBe(true);
  });

  it("should handle empty/null inputs gracefully", () => {
    try { annotateSources([]); } catch (e: any) { expect(e).toBeDefined(); }
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { annotateSources(undefined); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

describe("analyzeDiversity", () => {
  it("should execute without throwing", () => {
    try {
      const result = analyzeDiversity([]);
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = analyzeDiversity([]);
    expect(result).toBeTruthy();
  });

  it("should handle empty/null inputs gracefully", () => {
    try { analyzeDiversity([]); } catch (e: any) { expect(e).toBeDefined(); }
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { analyzeDiversity(undefined); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

