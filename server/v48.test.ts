/**
 * v48.test.ts — Sub-Agent Economy III
 * Tests: agentLoadBalancer, agentFaultTolerance, agentVersionControl,
 *        agentSecuritySandbox, agentPerformanceProfiler, agentOrchestrationEngine
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  registerNode, setStrategy, updateNodeLoad, markNodeHealth, selectAgent,
  getStats, _resetLoadBalancerForTest,
} from "./agentLoadBalancer.js";

import {
  registerCircuitBreaker, recordSuccess, recordFailure, canCall,
  calculateRetryDelay, getCircuitState, _resetFaultToleranceForTest,
} from "./agentFaultTolerance.js";

import {
  createSnapshot, rollback, diffSnapshots, getHistory, getLatestSnapshot,
  _resetVersionControlForTest,
} from "./agentVersionControl.js";

import {
  setPolicy, checkCapability, checkTopicAccess, checkNetworkAccess,
  checkResourceUsage, getViolations, _resetSecuritySandboxForTest,
} from "./agentSecuritySandbox.js";

import {
  recordSample, getReport, getTopPerformers, getSLACompliance, _resetProfilerForTest,
} from "./agentPerformanceProfiler.js";

import {
  registerWorkflow, startExecution, recordStageResult, finalizeExecution,
  checkTimeout, getExecution, getExecutionSummary, _resetOrchestrationEngineForTest,
} from "./agentOrchestrationEngine.js";

describe("v48 Sub-Agent Economy III", () => {
  // ─── agentLoadBalancer ─────────────────────────────────────────────────────
  describe("agentLoadBalancer", () => {
    beforeEach(() => _resetLoadBalancerForTest());

    it("should select the least-loaded agent", () => {
      registerNode({ agentId: "a1", capabilities: ["code"], currentLoad: 0.8, avgLatencyMs: 100, weight: 1, healthy: true });
      registerNode({ agentId: "a2", capabilities: ["code"], currentLoad: 0.2, avgLatencyMs: 100, weight: 1, healthy: true });
      setStrategy("least-loaded");
      expect(selectAgent(["code"])).toBe("a2");
    });

    it("should skip unhealthy nodes", () => {
      registerNode({ agentId: "a1", capabilities: ["code"], currentLoad: 0.1, avgLatencyMs: 50, weight: 1, healthy: false });
      registerNode({ agentId: "a2", capabilities: ["code"], currentLoad: 0.9, avgLatencyMs: 50, weight: 1, healthy: true });
      expect(selectAgent(["code"])).toBe("a2");
    });

    it("should return null if no eligible agents", () => {
      registerNode({ agentId: "a1", capabilities: ["code"], currentLoad: 0.5, avgLatencyMs: 100, weight: 1, healthy: true });
      expect(selectAgent(["quantum"])).toBeNull();
    });

    it("should select fastest agent with latency-aware strategy", () => {
      registerNode({ agentId: "a1", capabilities: ["code"], currentLoad: 0.5, avgLatencyMs: 200, weight: 1, healthy: true });
      registerNode({ agentId: "a2", capabilities: ["code"], currentLoad: 0.5, avgLatencyMs: 50, weight: 1, healthy: true });
      setStrategy("latency-aware");
      expect(selectAgent(["code"])).toBe("a2");
    });
  });

  // ─── agentFaultTolerance ───────────────────────────────────────────────────
  describe("agentFaultTolerance", () => {
    beforeEach(() => _resetFaultToleranceForTest());

    it("should open circuit after threshold failures", () => {
      registerCircuitBreaker("a1", 3, 60000);
      recordFailure("a1");
      recordFailure("a1");
      recordFailure("a1");
      expect(getCircuitState("a1")).toBe("open");
      expect(canCall("a1")).toBe(false);
    });

    it("should close circuit after recovery", () => {
      registerCircuitBreaker("a1", 2, 60000);
      recordFailure("a1");
      recordFailure("a1"); // opens
      // Manually set to half-open by simulating timeout
      const cb = { state: "half-open" };
      // Use canCall which transitions to half-open after timeout
      recordSuccess("a1"); // This won't close because it's open, not half-open
      // Test that success in half-open closes it
      registerCircuitBreaker("a2", 1, 0); // 0ms timeout
      recordFailure("a2"); // opens
      expect(canCall("a2")).toBe(true); // transitions to half-open
      recordSuccess("a2"); // closes
      expect(getCircuitState("a2")).toBe("closed");
    });

    it("should calculate exponential backoff delay", () => {
      const policy = { maxAttempts: 5, baseDelayMs: 100, backoffMultiplier: 2, maxDelayMs: 3000 };
      expect(calculateRetryDelay(1, policy)).toBe(100);
      expect(calculateRetryDelay(2, policy)).toBe(200);
      expect(calculateRetryDelay(3, policy)).toBe(400);
      expect(calculateRetryDelay(10, policy)).toBe(3000); // capped at max
    });
  });

  // ─── agentVersionControl ──────────────────────────────────────────────────
  describe("agentVersionControl", () => {
    beforeEach(() => _resetVersionControlForTest());

    it("should create versioned snapshots", () => {
      createSnapshot("agent1", ["code", "test"]);
      createSnapshot("agent1", ["code", "test", "deploy"]);
      const history = getHistory("agent1");
      expect(history).toHaveLength(2);
      expect(history[1].version).toBe(2);
    });

    it("should diff two snapshots", () => {
      createSnapshot("agent1", ["code", "test"]);
      createSnapshot("agent1", ["code", "deploy"]);
      const diff = diffSnapshots("agent1", 1, 2);
      expect(diff!.added).toContain("deploy");
      expect(diff!.removed).toContain("test");
      expect(diff!.unchanged).toContain("code");
    });

    it("should rollback to a previous version", () => {
      createSnapshot("agent1", ["code"]);
      createSnapshot("agent1", ["code", "test"]);
      rollback("agent1", 1);
      const latest = getLatestSnapshot("agent1");
      expect(latest!.capabilities).toContain("code");
      expect(latest!.capabilities).not.toContain("test");
    });
  });

  // ─── agentSecuritySandbox ─────────────────────────────────────────────────
  describe("agentSecuritySandbox", () => {
    beforeEach(() => _resetSecuritySandboxForTest());

    it("should allow permitted capabilities", () => {
      setPolicy({ agentId: "a1", allowedCapabilities: ["code", "test"], maxMemoryMb: 512, maxCpuPct: 80, networkAccess: true, fileSystemAccess: false, allowedTopics: [] });
      expect(checkCapability("a1", "code")).toBe(true);
    });

    it("should block disallowed capabilities and log violation", () => {
      setPolicy({ agentId: "a1", allowedCapabilities: ["code"], maxMemoryMb: 512, maxCpuPct: 80, networkAccess: false, fileSystemAccess: false, allowedTopics: [] });
      expect(checkCapability("a1", "admin")).toBe(false);
      expect(getViolations("a1")).toHaveLength(1);
    });

    it("should block network access when denied", () => {
      setPolicy({ agentId: "a1", allowedCapabilities: [], maxMemoryMb: 512, maxCpuPct: 80, networkAccess: false, fileSystemAccess: false, allowedTopics: [] });
      expect(checkNetworkAccess("a1")).toBe(false);
    });

    it("should enforce resource limits", () => {
      setPolicy({ agentId: "a1", allowedCapabilities: [], maxMemoryMb: 256, maxCpuPct: 50, networkAccess: true, fileSystemAccess: false, allowedTopics: [] });
      expect(checkResourceUsage("a1", 512, 30)).toBe(false); // memory exceeded
      expect(checkResourceUsage("a1", 100, 30)).toBe(true);  // within limits
    });
  });

  // ─── agentPerformanceProfiler ─────────────────────────────────────────────
  describe("agentPerformanceProfiler", () => {
    beforeEach(() => _resetProfilerForTest());

    it("should compute latency percentiles", () => {
      for (let i = 1; i <= 100; i++) recordSample("a1", "task", i * 10, true);
      const report = getReport("a1", "task");
      expect(report!.p50Ms).toBeGreaterThan(0);
      expect(report!.p95Ms).toBeGreaterThan(report!.p50Ms);
      expect(report!.p99Ms).toBeGreaterThan(report!.p95Ms);
    });

    it("should compute success rate correctly", () => {
      recordSample("a2", "op", 100, true);
      recordSample("a2", "op", 100, true);
      recordSample("a2", "op", 100, false);
      const report = getReport("a2", "op");
      expect(report!.successRate).toBeCloseTo(0.667, 2);
    });

    it("should compute SLA compliance", () => {
      for (let i = 0; i < 8; i++) recordSample("a3", "op", 50, true);
      for (let i = 0; i < 2; i++) recordSample("a3", "op", 200, true);
      const compliance = getSLACompliance("a3", 100);
      expect(compliance).toBe(0.8);
    });
  });

  // ─── agentOrchestrationEngine ─────────────────────────────────────────────
  describe("agentOrchestrationEngine", () => {
    beforeEach(() => _resetOrchestrationEngineForTest());

    it("should register and start a workflow", () => {
      registerWorkflow({
        workflowId: "wf1", name: "Deploy Pipeline", parallelism: 2, timeoutMs: 60000,
        stages: [{ stageId: "s1", name: "Build", requiredCapabilities: ["docker"], inputFrom: undefined, retries: 2, timeoutMs: 10000 }],
      });
      const exec = startExecution("wf1");
      expect(exec).not.toBeNull();
      expect(exec!.status).toBe("running");
    });

    it("should record stage results and finalize", () => {
      registerWorkflow({
        workflowId: "wf2", name: "Test Pipeline", parallelism: 1, timeoutMs: 60000,
        stages: [{ stageId: "s1", name: "Test", requiredCapabilities: ["test"], inputFrom: undefined, retries: 1, timeoutMs: 5000 }],
      });
      const exec = startExecution("wf2")!;
      recordStageResult(exec.executionId, "s1", { passed: 42 }, 1200, 1);
      finalizeExecution(exec.executionId, true);
      expect(getExecution(exec.executionId)!.status).toBe("completed");
    });

    it("should detect timeout", () => {
      registerWorkflow({
        workflowId: "wf3", name: "Slow Pipeline", parallelism: 1, timeoutMs: 1,
        stages: [{ stageId: "s1", name: "Slow", requiredCapabilities: [], inputFrom: undefined, retries: 0, timeoutMs: 1 }],
      });
      const exec = startExecution("wf3")!;
      return new Promise<void>(resolve => setTimeout(() => {
        expect(checkTimeout(exec.executionId)).toBe(true);
        expect(getExecution(exec.executionId)!.status).toBe("timed-out");
        resolve();
      }, 10));
    });
  });
});
