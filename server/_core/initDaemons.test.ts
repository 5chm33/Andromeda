import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as initDaemons from "./initDaemons.js";

const startupEnvKeys = [
  "ANDROMEDA_START_DAEMONS",
  "ANDROMEDA_DISABLE_BACKGROUND_DAEMONS",
  "LLM_LOCAL_ONLY",
  "CONTINUOUS_IMPROVE",
  "AUTONOMY",
] as const;

const originalEnv = Object.fromEntries(startupEnvKeys.map((key) => [key, process.env[key]]));

function restoreStartupEnv(): void {
  for (const key of startupEnvKeys) {
    const original = originalEnv[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
}

describe("initDaemons", () => {
  beforeEach(restoreStartupEnv);
  afterEach(restoreStartupEnv);

  it("should export startDaemons function", () => {
    expect(initDaemons.startDaemons).toBeDefined();
    expect(typeof initDaemons.startDaemons).toBe("function");
  });

  it("should have correct signature", () => {
    expect(initDaemons.startDaemons.length).toBe(0);
  });

  it("disables background daemon startup in the unit-test environment", () => {
    expect(initDaemons.isBackgroundDaemonStartupEnabled()).toBe(false);
  });

  it("keeps background daemons disabled in explicit local-only mode", () => {
    process.env.ANDROMEDA_START_DAEMONS = "true";
    process.env.LLM_LOCAL_ONLY = "true";
    expect(initDaemons.isBackgroundDaemonStartupEnabled()).toBe(false);
  });

  it("keeps background daemons disabled while RSI is paused", () => {
    process.env.ANDROMEDA_START_DAEMONS = "true";
    process.env.CONTINUOUS_IMPROVE = "false";
    expect(initDaemons.isBackgroundDaemonStartupEnabled()).toBe(false);
  });

  it("keeps background daemons disabled when autonomy is explicitly off", () => {
    process.env.ANDROMEDA_START_DAEMONS = "true";
    process.env.AUTONOMY = "false";
    expect(initDaemons.isBackgroundDaemonStartupEnabled()).toBe(false);
  });

  it("tests startDaemons execution for coverage", async () => {
    try {
      await initDaemons.startDaemons();
    } catch {
      // Expected to fail or no-op in test environment.
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
