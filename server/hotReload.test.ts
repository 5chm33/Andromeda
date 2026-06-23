import { describe, it, expect } from "vitest";
import {
  getHotReloadStatus,
  getReloadHistory,
  checkRestartState,
  registerReloadableModule,
} from "./hotReload.js";

describe("hotReload", () => {
  it("getHotReloadStatus returns expected shape", () => {
    const status = getHotReloadStatus();
    expect(status).toHaveProperty("modules");
    expect(status).toHaveProperty("totalReloads");
    expect(status).toHaveProperty("successRate");
    expect(Array.isArray(status.modules)).toBe(true);
    expect(typeof status.totalReloads).toBe("number");
  });

  it("getReloadHistory returns an array", () => {
    const history = getReloadHistory();
    expect(Array.isArray(history)).toBe(true);
  });

  it("getReloadHistory with moduleName filter returns array", () => {
    const history = getReloadHistory("selfImprove", 10);
    expect(Array.isArray(history)).toBe(true);
  });

  it("checkRestartState returns expected shape", () => {
    const state = checkRestartState();
    expect(state).toHaveProperty("isRestart");
    expect(typeof state.isRestart).toBe("boolean");
  });

  it("getHotReloadStatus totalReloads is non-negative", () => {
    const status = getHotReloadStatus();
    expect(status.totalReloads).toBeGreaterThanOrEqual(0);
  });

  it("getHotReloadStatus successRate is between 0 and 1", () => {
    const status = getHotReloadStatus();
    expect(status.successRate).toBeGreaterThanOrEqual(0);
    expect(status.successRate).toBeLessThanOrEqual(1);
  });
});
