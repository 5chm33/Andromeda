/**
 * v54.test.ts — External API Mastery IV
 * Tests: apiKnowledgeBase, apiRecommendationEngine, apiCompositionPlanner,
 *        apiDeploymentAutomator, apiMonitoringDashboard, apiSelfHealingProxy
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  addKnowledge, searchKnowledge, getKnowledgeByCategory, updateKnowledge,
  _resetKnowledgeBaseForTest,
} from "./apiKnowledgeBase.js";

import {
  registerApiProfile, getRecommendations,
  _resetRecommendationEngineForTest,
} from "./apiRecommendationEngine.js";

import {
  createCompositionPlan, getExecutionOrder,
  _resetCompositionPlannerForTest,
} from "./apiCompositionPlanner.js";

import {
  startDeployment, recordHealthCheck, finalizeDeployment,
  getDeploymentRecord, getDeploymentsByApi, _resetDeploymentAutomatorForTest,
} from "./apiDeploymentAutomator.js";

import {
  recordMetricSnapshot, addAlertRule, getDashboardView, resolveAlert,
  _resetMonitoringDashboardForTest,
} from "./apiMonitoringDashboard.js";

import {
  registerProxy, simulateCall, resetCircuit, getProxyHealth,
  _resetSelfHealingProxyForTest,
} from "./apiSelfHealingProxy.js";

describe("v54 External API Mastery IV", () => {
  // ─── apiKnowledgeBase ─────────────────────────────────────────────────────
  describe("apiKnowledgeBase", () => {
    beforeEach(() => _resetKnowledgeBaseForTest());

    it("should add and search knowledge entries", () => {
      addKnowledge("api1", "documentation", "Authentication Guide", "Use Bearer tokens for all requests", ["auth", "security"]);
      const results = searchKnowledge("authentication", "api1");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entry.title).toBe("Authentication Guide");
    });

    it("should return entries by category", () => {
      addKnowledge("api1", "best-practice", "Rate Limiting", "Always implement exponential backoff", ["rate-limit"]);
      addKnowledge("api1", "issue", "Known Bug", "Pagination breaks at page 100", ["pagination"]);
      const practices = getKnowledgeByCategory("api1", "best-practice");
      expect(practices).toHaveLength(1);
      expect(practices[0].title).toBe("Rate Limiting");
    });

    it("should update knowledge entries", () => {
      const entry = addKnowledge("api1", "documentation", "Old Docs", "Old content", [], 0.5);
      const updated = updateKnowledge(entry.entryId, { content: "New content", confidence: 0.95 });
      expect(updated).toBe(true);
    });
  });

  // ─── apiRecommendationEngine ──────────────────────────────────────────────
  describe("apiRecommendationEngine", () => {
    beforeEach(() => _resetRecommendationEngineForTest());

    it("should recommend APIs matching required capabilities", () => {
      registerApiProfile({ apiId: "api1", name: "Data API", capabilities: ["data-retrieval", "search", "filtering"], domains: ["analytics"], avgLatencyMs: 50, costPerCall: 0.001, reliabilityScore: 0.99 });
      registerApiProfile({ apiId: "api2", name: "Auth API", capabilities: ["authentication", "authorization"], domains: ["security"], avgLatencyMs: 20, costPerCall: 0.0005, reliabilityScore: 0.999 });
      const recs = getRecommendations({ requiredCapabilities: ["data-retrieval"] });
      expect(recs.length).toBeGreaterThan(0);
      expect(recs[0].apiId).toBe("api1");
    });

    it("should filter by max latency", () => {
      registerApiProfile({ apiId: "api1", name: "Slow API", capabilities: ["search"], domains: [], avgLatencyMs: 500, costPerCall: 0.001, reliabilityScore: 0.9 });
      registerApiProfile({ apiId: "api2", name: "Fast API", capabilities: ["search"], domains: [], avgLatencyMs: 30, costPerCall: 0.001, reliabilityScore: 0.9 });
      const recs = getRecommendations({ requiredCapabilities: ["search"], maxLatencyMs: 100 });
      expect(recs.some(r => r.apiId === "api1")).toBe(false);
      expect(recs.some(r => r.apiId === "api2")).toBe(true);
    });
  });

  // ─── apiCompositionPlanner ────────────────────────────────────────────────
  describe("apiCompositionPlanner", () => {
    beforeEach(() => _resetCompositionPlannerForTest());

    it("should create a composition plan with correct entry/exit nodes", () => {
      const plan = createCompositionPlan("Test Plan", [
        { nodeId: "n1", apiId: "api1", endpoint: "/users", method: "GET" },
        { nodeId: "n2", apiId: "api2", endpoint: "/orders", method: "GET", inputFrom: ["n1"] },
        { nodeId: "n3", apiId: "api3", endpoint: "/notify", method: "POST", inputFrom: ["n2"] },
      ]);
      expect(plan.entryNodes).toContain("n1");
      expect(plan.exitNodes).toContain("n3");
    });

    it("should return topologically sorted execution order", () => {
      const plan = createCompositionPlan("Ordered Plan", [
        { nodeId: "n1", apiId: "api1", endpoint: "/a", method: "GET" },
        { nodeId: "n2", apiId: "api2", endpoint: "/b", method: "GET", inputFrom: ["n1"] },
      ]);
      const order = getExecutionOrder(plan.planId);
      expect(order.indexOf("n1")).toBeLessThan(order.indexOf("n2"));
    });

    it("should throw on invalid node references", () => {
      expect(() => createCompositionPlan("Bad Plan", [
        { nodeId: "n1", apiId: "api1", endpoint: "/a", method: "GET", inputFrom: ["nonexistent"] },
      ])).toThrow();
    });
  });

  // ─── apiDeploymentAutomator ───────────────────────────────────────────────
  describe("apiDeploymentAutomator", () => {
    beforeEach(() => _resetDeploymentAutomatorForTest());

    it("should start and finalize a successful deployment", () => {
      const record = startDeployment({ apiId: "api1", version: "2.0.0", stage: "staging", rollbackOnFailure: true });
      expect(record.status).toBe("deploying");
      recordHealthCheck(record.deploymentId, true);
      const final = finalizeDeployment(record.deploymentId, true);
      expect(final.status).toBe("healthy");
      expect(final.healthChecks).toHaveLength(1);
    });

    it("should record rollback on failure", () => {
      const record = startDeployment({ apiId: "api1", version: "2.1.0", stage: "production", rollbackOnFailure: true });
      const final = finalizeDeployment(record.deploymentId, false, "Health check failed");
      expect(final.status).toBe("rolled-back");
      expect(final.rollbackReason).toBe("Health check failed");
    });

    it("should list deployments by API", () => {
      startDeployment({ apiId: "api2", version: "1.0.0", stage: "staging", rollbackOnFailure: false });
      startDeployment({ apiId: "api2", version: "1.1.0", stage: "production", rollbackOnFailure: false });
      expect(getDeploymentsByApi("api2")).toHaveLength(2);
    });
  });

  // ─── apiMonitoringDashboard ───────────────────────────────────────────────
  describe("apiMonitoringDashboard", () => {
    beforeEach(() => _resetMonitoringDashboardForTest());

    it("should record snapshots and generate dashboard", () => {
      recordMetricSnapshot({ apiId: "api1", requestCount: 1000, errorCount: 5, avgLatencyMs: 50, p99LatencyMs: 200, uptimePercent: 99.9 });
      const dashboard = getDashboardView();
      expect(dashboard.apis).toHaveLength(1);
      expect(dashboard.apis[0].apiId).toBe("api1");
      expect(dashboard.apis[0].errorRate).toBeCloseTo(0.005);
    });

    it("should trigger alert when error rate exceeds threshold", () => {
      addAlertRule({ apiId: "api1", metric: "errorRate", threshold: 0.05, operator: "gt", severity: "critical" });
      recordMetricSnapshot({ apiId: "api1", requestCount: 100, errorCount: 10, avgLatencyMs: 50, p99LatencyMs: 100, uptimePercent: 99 });
      const dashboard = getDashboardView();
      expect(dashboard.totalActiveAlerts).toBeGreaterThan(0);
      expect(dashboard.apis[0].status).toBe("down");
    });

    it("should resolve alerts", () => {
      addAlertRule({ apiId: "api1", metric: "latency", threshold: 100, operator: "gt", severity: "warning" });
      recordMetricSnapshot({ apiId: "api1", requestCount: 100, errorCount: 0, avgLatencyMs: 200, p99LatencyMs: 500, uptimePercent: 100 });
      const dashboard = getDashboardView();
      const alertId = dashboard.apis[0].activeAlerts[0]?.alertId;
      expect(alertId).toBeDefined();
      expect(resolveAlert(alertId!)).toBe(true);
    });
  });

  // ─── apiSelfHealingProxy ──────────────────────────────────────────────────
  describe("apiSelfHealingProxy", () => {
    beforeEach(() => _resetSelfHealingProxyForTest());

    it("should record successful calls and track health", () => {
      registerProxy({ proxyId: "p1", primaryEndpoint: "https://api.example.com", backupEndpoints: [], maxRetries: 3, retryDelayMs: 100, circuitBreakerThreshold: 5, healCheckIntervalMs: 5000 });
      simulateCall("p1", true);
      simulateCall("p1", true);
      const health = getProxyHealth("p1");
      expect(health?.successRate).toBe(1.0);
      expect(health?.circuitOpen).toBe(false);
    });

    it("should open circuit after threshold failures", () => {
      registerProxy({ proxyId: "p2", primaryEndpoint: "https://api.example.com", backupEndpoints: ["https://backup.example.com"], maxRetries: 3, retryDelayMs: 100, circuitBreakerThreshold: 3, healCheckIntervalMs: 5000 });
      simulateCall("p2", false);
      simulateCall("p2", false);
      simulateCall("p2", false);
      const health = getProxyHealth("p2");
      expect(health?.circuitOpen).toBe(true);
    });

    it("should use backup endpoint when circuit is open", () => {
      registerProxy({ proxyId: "p3", primaryEndpoint: "https://primary.example.com", backupEndpoints: ["https://backup.example.com"], maxRetries: 3, retryDelayMs: 100, circuitBreakerThreshold: 2, healCheckIntervalMs: 5000 });
      simulateCall("p3", false);
      simulateCall("p3", false); // opens circuit
      const result = simulateCall("p3", true);
      expect(result.usedBackup).toBe(true);
    });

    it("should reset circuit and restore primary", () => {
      registerProxy({ proxyId: "p4", primaryEndpoint: "https://primary.example.com", backupEndpoints: [], maxRetries: 3, retryDelayMs: 100, circuitBreakerThreshold: 2, healCheckIntervalMs: 5000 });
      simulateCall("p4", false);
      simulateCall("p4", false);
      expect(getProxyHealth("p4")?.circuitOpen).toBe(true);
      resetCircuit("p4");
      expect(getProxyHealth("p4")?.circuitOpen).toBe(false);
    });
  });
});
