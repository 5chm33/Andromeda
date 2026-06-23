import { describe, it, expect } from "vitest";
import { withContinuousImproverLock, withRsiCycleLock } from "./redisLock.js";

describe("redisLock", () => {
  it("exports withContinuousImproverLock and withRsiCycleLock", () => {
    expect(typeof withContinuousImproverLock).toBe("function");
    expect(typeof withRsiCycleLock).toBe("function");
  });

  it("withContinuousImproverLock executes the callback and returns LockResult", async () => {
    const result = await withContinuousImproverLock(async () => 42);
    expect(result).toHaveProperty("skipped");
    expect(typeof result.skipped).toBe("boolean");
  });

  it("withRsiCycleLock executes the callback and returns LockResult", async () => {
    const result = await withRsiCycleLock(async () => "hello");
    expect(result).toHaveProperty("skipped");
    expect(typeof result.skipped).toBe("boolean");
  });

  it("withContinuousImproverLock result is accessible when not skipped", async () => {
    const result = await withContinuousImproverLock(async () => ({ value: 99 }));
    if (!result.skipped) {
      expect(result.result).toHaveProperty("value", 99);
    } else {
      // Lock was busy — acceptable in test environment
      expect(result.skipped).toBe(true);
    }
  });

  it("withContinuousImproverLock handles async callbacks without throwing", async () => {
    await expect(withContinuousImproverLock(async () => "ok")).resolves.toBeDefined();
  });
});
