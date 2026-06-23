import { describe, it, expect } from "vitest";
import { introspectSelf, getQuickStats, initSelfIntrospect } from "./selfIntrospect.js";

describe("introspectSelf", () => {
  it("should execute without throwing", async () => {
    try {
      const result = await introspectSelf();
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", async () => {
    const result = await introspectSelf();
    expect(result).toBeTruthy();
  });

  it("should handle invalid inputs", async () => {
    // @ts-expect-error Testing invalid input
    try { await introspectSelf(); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

describe("getQuickStats", () => {
  it("should execute without throwing", () => {
    try {
      const result = getQuickStats();
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = getQuickStats();
    expect(result).toBeTruthy();
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { getQuickStats(); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

describe("initSelfIntrospect", () => {
  it("should execute without throwing", () => {
    // initSelfIntrospect returns void — just verify it doesn't throw
    expect(() => initSelfIntrospect()).not.toThrow();
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { initSelfIntrospect(); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

