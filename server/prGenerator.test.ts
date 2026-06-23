import { describe, it, expect } from "vitest";
import { getPRGeneratorStatus, initPRGenerator } from "./prGenerator.js";

describe("prGenerator", () => {
  it("exports getPRGeneratorStatus and initPRGenerator", () => {
    expect(typeof getPRGeneratorStatus).toBe("function");
    expect(typeof initPRGenerator).toBe("function");
  });

  it("getPRGeneratorStatus returns expected shape", () => {
    const status = getPRGeneratorStatus();
    expect(status).toHaveProperty("config");
    expect(status).toHaveProperty("openPRs");
    expect(status).toHaveProperty("mergedPRs");
    expect(typeof status.openPRs).toBe("number");
    expect(typeof status.mergedPRs).toBe("number");
  });

  it("initPRGenerator does not throw", () => {
    expect(() => initPRGenerator()).not.toThrow();
  });

  it("getPRGeneratorStatus recentPRs is an array", () => {
    const status = getPRGeneratorStatus();
    expect(Array.isArray(status.recentPRs)).toBe(true);
  });

  it("getPRGeneratorStatus failedPRs is a number", () => {
    const status = getPRGeneratorStatus();
    expect(typeof status.failedPRs).toBe("number");
  });
});
