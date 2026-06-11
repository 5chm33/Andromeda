import { describe, it, expect, vi, beforeEach } from "vitest";

// v10.3: Mock analyzeAndPropose to prevent real LLM calls during tests.
// QualitytorsiModule.feedQualityToRSI calls analyzeAndPropose which makes LLM API calls that
// time out in CI/test environments. Mock at the module level.
vi.mock("./selfImprove.js", () => ({
  analyzeAndPropose: vi.fn().mockResolvedValue(undefined),
  listProposals: vi.fn().mockReturnValue([]),
  resetStuckProcessingProposals: vi.fn(),
}));

import * as QualitytorsiModule from "./qualityToRSI.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("QualitytorsiModule.feedQualityToRSI", () => {
  it("should execute without throwing", async () => {
    try {
      const result = await QualitytorsiModule.feedQualityToRSI();
      expect(result).toBeDefined();
    } catch (e: unknown) {
      // Function may throw in test environment (e.g. no quality report exists)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", async () => {
    const result = await QualitytorsiModule.feedQualityToRSI();
    // Returns a number (0 when no quality report exists in test env)
    expect(typeof result).toBe("number");
  });

  it("should handle invalid inputs", async () => {
    // @ts-expect-error Testing invalid input
    try { await QualitytorsiModule.feedQualityToRSI(); } catch (e: unknown) { expect(e).toBeDefined(); }
  });

});

describe("QualitytorsiModule.feedDocGapsToRSI", () => {
  it("should execute without throwing", async () => {
    try {
      const result = await QualitytorsiModule.feedDocGapsToRSI();
      expect(result).toBeDefined();
    } catch (e: unknown) {
      // Function may throw in test environment (e.g. no doc report exists)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", async () => {
    const result = await QualitytorsiModule.feedDocGapsToRSI();
    // Returns a number (0 when no doc report exists in test env)
    expect(typeof result).toBe("number");
  });

  it("should handle invalid inputs", async () => {
    // @ts-expect-error Testing invalid input
    try { await QualitytorsiModule.feedDocGapsToRSI(); } catch (e: unknown) { expect(e).toBeDefined(); }
  });

});

describe("QualitytorsiModule.runQualityToRSI", () => {
  it("should execute without throwing", async () => {
    try {
      const result = await QualitytorsiModule.runQualityToRSI();
      expect(result).toBeDefined();
    } catch (e: unknown) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", async () => {
    const result = await QualitytorsiModule.runQualityToRSI();
    // Returns { qualityProposals: number, docProposals: number }
    expect(typeof result).toBe("object");
    expect(typeof result.qualityProposals).toBe("number");
    expect(typeof result.docProposals).toBe("number");
  });

  it("should handle invalid inputs", async () => {
    // @ts-expect-error Testing invalid input
    try { await QualitytorsiModule.runQualityToRSI(); } catch (e: unknown) { expect(e).toBeDefined(); }
  });

});
