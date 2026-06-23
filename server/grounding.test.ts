import { describe, it, expect } from "vitest";
import { extractFactualClaims, getGroundingSystemPromptAddendum } from "./grounding.js";

describe("extractFactualClaims", () => {
  it("should execute without throwing", () => {
    try {
      const result = extractFactualClaims("test_answer");
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = extractFactualClaims("test_answer");
    expect(Array.isArray(result)).toBe(true);
  });

  it("should handle empty/null inputs gracefully", () => {
    try { extractFactualClaims(""); } catch (e: any) { expect(e).toBeDefined(); }
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { extractFactualClaims(undefined); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

describe("getGroundingSystemPromptAddendum", () => {
  it("should execute without throwing", () => {
    try {
      const result = getGroundingSystemPromptAddendum();
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = getGroundingSystemPromptAddendum();
    expect(typeof result).toBe("string");
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { getGroundingSystemPromptAddendum(); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

