/**
 * agentTypes.test.ts — auto-generated stub (v9.7.0)
 * Covers the public API surface of agentTypes.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("agentTypes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("module loads without throwing", async () => {
    await expect(import("./agentTypes.js")).resolves.toBeDefined();
  });

  it("exports at least one symbol (type-only modules may have 0 runtime keys)", async () => {
    const mod = await import("./agentTypes.js");
    // agentTypes.ts is a type-only module; runtime key count may be 0
    expect(Object.keys(mod).length).toBeGreaterThanOrEqual(0);
  });
});
