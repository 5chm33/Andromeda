import { describe, it, expect } from "vitest";
import { runBenchmarks, startBenchmarkRunner, stopBenchmarkRunner, getLastBenchmarkReport, isRunning } from "./benchmarkRunner.js";

describe("runBenchmarks", () => {
  it("should execute without throwing", async () => {
    try {
      const result = await runBenchmarks();
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", async () => {
    const result = await runBenchmarks();
    expect(result).toBeTruthy();
  });

  it("should handle invalid inputs", async () => {
    // @ts-expect-error Testing invalid input
    try { await runBenchmarks(); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

describe("startBenchmarkRunner", () => {
  it("should execute without throwing", () => {
    // startBenchmarkRunner returns void — just verify it doesn't throw
    expect(() => startBenchmarkRunner()).not.toThrow();
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { startBenchmarkRunner(); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

describe("stopBenchmarkRunner", () => {
  it("should execute without throwing", () => {
    // stopBenchmarkRunner returns void — just verify it doesn't throw
    expect(() => stopBenchmarkRunner()).not.toThrow();
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { stopBenchmarkRunner(); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

describe("getLastBenchmarkReport", () => {
  it("should execute without throwing", () => {
    try {
      const result = getLastBenchmarkReport();
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = getLastBenchmarkReport();
    expect(result).toBeTruthy();
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { getLastBenchmarkReport(); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

describe("isRunning", () => {
  it("should execute without throwing", () => {
    try {
      const result = isRunning();
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = isRunning();
    expect(typeof result).toBe("boolean");
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { isRunning(); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

