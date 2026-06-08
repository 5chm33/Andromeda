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

  it("exports at least one symbol", async () => {
    const mod = await import("./agentTypes.js");
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });
});
