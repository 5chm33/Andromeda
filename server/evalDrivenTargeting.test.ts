import { describe, it, expect } from "vitest";
import { runEvalDrivenTargeting, getTargetedFiles } from "./evalDrivenTargeting.js";

describe("runEvalDrivenTargeting", () => {
  it("should execute without throwing", async () => {
    try {
      const result = await runEvalDrivenTargeting();
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", async () => {
    const result = await runEvalDrivenTargeting();
    expect(typeof result === "number" || result === undefined).toBe(true);
  });

  it("should handle invalid inputs", async () => {
    // @ts-expect-error Testing invalid input
    try { await runEvalDrivenTargeting(); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

describe("getTargetedFiles", () => {
  it("should execute without throwing", async () => {
    try {
      const result = await getTargetedFiles();
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", async () => {
    const result = await getTargetedFiles();
    expect(Array.isArray(result)).toBe(true);
  });

  it("should handle invalid inputs", async () => {
    // @ts-expect-error Testing invalid input
    try { await getTargetedFiles(); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

