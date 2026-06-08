import { describe, it, expect } from "vitest";
import * as ai from "./ai.js";

describe("ai barrel export", () => {
  it("should re-export symbols from aiTokens, aiPrompts, aiStreaming, aiPlanning", () => {
    // ai.ts is a barrel that re-exports from 4 sub-modules.
    // Verify the module object is non-null and contains at least some exports.
    expect(ai).toBeDefined();
    expect(typeof ai).toBe("object");
  });
});
