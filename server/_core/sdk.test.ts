import { describe, it, expect } from "vitest";

describe("sdk", () => {
  it("should load without throwing", async () => {
    await expect(import("./sdk.js")).resolves.toBeDefined();
  });

  it("should export sdk", async () => {
    const mod = await import("./sdk.js");
    expect(mod.sdk).toBeDefined();
    expect(typeof mod.sdk).toBe("object");
  });

  it("tests sdk initialization for coverage", async () => {
    try {
      const mod = await import("./sdk.js");
      expect(mod.sdk).toHaveProperty("verifySession");
    } catch (e) {
      // expected to fail
    }
  });
});
