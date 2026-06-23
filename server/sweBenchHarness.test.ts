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

  it("getHarnessStatus after reset has null baselineScore", () => {
    resetHarnessStatus();
    const status = getHarnessStatus();
    expect(status.baselineScore).toBeNull();
  });

  it("getHarnessStatus lastRunAt is null or number", () => {
    const status = getHarnessStatus();
    expect(status.lastRunAt === null || typeof status.lastRunAt === "number").toBe(true);
  });
});
