/**
 * v49.test.ts — Sub-Agent Economy IV
 * Tests: agentGoalAlignment, agentEthicsEnforcer, agentAuditLogger,
 *        agentRollbackManager, agentSelfHealer, agentEconomyMonitor
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  registerGoalVector, evaluateAlignment, updateObjectiveValue,
  getAlignmentScore, getViolations as getAlignmentViolations, _resetGoalAlignmentForTest,
} from "./agentGoalAlignment.js";

import {
  evaluateAction, getAuditLog as getEthicsLog, getBlockedActionCount,
  addRule, _resetEthicsEnforcerForTest,
} from "./agentEthicsEnforcer.js";

import {
  logEvent, queryLog, verifyIntegrity, getEventCount, _resetAuditLoggerForTest,
} from "./agentAuditLogger.js";

import {
  createCheckpoint, rollbackToCheckpoint, listCheckpoints,
  pruneOldCheckpoints, _resetRollbackManagerForTest,
} from "./agentRollbackManager.js";

import {
  evaluateHealth, unquarantine, getHealingRecord, getHealingHistory,
  _resetSelfHealerForTest,
} from "./agentSelfHealer.js";

import {
  recordSnapshot, getTrend, getLatestSnapshot, getAlerts,
  getEconomyHealth, _resetEconomyMonitorForTest,
} from "./agentEconomyMonitor.js";

describe("v49 Sub-Agent Economy IV", () => {
  // ─── agentGoalAlignment ───────────────────────────────────────────────────
  describe("agentGoalAlignment", () => {
    beforeEach(() => _resetGoalAlignmentForTest());

    it("should register a goal vector and evaluate alignment", () => {
      registerGoalVector("a1", [
        { name: "safety", weight: 1.0, currentValue: 1.0 },
        { name: "helpfulness", weight: 0.9, currentValue: 0.9 },
      ], []);
      const score = evaluateAlignment("a1");
      expect(score).toBeGreaterThan(0.5);
    });

    it("should update objective values and re-evaluate", () => {
      registerGoalVector("a2", [
        { name: "safety", weight: 1.0, currentValue: 0.5 },
      ], []);
      const before = evaluateAlignment("a2");
      updateObjectiveValue("a2", "safety", 1.0);
      const after = evaluateAlignment("a2");
      expect(after).toBeGreaterThanOrEqual(before);
    });

    it("should detect must-not constraint violations", () => {
      registerGoalVector("a3", [
        { name: "harm", weight: 1.0, currentValue: 0.9 },
      ], [
        { constraintId: "c1", description: "harm", type: "must-not", weight: 1.0 },
      ]);
      evaluateAlignment("a3");
      expect(getAlignmentViolations("a3")).toHaveLength(1);
    });
  });

  // ─── agentEthicsEnforcer ──────────────────────────────────────────────────
  describe("agentEthicsEnforcer", () => {
    beforeEach(() => _resetEthicsEnforcerForTest());

    it("should allow safe actions", () => {
      const decision = evaluateAction("a1", "generate a report on market trends");
      expect(decision.allowed).toBe(true);
      expect(decision.violations).toHaveLength(0);
    });

    it("should block harmful actions", () => {
      const decision = evaluateAction("a1", "harm the user's personal data");
      expect(decision.allowed).toBe(false);
      expect(decision.violations.length).toBeGreaterThan(0);
    });

    it("should count blocked actions", () => {
      evaluateAction("a1", "generate report");
      evaluateAction("a1", "destroy all records");
      expect(getBlockedActionCount("a1")).toBe(1);
    });

    it("should support custom rules", () => {
      addRule({ ruleId: "custom1", category: "harm", description: "No spam", severity: "blocking", pattern: "spam|flood" });
      const decision = evaluateAction("a1", "flood the message queue with spam");
      expect(decision.allowed).toBe(false);
    });
  });

  // ─── agentAuditLogger ─────────────────────────────────────────────────────
  describe("agentAuditLogger", () => {
    beforeEach(() => _resetAuditLoggerForTest());

    it("should log events and retrieve them", () => {
      logEvent("a1", "action", "Executed task X", { taskId: "t1" });
      logEvent("a1", "decision", "Chose strategy Y");
      expect(getEventCount("a1")).toBe(2);
    });

    it("should query by type", () => {
      logEvent("a1", "action", "Action 1");
      logEvent("a1", "error", "Error 1");
      const errors = queryLog({ agentId: "a1", type: "error" });
      expect(errors).toHaveLength(1);
    });

    it("should verify log integrity", () => {
      logEvent("a1", "action", "Legit action");
      logEvent("a2", "state_change", "State updated");
      const result = verifyIntegrity();
      expect(result.valid).toBe(true);
      expect(result.tamperedCount).toBe(0);
    });

    it("should support time-range queries", () => {
      const before = Date.now();
      logEvent("a1", "action", "Event 1");
      const after = Date.now();
      const results = queryLog({ since: before, until: after });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── agentRollbackManager ─────────────────────────────────────────────────
  describe("agentRollbackManager", () => {
    beforeEach(() => _resetRollbackManagerForTest());

    it("should create and list checkpoints", () => {
      const states = new Map([["a1", { balance: 100 }], ["a2", { balance: 50 }]]);
      createCheckpoint("Pre-deployment", "orchestrator", states);
      const list = listCheckpoints();
      expect(list).toHaveLength(1);
      expect(list[0].description).toBe("Pre-deployment");
    });

    it("should rollback to a checkpoint", () => {
      const states = new Map([["a1", { balance: 100 }]]);
      const cp = createCheckpoint("Stable state", "monitor", states);
      const result = rollbackToCheckpoint(cp.checkpointId);
      expect(result.success).toBe(true);
      expect(result.agentsRestored).toBe(1);
    });

    it("should fail gracefully for unknown checkpoint", () => {
      const result = rollbackToCheckpoint("nonexistent");
      expect(result.success).toBe(false);
    });

    it("should prune old checkpoints", () => {
      const states = new Map<string, Record<string, unknown>>();
      createCheckpoint("cp1", "test", states);
      createCheckpoint("cp2", "test", states);
      createCheckpoint("cp3", "test", states);
      const pruned = pruneOldCheckpoints(2);
      expect(pruned).toBe(1);
      expect(listCheckpoints()).toHaveLength(2);
    });
  });

  // ─── agentSelfHealer ──────────────────────────────────────────────────────
  describe("agentSelfHealer", () => {
    beforeEach(() => _resetSelfHealerForTest());

    it("should return none for healthy agents", () => {
      const decision = evaluateHealth({ agentId: "a1", errorRate: 0.01, memoryPressure: 0.3, latencySpike: false, consecutiveFailures: 0, lastHeartbeatMs: 1000 });
      expect(decision.action).toBe("none");
    });

    it("should restart agent with no heartbeat", () => {
      const decision = evaluateHealth({ agentId: "a2", errorRate: 0.1, memoryPressure: 0.3, latencySpike: false, consecutiveFailures: 0, lastHeartbeatMs: 60000 });
      expect(decision.action).toBe("restart");
    });

    it("should quarantine critically failing agent", () => {
      const decision = evaluateHealth({ agentId: "a3", errorRate: 0.95, memoryPressure: 0.5, latencySpike: false, consecutiveFailures: 12, lastHeartbeatMs: 1000 });
      expect(decision.action).toBe("quarantine");
      expect(getHealingRecord("a3")!.quarantined).toBe(true);
    });

    it("should unquarantine an agent", () => {
      evaluateHealth({ agentId: "a4", errorRate: 0.95, memoryPressure: 0.5, latencySpike: false, consecutiveFailures: 12, lastHeartbeatMs: 1000 });
      expect(unquarantine("a4")).toBe(true);
      expect(getHealingRecord("a4")!.quarantined).toBe(false);
    });

    it("should rebalance under memory pressure", () => {
      const decision = evaluateHealth({ agentId: "a5", errorRate: 0.05, memoryPressure: 0.9, latencySpike: false, consecutiveFailures: 0, lastHeartbeatMs: 1000 });
      expect(decision.action).toBe("rebalance");
    });
  });

  // ─── agentEconomyMonitor ──────────────────────────────────────────────────
  describe("agentEconomyMonitor", () => {
    beforeEach(() => _resetEconomyMonitorForTest());

    it("should record snapshots and return latest", () => {
      recordSnapshot({ totalAgents: 10, activeAgents: 8, idleAgents: 2, totalTasksCompleted: 100, totalComputeUnitsSpent: 500, avgTaskDurationMs: 200, marketClearingRate: 0.9, costEfficiency: 0.2 });
      const latest = getLatestSnapshot();
      expect(latest).not.toBeNull();
      expect(latest!.activeAgents).toBe(8);
    });

    it("should raise overload alert when utilization > 95%", () => {
      recordSnapshot({ totalAgents: 10, activeAgents: 10, idleAgents: 0, totalTasksCompleted: 50, totalComputeUnitsSpent: 200, avgTaskDurationMs: 300, marketClearingRate: 0.8, costEfficiency: 0.25 });
      const criticalAlerts = getAlerts("critical");
      expect(criticalAlerts.some(a => a.type === "overload")).toBe(true);
    });

    it("should detect improving throughput trend", () => {
      for (let i = 1; i <= 6; i++) {
        recordSnapshot({ totalAgents: 10, activeAgents: 5, idleAgents: 5, totalTasksCompleted: i * 10, totalComputeUnitsSpent: 100, avgTaskDurationMs: 200, marketClearingRate: 0.8, costEfficiency: i * 0.01 });
      }
      const trend = getTrend("costEfficiency");
      expect(trend).toBe("improving");
    });

    it("should return healthy economy status with no alerts", () => {
      recordSnapshot({ totalAgents: 10, activeAgents: 5, idleAgents: 5, totalTasksCompleted: 100, totalComputeUnitsSpent: 200, avgTaskDurationMs: 100, marketClearingRate: 0.95, costEfficiency: 0.5 });
      expect(getEconomyHealth()).toBe("healthy");
    });
  });
});
