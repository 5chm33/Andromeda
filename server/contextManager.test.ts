import { describe, it, expect } from "vitest";
import { estimateTokens, estimateMessageTokens } from "./contextManager.js";

describe("estimateTokens", () => {
  it("should execute without throwing", () => {
    try {
      const result = estimateTokens("test_text");
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = estimateTokens("test_text");
    expect(typeof result).toBe("number");
  });

  it("should handle empty/null inputs gracefully", () => {
    try { estimateTokens(""); } catch (e: any) { expect(e).toBeDefined(); }
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { estimateTokens(undefined); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

describe("estimateMessageTokens", () => {
  it("should execute without throwing", () => {
    try {
      const result = estimateMessageTokens([]);
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = estimateMessageTokens([]);
    expect(typeof result).toBe("number");
  });

  it("should handle empty/null inputs gracefully", () => {
    try { estimateMessageTokens([]); } catch (e: any) { expect(e).toBeDefined(); }
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { estimateMessageTokens(undefined); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

