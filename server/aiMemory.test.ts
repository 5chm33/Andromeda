import { describe, it, expect } from "vitest";
import {
  readAndromedaMemory,
  getAndromedaMemoryPathPublic,
  getAndromedaMemoryStats,
} from "./aiMemory.js";

describe("aiMemory", () => {
  it("getAndromedaMemoryPathPublic returns a non-empty string path", () => {
    const p = getAndromedaMemoryPathPublic();
    expect(typeof p).toBe("string");
    expect(p.length).toBeGreaterThan(0);
  });

  it("getAndromedaMemoryStats returns expected shape", () => {
    const stats = getAndromedaMemoryStats();
    expect(stats).toHaveProperty("exists");
    expect(stats).toHaveProperty("path");
    expect(stats).toHaveProperty("sizeBytes");
    expect(typeof stats.exists).toBe("boolean");
    expect(typeof stats.sizeBytes).toBe("number");
  });

  it("readAndromedaMemory returns string or null", () => {
    const result = readAndromedaMemory();
    expect(result === null || typeof result === "string").toBe(true);
  });

  it("getAndromedaMemoryStats path matches getAndromedaMemoryPathPublic", () => {
    const stats = getAndromedaMemoryStats();
    const publicPath = getAndromedaMemoryPathPublic();
    expect(stats.path).toBe(publicPath);
  });

  it("getAndromedaMemoryStats sizeBytes is non-negative", () => {
    const stats = getAndromedaMemoryStats();
    expect(stats.sizeBytes).toBeGreaterThanOrEqual(0);
  });
});
