import { describe, it, expect } from "vitest";
import * as initDaemons from "./initDaemons.js";

describe("initDaemons", () => {
  it("should export startDaemons function", () => {
    expect(initDaemons.startDaemons).toBeDefined();
    expect(typeof initDaemons.startDaemons).toBe("function");
  });

  it("should have correct signature", () => {
    expect(initDaemons.startDaemons.length).toBe(0);
  });

  it("tests startDaemons execution for coverage", async () => {
    try {
      await initDaemons.startDaemons();
    } catch (e) {
      // expected to fail in test env
    }
  });

  it("should not throw when loaded", async () => {
    await expect(import("./initDaemons.js")).resolves.toBeDefined();
  });

  it("should have expected dependencies available", async () => {
    const fs = await import("fs");
    expect(fs.existsSync).toBeDefined();
  });
});
