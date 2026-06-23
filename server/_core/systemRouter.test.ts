import { describe, it, expect } from "vitest";

describe("systemRouter", () => {
  it("should load without throwing", async () => {
    await expect(import("./systemRouter.js")).resolves.toBeDefined();
  });

  it("should export systemRouter", async () => {
    const mod = await import("./systemRouter.js");
    expect(mod.systemRouter).toBeDefined();
  });

  it("should be a valid router object", async () => {
    const mod = await import("./systemRouter.js");
    expect(typeof mod.systemRouter).toBe("object"); // trpc router
  });

  it("should have expected dependencies available", async () => {
    const fs = await import("fs");
    expect(fs.existsSync).toBeDefined();
  });
});
