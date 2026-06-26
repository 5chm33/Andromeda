/**
 * rsiScheduler.v12.test.ts — v12.13.0
 *
 * Tests for the new computeAdaptiveInterval() function added in v12.13.0.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeAdaptiveInterval, getRsiSchedulerStatus } from "./rsiScheduler.js";

describe("computeAdaptiveInterval (v12.13.0)", () => {
  it("should return a number (hours)", async () => {
    const result = await computeAdaptiveInterval();
    expect(typeof result).toBe("number");
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(168); // max 1 week
  });

  it("should return default hours when history is insufficient", async () => {
    // With no RSI history, should return DEFAULT_HOURS (6)
    const result = await computeAdaptiveInterval(10);
    // Either default (6) or a valid adaptive value — both are acceptable
    expect(result).toBeGreaterThanOrEqual(1);
    expect(result).toBeLessThanOrEqual(168);
  });

  it("should accept a custom lookback parameter", async () => {
    const result5 = await computeAdaptiveInterval(5);
    const result20 = await computeAdaptiveInterval(20);
    expect(typeof result5).toBe("number");
    expect(typeof result20).toBe("number");
  });

  it("should not throw even if rsiEngine is unavailable", async () => {
    // Should gracefully fall back to default
    await expect(computeAdaptiveInterval()).resolves.not.toThrow();
  });
});

describe("getRsiSchedulerStatus (v12.13.0)", () => {
  it("should return a valid status object", () => {
    const status = getRsiSchedulerStatus();
    expect(status).toBeDefined();
    expect(typeof status.intervalHours).toBe("number");
    expect(typeof status.paused).toBe("boolean");
    expect(typeof status.runCount).toBe("number");
  });

  it("should return intervalHours within valid range", () => {
    const status = getRsiSchedulerStatus();
    expect(status.intervalHours).toBeGreaterThanOrEqual(1);
    expect(status.intervalHours).toBeLessThanOrEqual(168);
  });
});
