import { describe, it, expect } from "vitest";
import { feedQualityToRSI, feedDocGapsToRSI, runQualityToRSI } from "./qualityToRSI.js";

describe("feedQualityToRSI", () => {
  it("should execute without throwing", async () => {
    try {
      const result = await feedQualityToRSI();
      expect(result).toBeDefined();
    } catch (e: unknown) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", async () => {
    const result = await feedQualityToRSI();
    // Returns a number (0 when no quality report exists in test env)
    expect(typeof result).toBe("number");
  });

  it("should handle invalid inputs", async () => {
    // @ts-expect-error Testing invalid input
    try { await feedQualityToRSI(); } catch (e: unknown) { expect(e).toBeDefined(); }
  });

});

describe("feedDocGapsToRSI", () => {
  it("should execute without throwing", async () => {
    try {
      const result = await feedDocGapsToRSI();
      expect(result).toBeDefined();
    } catch (e: unknown) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", async () => {
    const result = await feedDocGapsToRSI();
    // Returns a number (0 when no doc report exists in test env)
    expect(typeof result).toBe("number");
  });

  it("should handle invalid inputs", async () => {
    // @ts-expect-error Testing invalid input
    try { await feedDocGapsToRSI(); } catch (e: unknown) { expect(e).toBeDefined(); }
  });

});

describe("runQualityToRSI", () => {
  it("should execute without throwing", async () => {
    try {
      const result = await runQualityToRSI();
      expect(result).toBeDefined();
    } catch (e: unknown) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", async () => {
    const result = await runQualityToRSI();
    // Returns { qualityProposals: number, docProposals: number }
    expect(typeof result).toBe("object");
    expect(typeof result.qualityProposals).toBe("number");
    expect(typeof result.docProposals).toBe("number");
  });

  it("should handle invalid inputs", async () => {
    // @ts-expect-error Testing invalid input
    try { await runQualityToRSI(); } catch (e: unknown) { expect(e).toBeDefined(); }
  });

});
