/**
 * v53.test.ts — External API Mastery III
 * Tests: apiIntegrationTester, apiPerformanceBenchmarker, apiCostOptimizer,
 *        apiDependencyMapper, apiChangeDetector, apiMigrationEngine
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  registerTestCase, runTestCase, runTestSuite,
  _resetIntegrationTesterForTest,
} from "./apiIntegrationTester.js";

import {
  recordBenchmarkRun, setBaseline, getBenchmarkReport,
  _resetBenchmarkerForTest,
} from "./apiPerformanceBenchmarker.js";

import {
  registerCostConfig, recordApiUsage, getCostRecord, getOptimizationRecommendations,
  _resetCostOptimizerForTest,
} from "./apiCostOptimizer.js";

import {
  registerDependency, getDependencyGraph, getDependentsOf, getDependenciesOf,
  _resetDependencyMapperForTest,
} from "./apiDependencyMapper.js";

import { compareSchemas, _resetChangeDetectorForTest } from "./apiChangeDetector.js";

import {
  registerMigrationScript, runMigration, getMigrationHistory,
  getPendingMigrations, isApplied, _resetMigrationEngineForTest,
} from "./apiMigrationEngine.js";

describe("v53 External API Mastery III", () => {
  // ─── apiIntegrationTester ─────────────────────────────────────────────────
  describe("apiIntegrationTester", () => {
    beforeEach(() => _resetIntegrationTesterForTest());

    it("should register and run a passing test case", () => {
      const tc = registerTestCase({
        name: "Get users returns 200",
        apiId: "api1",
        endpoint: "/users",
        method: "GET",
        expectedStatus: 200,
        assertions: [{ field: "data.count", operator: "gt", expected: 0 }],
      });
      const result = runTestCase(tc.testId, { status: 200, body: { data: { count: 5 } } });
      expect(result.passed).toBe(true);
      expect(result.failedAssertions).toHaveLength(0);
    });

    it("should fail test when status doesn't match", () => {
      const tc = registerTestCase({
        name: "Create user returns 201",
        apiId: "api1",
        endpoint: "/users",
        method: "POST",
        expectedStatus: 201,
        assertions: [],
      });
      const result = runTestCase(tc.testId, { status: 400, body: {} });
      expect(result.passed).toBe(false);
    });

    it("should run a test suite and report pass rate", () => {
      const tc1 = registerTestCase({ name: "T1", apiId: "api1", endpoint: "/a", method: "GET", expectedStatus: 200, assertions: [] });
      const tc2 = registerTestCase({ name: "T2", apiId: "api1", endpoint: "/b", method: "GET", expectedStatus: 200, assertions: [] });
      const mocks = new Map([
        [tc1.testId, { status: 200, body: {} }],
        [tc2.testId, { status: 404, body: {} }],
      ]);
      const report = runTestSuite([tc1.testId, tc2.testId], mocks);
      expect(report.totalTests).toBe(2);
      expect(report.passed).toBe(1);
      expect(report.passRate).toBe(0.5);
    });
  });

  // ─── apiPerformanceBenchmarker ────────────────────────────────────────────
  describe("apiPerformanceBenchmarker", () => {
    beforeEach(() => _resetBenchmarkerForTest());

    it("should record and report benchmark metrics", () => {
      recordBenchmarkRun("api1", "/users", [50, 60, 70, 80, 90, 100, 110, 120, 130, 200]);
      const report = getBenchmarkReport("api1", "/users");
      expect(report).not.toBeNull();
      expect(report!.minMs).toBe(50);
      expect(report!.maxMs).toBe(200);
      expect(report!.avgMs).toBeGreaterThan(50);
    });

    it("should detect regression vs baseline", () => {
      setBaseline("api1", "/data", 100);
      recordBenchmarkRun("api1", "/data", [150, 160, 170, 180, 190, 200, 210, 220, 230, 240]);
      const report = getBenchmarkReport("api1", "/data");
      expect(report!.regressionDetected).toBe(true);
    });

    it("should not flag regression when within threshold", () => {
      setBaseline("api1", "/fast", 100);
      recordBenchmarkRun("api1", "/fast", [100, 105, 110, 100, 105, 110, 100, 105, 110, 100]);
      const report = getBenchmarkReport("api1", "/fast");
      expect(report!.regressionDetected).toBe(false);
    });
  });

  // ─── apiCostOptimizer ─────────────────────────────────────────────────────
  describe("apiCostOptimizer", () => {
    beforeEach(() => _resetCostOptimizerForTest());

    it("should track call costs", () => {
      registerCostConfig({ apiId: "api1", name: "Test API", costPerCall: 0.001, monthlyBudget: 10 });
      for (let i = 0; i < 100; i++) recordApiUsage("api1");
      const record = getCostRecord("api1");
      expect(record?.calls).toBe(100);
      expect(record?.totalCost).toBeCloseTo(0.1);
    });

    it("should generate budget alert when near limit", () => {
      registerCostConfig({ apiId: "api2", name: "Expensive API", costPerCall: 0.01, monthlyBudget: 1 });
      for (let i = 0; i < 90; i++) recordApiUsage("api2");
      const recs = getOptimizationRecommendations("api2");
      const alert = recs.find(r => r.type === "budget-alert");
      expect(alert).toBeDefined();
      expect(alert?.priority).toBe("high");
    });

    it("should recommend caching for high-volume APIs", () => {
      registerCostConfig({ apiId: "api3", name: "High Volume", costPerCall: 0.001 });
      for (let i = 0; i < 1100; i++) recordApiUsage("api3");
      const recs = getOptimizationRecommendations("api3");
      expect(recs.some(r => r.type === "cache")).toBe(true);
    });
  });

  // ─── apiDependencyMapper ──────────────────────────────────────────────────
  describe("apiDependencyMapper", () => {
    beforeEach(() => _resetDependencyMapperForTest());

    it("should map and retrieve dependencies", () => {
      registerDependency({ fromApiId: "api1", toApiId: "api2", dependencyType: "data" });
      registerDependency({ fromApiId: "api1", toApiId: "api3", dependencyType: "auth" });
      expect(getDependenciesOf("api1")).toContain("api2");
      expect(getDependenciesOf("api1")).toContain("api3");
    });

    it("should find dependents", () => {
      registerDependency({ fromApiId: "api1", toApiId: "api2", dependencyType: "data" });
      registerDependency({ fromApiId: "api3", toApiId: "api2", dependencyType: "data" });
      expect(getDependentsOf("api2")).toContain("api1");
      expect(getDependentsOf("api2")).toContain("api3");
    });

    it("should detect circular dependencies", () => {
      registerDependency({ fromApiId: "api1", toApiId: "api2", dependencyType: "data" });
      registerDependency({ fromApiId: "api2", toApiId: "api3", dependencyType: "data" });
      registerDependency({ fromApiId: "api3", toApiId: "api1", dependencyType: "data" });
      const graph = getDependencyGraph();
      expect(graph.circularPaths.length).toBeGreaterThan(0);
    });
  });

  // ─── apiChangeDetector ────────────────────────────────────────────────────
  describe("apiChangeDetector", () => {
    beforeEach(() => _resetChangeDetectorForTest());

    it("should detect added fields as additive", () => {
      const report = compareSchemas("api1", { id: "string" }, { id: "string", name: "string" });
      const additive = report.changes.find(c => c.type === "additive");
      expect(additive).toBeDefined();
      expect(report.hasBreakingChanges).toBe(false);
    });

    it("should detect removed fields as breaking", () => {
      const report = compareSchemas("api1", { id: "string", legacy: "string" }, { id: "string" });
      expect(report.hasBreakingChanges).toBe(true);
    });

    it("should detect type changes as breaking", () => {
      const report = compareSchemas("api1", { id: 123 }, { id: "abc" });
      expect(report.hasBreakingChanges).toBe(true);
    });
  });

  // ─── apiMigrationEngine ───────────────────────────────────────────────────
  describe("apiMigrationEngine", () => {
    beforeEach(() => _resetMigrationEngineForTest());

    it("should run up migration and transform data", () => {
      registerMigrationScript({
        migrationId: "m001",
        name: "Add active field",
        version: "1.0.0",
        up: (data) => data.map(r => ({ ...r, active: true })),
        down: (data) => data.map(({ active: _a, ...rest }) => rest),
        description: "Adds active field to all records",
      });
      const result = runMigration("m001", [{ id: 1 }, { id: 2 }]);
      expect(result.success).toBe(true);
      expect(result.recordsProcessed).toBe(2);
      expect(isApplied("m001")).toBe(true);
    });

    it("should support dry-run without recording history", () => {
      registerMigrationScript({
        migrationId: "m002",
        name: "Dry run test",
        version: "1.0.0",
        up: (data) => data,
        down: (data) => data,
        description: "No-op migration",
      });
      runMigration("m002", [{ id: 1 }], "up", true);
      expect(isApplied("m002")).toBe(false);
      expect(getMigrationHistory()).toHaveLength(0);
    });

    it("should list pending migrations", () => {
      registerMigrationScript({ migrationId: "m003", name: "Pending", version: "1.0.0", up: d => d, down: d => d, description: "" });
      expect(getPendingMigrations().some(m => m.migrationId === "m003")).toBe(true);
    });
  });
});
