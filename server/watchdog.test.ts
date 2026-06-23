import { describe, it, expect } from "vitest";
import { getWatchdogStatus, initWatchdog } from "./watchdog.js";

describe("watchdog", () => {
  it("exports getWatchdogStatus and initWatchdog", () => {
    expect(typeof getWatchdogStatus).toBe("function");
    expect(typeof initWatchdog).toBe("function");
  });

  it("getWatchdogStatus returns expected shape", () => {
    const status = getWatchdogStatus();
    expect(status).toHaveProperty("enabled");
    expect(status).toHaveProperty("overallHealth");
    expect(typeof status.enabled).toBe("boolean");
    expect(["healthy","degraded","critical"]).toContain(status.overallHealth);
  });

  it("initWatchdog does not throw", () => {
    expect(() => initWatchdog()).not.toThrow();
  });

  it("getWatchdogStatus modules is an array", () => {
    const status = getWatchdogStatus();
    expect(Array.isArray(status.modules)).toBe(true);
  });

  it("getWatchdogStatus numeric fields are numbers", () => {
    const status = getWatchdogStatus();
    expect(typeof status.totalModules).toBe("number");
    expect(typeof status.totalRestarts).toBe("number");
    expect(typeof status.uptime).toBe("number");
  });
});
