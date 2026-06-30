import { describe, it, expect } from "vitest";
import { getHarnessStatus, resetHarnessStatus } from "./sweBenchHarness.js";

describe("sweBenchHarness", () => {
  it("exports getHarnessStatus and resetHarnessStatus", () => {
    expect(typeof getHarnessStatus).toBe("function");
    expect(typeof resetHarnessStatus).toBe("function");
  });

  it("getHarnessStatus returns expected shape", () => {
    const status = getHarnessStatus();
    expect(status).toHaveProperty("baselineScore");
    expect(status).toHaveProperty("lastRunAt");
  });

  it("resetHarnessStatus does not throw", () => {
    expect(() => resetHarnessStatus()).not.toThrow();
  });

  it("getHarnessStatus after reset returns valid baselineScore type", () => {
    resetHarnessStatus();
    const status = getHarnessStatus();
    // After reset, getHarnessStatus auto-loads from disk if a results file exists.
    // So baselineScore is either null (no file) or a number (file found on disk).
    expect(status.baselineScore === null || typeof status.baselineScore === "number").toBe(true);
  });

  it("getHarnessStatus lastRunAt is null or number", () => {
    const status = getHarnessStatus();
    expect(status.lastRunAt === null || typeof status.lastRunAt === "number").toBe(true);
  });
});
