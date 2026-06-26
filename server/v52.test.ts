/**
 * v52.test.ts — External API Mastery II
 * Tests: apiWorkflowComposer, apiDataTransformer, apiErrorRecovery,
 *        apiVersionAdapter, apiCachingLayer, apiSecurityAuditor
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  createWorkflow, startExecution, getWorkflow, listWorkflows,
  _resetWorkflowComposerForTest,
} from "./apiWorkflowComposer.js";

import { applyMapping, normalizeResponse, flattenObject } from "./apiDataTransformer.js";

import {
  configureRecovery, decideRecovery, recordSuccess, isCircuitOpen,
  _resetErrorRecoveryForTest,
} from "./apiErrorRecovery.js";

import {
  registerMigration, adaptRequest, getCompatibilityReport,
  _resetVersionAdapterForTest,
} from "./apiVersionAdapter.js";

import {
  cacheKey, get as cacheGet, set as cacheSet, invalidate as cacheInvalidate,
  getStats, _resetCachingLayerForTest,
} from "./apiCachingLayer.js";

import {
  auditApiSecurity, getSecurityGrade, _resetSecurityAuditorForTest,
} from "./apiSecurityAuditor.js";

describe("v52 External API Mastery II", () => {
  // ─── apiWorkflowComposer ──────────────────────────────────────────────────
  describe("apiWorkflowComposer", () => {
    beforeEach(() => _resetWorkflowComposerForTest());

    it("should create and retrieve a workflow", () => {
      const wf = createWorkflow("Test Workflow", [
        { stepId: "step1", apiId: "api1", endpoint: "/users", method: "GET" },
        { stepId: "step2", apiId: "api2", endpoint: "/orders", method: "POST" },
      ]);
      expect(wf.workflowId).toBeDefined();
      expect(wf.steps).toHaveLength(2);
      expect(getWorkflow(wf.workflowId)).toBeDefined();
    });

    it("should execute a workflow and return completed status", () => {
      const wf = createWorkflow("Exec Workflow", [
        { stepId: "step1", apiId: "api1", endpoint: "/data", method: "GET" },
      ]);
      const exec = startExecution(wf.workflowId, { userId: "123" });
      expect(exec.status).toBe("completed");
      expect(exec.stepResults["step1"]).toBeDefined();
    });

    it("should list all workflows", () => {
      createWorkflow("WF1", []);
      createWorkflow("WF2", []);
      expect(listWorkflows().length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── apiDataTransformer ───────────────────────────────────────────────────
  describe("apiDataTransformer", () => {
    it("should apply field mappings with transforms", () => {
      const source = { user: { id: 42, name: "  Alice  " } };
      const result = applyMapping(source, [
        { source: "user.id", target: "userId", transform: "string" },
        { source: "user.name", target: "displayName", transform: "trim" },
      ]);
      expect(result.success).toBe(true);
      expect(result.data.userId).toBe("42");
      expect(result.data.displayName).toBe("Alice");
    });

    it("should report errors for missing paths", () => {
      const result = applyMapping({ a: 1 }, [{ source: "b.c", target: "x" }]);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should normalize response against schema", () => {
      const data = { id: "123", score: "99", active: "true" };
      const normalized = normalizeResponse(data, { id: "string", score: "number" });
      expect(normalized.score).toBe(99);
    });

    it("should flatten nested objects", () => {
      const flat = flattenObject({ a: { b: { c: 1 } }, d: 2 });
      expect(flat["a.b.c"]).toBe(1);
      expect(flat["d"]).toBe(2);
    });
  });

  // ─── apiErrorRecovery ─────────────────────────────────────────────────────
  describe("apiErrorRecovery", () => {
    beforeEach(() => _resetErrorRecoveryForTest());

    it("should recommend retry for 503 status", () => {
      configureRecovery({ apiId: "api1", maxRetries: 3, baseBackoffMs: 100, maxBackoffMs: 5000, retryOn: [503, 429], circuitBreakerThreshold: 10 });
      const decision = decideRecovery("api1", 503, 0);
      expect(decision.strategy).toBe("retry");
      expect(decision.retryAfterMs).toBeGreaterThan(0);
    });

    it("should open circuit after threshold failures", () => {
      configureRecovery({ apiId: "api2", maxRetries: 1, baseBackoffMs: 100, maxBackoffMs: 1000, retryOn: [500], circuitBreakerThreshold: 3 });
      decideRecovery("api2", 500, 0);
      decideRecovery("api2", 500, 0);
      decideRecovery("api2", 500, 0);
      expect(isCircuitOpen("api2")).toBe(true);
    });

    it("should use fallback when max retries exceeded", () => {
      configureRecovery({ apiId: "api3", maxRetries: 1, baseBackoffMs: 100, maxBackoffMs: 1000, retryOn: [500], circuitBreakerThreshold: 10, fallbackValue: { cached: true } });
      decideRecovery("api3", 500, 0); // attempt 0
      const decision = decideRecovery("api3", 500, 1); // attempt 1 = max
      expect(decision.strategy).toBe("fallback");
    });

    it("should reset circuit on success", () => {
      configureRecovery({ apiId: "api4", maxRetries: 1, baseBackoffMs: 100, maxBackoffMs: 1000, retryOn: [500], circuitBreakerThreshold: 3 });
      decideRecovery("api4", 500, 0);
      decideRecovery("api4", 500, 0);
      decideRecovery("api4", 500, 0);
      expect(isCircuitOpen("api4")).toBe(true);
      recordSuccess("api4");
      expect(isCircuitOpen("api4")).toBe(false);
    });
  });

  // ─── apiVersionAdapter ────────────────────────────────────────────────────
  describe("apiVersionAdapter", () => {
    beforeEach(() => _resetVersionAdapterForTest());

    it("should rename fields during migration", () => {
      registerMigration({ fromVersion: "v1", toVersion: "v2", fieldRenames: { user_id: "userId" }, fieldRemovals: [], fieldAdditions: {}, breakingChanges: [] });
      const result = adaptRequest({ user_id: "abc", name: "Alice" }, "v1", "v2");
      expect(result.adapted.userId).toBe("abc");
      expect(result.adapted.user_id).toBeUndefined();
    });

    it("should remove deprecated fields", () => {
      registerMigration({ fromVersion: "v1", toVersion: "v2", fieldRenames: {}, fieldRemovals: ["legacyField"], fieldAdditions: {}, breakingChanges: [] });
      const result = adaptRequest({ id: 1, legacyField: "old" }, "v1", "v2");
      expect(result.adapted.legacyField).toBeUndefined();
      expect(result.warnings.some(w => w.includes("legacyField"))).toBe(true);
    });

    it("should add new fields with defaults", () => {
      registerMigration({ fromVersion: "v1", toVersion: "v2", fieldRenames: {}, fieldRemovals: [], fieldAdditions: { version: "v2", active: true }, breakingChanges: [] });
      const result = adaptRequest({ id: 1 }, "v1", "v2");
      expect(result.adapted.version).toBe("v2");
      expect(result.adapted.active).toBe(true);
    });

    it("should generate compatibility report", () => {
      registerMigration({ fromVersion: "v1", toVersion: "v2", fieldRenames: { a: "b" }, fieldRemovals: ["c"], fieldAdditions: {}, breakingChanges: ["Auth scheme changed"] });
      const report = getCompatibilityReport("v1", "v2");
      expect(report.some(r => r.includes("renamed"))).toBe(true);
      expect(report.some(r => r.includes("breaking"))).toBe(true);
    });
  });

  // ─── apiCachingLayer ──────────────────────────────────────────────────────
  describe("apiCachingLayer", () => {
    beforeEach(() => _resetCachingLayerForTest());

    it("should cache and retrieve values", () => {
      const key = cacheKey("api1", "/users", { page: 1 });
      cacheSet(key, { data: [1, 2, 3] });
      const result = cacheGet(key);
      expect(result).toEqual({ data: [1, 2, 3] });
    });

    it("should return null for expired entries", async () => {
      const key = cacheKey("api1", "/data");
      cacheSet(key, "value", 1); // 1ms TTL
      await new Promise(r => setTimeout(r, 10));
      expect(cacheGet(key)).toBeNull();
    });

    it("should track hit/miss stats", () => {
      const key = cacheKey("api2", "/test");
      cacheSet(key, "data");
      cacheGet(key); // hit
      cacheGet("nonexistent"); // miss
      const stats = getStats();
      expect(stats.hits).toBeGreaterThanOrEqual(1);
      expect(stats.misses).toBeGreaterThanOrEqual(1);
    });

    it("should invalidate by pattern", () => {
      cacheSet(cacheKey("api3", "/a"), "val1");
      cacheSet(cacheKey("api3", "/b"), "val2");
      cacheSet(cacheKey("api4", "/c"), "val3");
      const count = cacheInvalidate("api3");
      expect(count).toBe(2);
    });
  });

  // ─── apiSecurityAuditor ───────────────────────────────────────────────────
  describe("apiSecurityAuditor", () => {
    beforeEach(() => _resetSecurityAuditorForTest());

    it("should give high score for secure API", () => {
      const report = auditApiSecurity({
        apiId: "api1",
        baseUrl: "https://api.example.com",
        hasAuth: true,
        authScheme: "bearer",
        endpoints: [{ path: "/users", method: "GET", requiresAuth: true }],
        tlsEnabled: true,
        rateLimitEnabled: true,
      });
      expect(report.score).toBeGreaterThanOrEqual(90);
      expect(getSecurityGrade(report.score)).toBe("A");
    });

    it("should flag HTTP as critical finding", () => {
      const report = auditApiSecurity({
        apiId: "api2",
        baseUrl: "http://api.example.com",
        hasAuth: true,
        endpoints: [],
        rateLimitEnabled: true,
      });
      const critical = report.findings.find(f => f.severity === "critical");
      expect(critical).toBeDefined();
      expect(report.score).toBeLessThan(100);
    });

    it("should flag missing auth", () => {
      const report = auditApiSecurity({
        apiId: "api3",
        baseUrl: "https://api.example.com",
        hasAuth: false,
        endpoints: [],
        rateLimitEnabled: true,
      });
      const highFinding = report.findings.find(f => f.severity === "high");
      expect(highFinding).toBeDefined();
    });
  });
});
