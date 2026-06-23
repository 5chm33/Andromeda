import { describe, it, expect, beforeEach } from "vitest";
import {
  getModificationStats,
  setEnabled,
  isEnabled,
  initSelfModify,
} from "./selfModify.js";

describe("selfModify", () => {
  beforeEach(() => {
    initSelfModify();
  });

  it("isEnabled returns a boolean", () => {
    expect(typeof isEnabled()).toBe("boolean");
  });

  it("setEnabled(true) makes isEnabled return true", () => {
    setEnabled(true);
    expect(isEnabled()).toBe(true);
  });

  it("setEnabled(false) makes isEnabled return false", () => {
    setEnabled(false);
    expect(isEnabled()).toBe(false);
  });

  it("getModificationStats returns expected shape", () => {
    const stats = getModificationStats();
    expect(stats).toHaveProperty("total");
    expect(stats).toHaveProperty("successful");
    expect(stats).toHaveProperty("failed");
    expect(stats).toHaveProperty("successRate");
    expect(stats).toHaveProperty("enabled");
    expect(typeof stats.total).toBe("number");
    expect(typeof stats.successful).toBe("number");
    expect(typeof stats.failed).toBe("number");
  });

  it("getModificationStats counts are non-negative", () => {
    const stats = getModificationStats();
    expect(stats.total).toBeGreaterThanOrEqual(0);
    expect(stats.successful).toBeGreaterThanOrEqual(0);
    expect(stats.failed).toBeGreaterThanOrEqual(0);
  });

  it("initSelfModify runs without throwing", () => {
    expect(() => initSelfModify()).not.toThrow();
  });
});
