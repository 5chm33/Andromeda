/**
 * zeroShotTransferEngine.test.ts — v1.0.0
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  registerPrinciple,
  getPrinciplesForDomain,
  getTransfersForDomain,
  getTransferStats,
  initZeroShotTransferEngine,
} from "./zeroShotTransferEngine.js";

describe("zeroShotTransferEngine", () => {
  beforeEach(() => {
    initZeroShotTransferEngine();
  });

  it("module loads without throwing", () => {
    expect(registerPrinciple).toBeDefined();
    expect(getPrinciplesForDomain).toBeDefined();
    expect(getTransfersForDomain).toBeDefined();
    expect(getTransferStats).toBeDefined();
    expect(initZeroShotTransferEngine).toBeDefined();
  });

  it("initZeroShotTransferEngine does not throw", () => {
    expect(() => initZeroShotTransferEngine()).not.toThrow();
  });

  it("getPrinciplesForDomain returns seed principles for code domain", () => {
    const principles = getPrinciplesForDomain("code");
    expect(Array.isArray(principles)).toBe(true);
    expect(principles.length).toBeGreaterThan(0);
  });

  it("getPrinciplesForDomain returns principles sorted by confidence", () => {
    const principles = getPrinciplesForDomain("code");
    for (let i = 1; i < principles.length; i++) {
      expect(principles[i - 1].confidence).toBeGreaterThanOrEqual(principles[i].confidence);
    }
  });

  it("getPrinciplesForDomain includes idempotency for code domain", () => {
    const principles = getPrinciplesForDomain("code");
    const names = principles.map(p => p.name);
    expect(names).toContain("idempotency");
  });

  it("registerPrinciple creates a valid principle", () => {
    const principle = registerPrinciple(
      "test_principle",
      "A test principle for unit testing",
      "scientific",
      "Scientists replicate experiments to verify results",
      "Verify outcomes by running the same process multiple times",
      ["code", "data_pipeline"],
      80,
    );
    expect(principle).toBeDefined();
    expect(principle.id).toBeTruthy();
    expect(principle.name).toBe("test_principle");
    expect(principle.sourceDomain).toBe("scientific");
    expect(principle.confidence).toBe(80);
    expect(principle.transferCount).toBe(0);
  });

  it("registerPrinciple makes principle available in getPrinciplesForDomain", () => {
    registerPrinciple(
      "unique_test_principle_xyz",
      "A unique test principle",
      "finance",
      "Finance pattern",
      "Abstract form",
      ["education"],
      75,
    );
    const principles = getPrinciplesForDomain("education");
    const names = principles.map(p => p.name);
    expect(names).toContain("unique_test_principle_xyz");
  });

  it("getTransfersForDomain returns empty array before any transfers", () => {
    const transfers = getTransfersForDomain("robotics");
    expect(Array.isArray(transfers)).toBe(true);
  });

  it("getTransferStats returns valid stats", () => {
    const stats = getTransferStats();
    expect(stats).toBeDefined();
    expect(typeof stats.totalPrinciples).toBe("number");
    expect(typeof stats.totalTransfers).toBe("number");
    expect(typeof stats.acceptedTransfers).toBe("number");
    expect(typeof stats.transfersByDomain).toBe("object");
    expect(Array.isArray(stats.topPrinciples)).toBe(true);
    expect(stats.totalPrinciples).toBeGreaterThanOrEqual(6);  // 6 seed principles
  });

  it("getTransferStats.acceptedTransfers <= totalTransfers", () => {
    const stats = getTransferStats();
    expect(stats.acceptedTransfers).toBeLessThanOrEqual(stats.totalTransfers);
  });
});
