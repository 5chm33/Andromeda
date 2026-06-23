import { describe, it, expect, beforeEach } from "vitest";
import {
  emitRsiEvent,
  getSseClientCount,
  getEventHistory,
} from "./rsiEventBus.js";

describe("rsiEventBus", () => {
  it("emitRsiEvent does not throw for valid event types", () => {
    expect(() => emitRsiEvent("cycle:start", { cycleNumber: 1 })).not.toThrow();
    expect(() => emitRsiEvent("cycle:complete", { cycleNumber: 1, proposalsApplied: 0 })).not.toThrow();
    expect(() => emitRsiEvent("proposal:applied", { id: "test-id", title: "Test" })).not.toThrow();
  });

  it("getSseClientCount returns a non-negative number", () => {
    const count = getSseClientCount();
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("getEventHistory returns an array", () => {
    const history = getEventHistory(10);
    expect(Array.isArray(history)).toBe(true);
  });

  it("emitted events appear in getEventHistory", () => {
    emitRsiEvent("cycle:start", { cycleNumber: 999 });
    const history = getEventHistory(50);
    expect(history.length).toBeGreaterThan(0);
    const found = history.some(e => e.type === "cycle:start" && (e.data as any)?.cycleNumber === 999);
    expect(found).toBe(true);
  });

  it("getEventHistory respects limit parameter", () => {
    for (let i = 0; i < 10; i++) emitRsiEvent("cycle:start", { cycleNumber: i });
    const limited = getEventHistory(3);
    expect(limited.length).toBeLessThanOrEqual(3);
  });
});
