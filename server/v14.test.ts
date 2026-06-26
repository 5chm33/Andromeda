/**
 * v14.test.ts — Andromeda v14.0.0 Test Suite
 * Tests for: rsiWorkerPool, selfHealingChaos, epistemicBeliefModel (pattern memory), ciRegressionGuard (gate)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── rsiWorkerPool ────────────────────────────────────────────────────────────
describe("rsiWorkerPool", () => {
  it("initRsiWorkerPool is idempotent", async () => {
    const { initRsiWorkerPool } = await import("./rsiWorkerPool.js");
    expect(() => { initRsiWorkerPool(); initRsiWorkerPool(); }).not.toThrow();
  });

  it("getWorkerPoolStats returns valid shape", async () => {
    const { initRsiWorkerPool, getWorkerPoolStats } = await import("./rsiWorkerPool.js");
    initRsiWorkerPool();
    const stats = getWorkerPoolStats();
    expect(stats).toHaveProperty("maxWorkers");
    expect(stats).toHaveProperty("activeWorkers");
    expect(stats).toHaveProperty("completedTasks");
    expect(stats).toHaveProperty("failedTasks");
    expect(stats).toHaveProperty("throughputPerHour");
    expect(stats.maxWorkers).toBeGreaterThanOrEqual(2);
  });

  it("submitParallelProposals returns empty array for empty input", async () => {
    const { submitParallelProposals } = await import("./rsiWorkerPool.js");
    const results = await submitParallelProposals([]);
    expect(results).toEqual([]);
  });

  it("submitParallelProposals handles worker errors gracefully", async () => {
    const { submitParallelProposals } = await import("./rsiWorkerPool.js");
    // Pass a non-existent file — should return error result, not throw
    const results = await submitParallelProposals(["server/nonexistent_file_xyz.ts"], "test-cycle");
    expect(results).toHaveLength(1);
    expect(results[0].targetFile).toBe("server/nonexistent_file_xyz.ts");
    expect(results[0].proposalsGenerated).toBe(0);
    expect(results[0].error).toBeDefined();
  });
});

// ─── selfHealingChaos ─────────────────────────────────────────────────────────
describe("selfHealingChaos", () => {
  beforeEach(async () => {
    const { initSelfHealingChaos, _resetStateForTesting } = await import("./selfHealingChaos.js");
    _resetStateForTesting();
    initSelfHealingChaos();
  });

  it("initSelfHealingChaos is idempotent", async () => {
    const { initSelfHealingChaos } = await import("./selfHealingChaos.js");
    expect(() => { initSelfHealingChaos(); initSelfHealingChaos(); }).not.toThrow();
  });

  it("processChaosResults adds hardening targets for low-resilience modules", async () => {
    const { processChaosResults, getHardeningTargets, getSelfHealingStats } = await import("./selfHealingChaos.js");
    processChaosResults([
      { moduleName: "testModuleAlpha", resilienceScore: 0.3, failedFaults: ["network_timeout", "memory_spike"] },
    ]);
    const targets = getHardeningTargets(10);
    const target = targets.find(t => t.moduleName === "testModuleAlpha");
    expect(target).toBeDefined();
    expect(target!.escalationLevel).toBe(3); // score < 0.4 = critical
    expect(target!.priority).toBe("critical");
    expect(target!.failedFaults).toContain("network_timeout");
  });

  it("processChaosResults resolves targets that pass threshold", async () => {
    const { processChaosResults, isHardeningTarget } = await import("./selfHealingChaos.js");
    // First add as target
    processChaosResults([{ moduleName: "testModuleBeta", resilienceScore: 0.5, failedFaults: ["cpu_spike"] }]);
    expect(isHardeningTarget("testModuleBeta")).toBe(true);
    // Now it passes
    processChaosResults([{ moduleName: "testModuleBeta", resilienceScore: 0.95, failedFaults: [] }]);
    expect(isHardeningTarget("testModuleBeta")).toBe(false);
  });

  it("getEscalationLevel returns correct levels", async () => {
    const { processChaosResults, getEscalationLevel } = await import("./selfHealingChaos.js");
    processChaosResults([
      { moduleName: "testModuleL1", resilienceScore: 0.75, failedFaults: ["cpu_spike"] },
      { moduleName: "testModuleL2", resilienceScore: 0.55, failedFaults: ["memory_spike"] },
      { moduleName: "testModuleL3", resilienceScore: 0.35, failedFaults: ["network_timeout"] },
    ]);
    expect(getEscalationLevel("testModuleL1")).toBe(1);
    expect(getEscalationLevel("testModuleL2")).toBe(2);
    expect(getEscalationLevel("testModuleL3")).toBe(3);
    expect(getEscalationLevel("nonExistentModule")).toBe(0);
  });

  it("recordRsiAttempt increments attempt counter", async () => {
    const { processChaosResults, recordRsiAttempt, getHardeningTargets } = await import("./selfHealingChaos.js");
    processChaosResults([{ moduleName: "testModuleGamma", resilienceScore: 0.5, failedFaults: ["cpu_spike"] }]);
    recordRsiAttempt("testModuleGamma");
    recordRsiAttempt("testModuleGamma");
    const targets = getHardeningTargets(10);
    const target = targets.find(t => t.moduleName === "testModuleGamma");
    expect(target!.rsiCyclesAttempted).toBe(2);
  });

  it("clearHardeningTarget resolves a target", async () => {
    const { processChaosResults, clearHardeningTarget, isHardeningTarget } = await import("./selfHealingChaos.js");
    processChaosResults([{ moduleName: "testModuleDelta", resilienceScore: 0.3, failedFaults: ["network_timeout"] }]);
    expect(isHardeningTarget("testModuleDelta")).toBe(true);
    clearHardeningTarget("testModuleDelta");
    expect(isHardeningTarget("testModuleDelta")).toBe(false);
  });

  it("getSelfHealingStats returns valid shape", async () => {
    const { getSelfHealingStats } = await import("./selfHealingChaos.js");
    const stats = getSelfHealingStats();
    expect(stats).toHaveProperty("activeTargets");
    expect(stats).toHaveProperty("resolvedTargets");
    expect(stats).toHaveProperty("criticalTargets");
    expect(stats).toHaveProperty("avgResilienceScore");
    expect(stats).toHaveProperty("totalRsiCyclesTriggered");
    expect(stats.avgResilienceScore).toBeGreaterThanOrEqual(0);
    expect(stats.avgResilienceScore).toBeLessThanOrEqual(1);
  });

  it("getHealingEvents returns recent events", async () => {
    const { processChaosResults, getHealingEvents } = await import("./selfHealingChaos.js");
    processChaosResults([{ moduleName: "testModuleEpsilon", resilienceScore: 0.2, failedFaults: ["disk_io"] }]);
    const events = getHealingEvents(5);
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toHaveProperty("type");
    expect(events[0]).toHaveProperty("moduleName");
    expect(events[0]).toHaveProperty("timestamp");
  });
});

// ─── epistemicBeliefModel (pattern memory) ────────────────────────────────────
describe("epistemicBeliefModel — pattern memory", () => {
  it("initPatternMemory is idempotent", async () => {
    const { initPatternMemory } = await import("./epistemicBeliefModel.js");
    expect(() => { initPatternMemory(); initPatternMemory(); }).not.toThrow();
  });

  it("recordPatternOutcome and getPatternStats track outcomes", async () => {
    const { initPatternMemory, recordPatternOutcome, getPatternStats } = await import("./epistemicBeliefModel.js");
    initPatternMemory();
    recordPatternOutcome("Add null guard before JSON.parse", "structure", "testFile.ts", "success");
    recordPatternOutcome("Rename variable to camelCase", "naming", "testFile.ts", "failure");
    const stats = getPatternStats();
    expect(stats.totalPatterns).toBeGreaterThan(0);
    expect(stats.successCount).toBeGreaterThan(0);
    expect(stats.failureCount).toBeGreaterThan(0);
    expect(stats.successRate).toBeGreaterThan(0);
    expect(stats.successRate).toBeLessThanOrEqual(1);
  });

  it("buildPatternContext returns empty string when no history", async () => {
    const { buildPatternContext } = await import("./epistemicBeliefModel.js");
    const ctx = buildPatternContext("server/nonexistent_file_xyz.ts");
    expect(typeof ctx).toBe("string");
  });

  it("buildPatternContext includes file-specific history", async () => {
    const { initPatternMemory, recordPatternOutcome, buildPatternContext } = await import("./epistemicBeliefModel.js");
    initPatternMemory();
    recordPatternOutcome("Add try/catch wrapper", "structure", "mySpecialFile.ts", "success");
    recordPatternOutcome("Add try/catch wrapper", "structure", "mySpecialFile.ts", "success");
    const ctx = buildPatternContext("server/mySpecialFile.ts");
    expect(ctx).toContain("Add try/catch wrapper");
    expect(ctx).toContain("SUCCEEDED");
  });
});

// ─── ciRegressionGuard (gate) ─────────────────────────────────────────────────
describe("ciRegressionGuard — test suite gate", () => {
  it("initCiRegressionGuard is idempotent", async () => {
    const { initCiRegressionGuard } = await import("./ciRegressionGuard.js");
    expect(() => { initCiRegressionGuard(); initCiRegressionGuard(); }).not.toThrow();
  });

  it("runTestSuiteGate passes for files with no prior metrics", async () => {
    const { initCiRegressionGuard, runTestSuiteGate } = await import("./ciRegressionGuard.js");
    initCiRegressionGuard();
    const result = runTestSuiteGate("proposal-001", "server/brandNewFile.ts", "export const x = 1;", process.cwd());
    expect(result.passed).toBe(true);
    expect(result.testsRun).toBe(0);
    expect(result.detail).toContain("No prior metrics");
  });

  it("runTestSuiteGate returns valid shape", async () => {
    const { runTestSuiteGate } = await import("./ciRegressionGuard.js");
    const result = runTestSuiteGate("proposal-002", "server/someFile.ts", "export const y = 2;", process.cwd());
    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("testsRun");
    expect(result).toHaveProperty("testsFailed");
    expect(result).toHaveProperty("durationMs");
    expect(result).toHaveProperty("detail");
    expect(typeof result.passed).toBe("boolean");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
