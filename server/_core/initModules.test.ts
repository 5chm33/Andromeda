import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as initModules from "./initModules.js";

const startupKeys = [
  "LLM_LOCAL_ONLY",
  "ANDROMEDA_DISABLE_BACKGROUND_DAEMONS",
  "AUTONOMY",
  "CONTINUOUS_IMPROVE",
] as const;
const originalEnv = Object.fromEntries(startupKeys.map((key) => [key, process.env[key]]));

function restoreStartupEnv(): void {
  for (const key of startupKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("initModules", () => {
  beforeEach(restoreStartupEnv);
  afterEach(restoreStartupEnv);

  it("should export initModules function", () => {
    expect(initModules.initModules).toBeDefined();
    expect(typeof initModules.initModules).toBe("function");
  });

  it("should have correct signature", () => {
    expect(initModules.initModules.length).toBe(0); // takes no parameters
  });

  it("uses minimal interactive bootstrap in explicit local-only mode", () => {
    process.env.LLM_LOCAL_ONLY = "true";
    expect(initModules.isMinimalInteractiveBootstrap()).toBe(true);
  });

  it("uses minimal interactive bootstrap when autonomy is paused", () => {
    process.env.AUTONOMY = "false";
    expect(initModules.isMinimalInteractiveBootstrap()).toBe(true);
  });

  it("uses minimal interactive bootstrap when daemon suppression is explicit", () => {
    process.env.ANDROMEDA_DISABLE_BACKGROUND_DAEMONS = "true";
    expect(initModules.isMinimalInteractiveBootstrap()).toBe(true);
  });

  it("tests initModules execution for coverage", async () => {
    process.env.LLM_LOCAL_ONLY = "true";
    await expect(initModules.initModules()).resolves.toBeUndefined();
  });

  it("should not throw when loaded", async () => {
    await expect(import("./initModules.js")).resolves.toBeDefined();
  });

  it("should have expected dependencies available", async () => {
    const fs = await import("fs");
    expect(fs.existsSync).toBeDefined();
  });
});
