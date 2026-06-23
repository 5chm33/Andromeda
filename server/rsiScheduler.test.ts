import { describe, it, expect } from "vitest";
import {
  initRsiScheduler,
  getRsiSchedulerStatus,
  setRsiScheduleHours,
} from "./rsiScheduler.js";

describe("rsiScheduler", () => {
  it("exports initRsiScheduler, getRsiSchedulerStatus, setRsiScheduleHours", () => {
    expect(typeof initRsiScheduler).toBe("function");
    expect(typeof getRsiSchedulerStatus).toBe("function");
    expect(typeof setRsiScheduleHours).toBe("function");
  });

  it("getRsiSchedulerStatus returns expected shape", () => {
    const status = getRsiSchedulerStatus();
    expect(status).toHaveProperty("intervalHours");
    expect(status).toHaveProperty("runCount");
    expect(typeof status.intervalHours).toBe("number");
    expect(typeof status.runCount).toBe("number");
  });

  it("setRsiScheduleHours accepts valid hours and returns boolean", () => {
    const result = setRsiScheduleHours(12);
    expect(typeof result).toBe("boolean");
  });

  it("setRsiScheduleHours rejects hours below 1", () => {
    const result = setRsiScheduleHours(-1);
    expect(result).toBe(false);
  });

  it("setRsiScheduleHours rejects hours above 168", () => {
    const result = setRsiScheduleHours(999);
    expect(result).toBe(false);
  });

  it("getRsiSchedulerStatus nextRunAt is null or string", () => {
    const status = getRsiSchedulerStatus();
    expect(status.nextRunAt === null || typeof status.nextRunAt === "string").toBe(true);
  });
});
