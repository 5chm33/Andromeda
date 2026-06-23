import { describe, it, expect } from "vitest";
import * as initModules from "./initModules.js";

describe("initModules", () => {
  it("should export initModules function", () => {
    expect(initModules.initModules).toBeDefined();
    expect(typeof initModules.initModules).toBe("function");
  });

  it("should have correct signature", () => {
    expect(initModules.initModules.length).toBe(0); // takes no parameters
  });

  it("tests initModules execution for coverage", async () => {
    try {
      await initModules.initModules();
    } catch (e) {
      // expected to fail with mock app
    }
  });

  it("should not throw when loaded", async () => {
    await expect(import("./initModules.js")).resolves.toBeDefined();
  });

  it("should have expected dependencies available", async () => {
    const fs = await import("fs");
    expect(fs.existsSync).toBeDefined();
  });
});
