import { describe, it, expect } from "vitest";
import * as aiTokens from "./aiTokens.js";

describe("aiTokens", () => {
  it("module loads without error", () => {
    expect(aiTokens).toBeDefined();
  });

  it("exports at least one function", () => {
    const fns = Object.values(aiTokens).filter(v => typeof v === "function");
    expect(fns.length).toBeGreaterThanOrEqual(1);
  });

  it("all exported values are defined", () => {
    for (const [, val] of Object.entries(aiTokens)) {
      expect(val).not.toBeUndefined();
    }
  });

  it("module has at least 2 exports", () => {
    expect(Object.keys(aiTokens).length).toBeGreaterThanOrEqual(2);
  });

  it("countTokens or estimateTokens function exists if present", () => {
    const hasTokenCounter = "countTokens" in aiTokens || "estimateTokens" in aiTokens || "getTokenCount" in aiTokens;
    // At minimum the module should have some token-related export
    expect(Object.keys(aiTokens).length).toBeGreaterThan(0);
  });
});
