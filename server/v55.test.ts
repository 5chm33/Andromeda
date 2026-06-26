/**
 * v55.test.ts — The Grand Unification
 * Tests: universalAgentInterface, omniscientContextManager, perpetualLearningEngine,
 *        adaptiveGoalHierarchy, transcendentSelfModel, grandUnificationMonitor
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  registerAgent, registerHandler, sendMessage, getAgentStatus,
  listActiveAgents, getMessageLog, updateAgentStatus,
  _resetUniversalAgentInterfaceForTest,
} from "./universalAgentInterface.js";

import {
  setContext, getContext, queryContext, removeContext, getContextSnapshot,
  _resetOmniscientContextForTest,
} from "./omniscientContextManager.js";

import {
  recordLearningEvent, getLearnedPatterns, getLearningStats,
  _resetPerpetualLearningForTest,
} from "./perpetualLearningEngine.js";

import {
  createGoal, updateGoalProgress, adaptGoal,
  getGoalHierarchy, getActiveGoals, reprioritizeGoals,
  _resetGoalHierarchyForTest,
} from "./adaptiveGoalHierarchy.js";

import {
  registerCapability, updateCapabilityProficiency, captureSnapshot,
  getCapabilityByName, getSnapshotHistory,
  _resetSelfModelForTest,
} from "./transcendentSelfModel.js";

import {
  registerSubsystem, updateSubsystemMetrics, recordSystemEvent,
  generateUnifiedReport, getReportHistory, getSystemEvents,
  _resetGrandUnificationMonitorForTest,
} from "./grandUnificationMonitor.js";

describe("v55 The Grand Unification", () => {
  // ─── universalAgentInterface ──────────────────────────────────────────────
  describe("universalAgentInterface", () => {
    beforeEach(() => _resetUniversalAgentInterfaceForTest());

    it("should register agents and list active ones", () => {
      registerAgent({ agentId: "agent1", name: "RSI Engine", capabilities: ["self-improve"], version: "55.0.0", status: "active" });
      registerAgent({ agentId: "agent2", name: "Safety Guard", capabilities: ["safety"], version: "55.0.0", status: "idle" });
      const active = listActiveAgents();
      expect(active.length).toBe(2);
    });

    it("should send messages and dispatch to handlers", () => {
      registerAgent({ agentId: "sender", name: "Sender", capabilities: [], version: "1.0", status: "active" });
      registerAgent({ agentId: "receiver", name: "Receiver", capabilities: [], version: "1.0", status: "active" });
      const received: string[] = [];
      registerHandler({ agentId: "receiver", messageType: "command", handler: (msg) => { received.push(msg.messageId); return null; } });
      const msg = sendMessage({ type: "command", fromAgent: "sender", toAgent: "receiver", payload: { action: "start" } });
      expect(received).toContain(msg.messageId);
    });

    it("should broadcast messages to all agents", () => {
      registerAgent({ agentId: "a1", name: "A1", capabilities: [], version: "1.0", status: "active" });
      registerAgent({ agentId: "a2", name: "A2", capabilities: [], version: "1.0", status: "active" });
      const received: string[] = [];
      registerHandler({ agentId: "a1", messageType: "*", handler: (msg) => { received.push("a1"); return null; } });
      registerHandler({ agentId: "a2", messageType: "*", handler: (msg) => { received.push("a2"); return null; } });
      sendMessage({ type: "event", fromAgent: "a1", toAgent: "broadcast", payload: {} });
      expect(received).toContain("a1");
      expect(received).toContain("a2");
    });

    it("should update agent status", () => {
      registerAgent({ agentId: "agent3", name: "Worker", capabilities: [], version: "1.0", status: "idle" });
      updateAgentStatus("agent3", "overloaded");
      expect(getAgentStatus("agent3")?.status).toBe("overloaded");
    });

    it("should maintain message log", () => {
      registerAgent({ agentId: "logger", name: "Logger", capabilities: [], version: "1.0", status: "active" });
      sendMessage({ type: "heartbeat", fromAgent: "logger", toAgent: "broadcast", payload: {} });
      sendMessage({ type: "heartbeat", fromAgent: "logger", toAgent: "broadcast", payload: {} });
      expect(getMessageLog("logger").length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── omniscientContextManager ─────────────────────────────────────────────
  describe("omniscientContextManager", () => {
    beforeEach(() => _resetOmniscientContextForTest());

    it("should set and retrieve context entries", () => {
      setContext("fact", "system.version", "55.0.0", "init");
      const entry = getContext("system.version");
      expect(entry?.value).toBe("55.0.0");
      expect(entry?.type).toBe("fact");
    });

    it("should expire entries after TTL", async () => {
      setContext("observation", "temp.value", 42, "sensor", 1.0, [], 5);
      await new Promise(r => setTimeout(r, 20));
      expect(getContext("temp.value")).toBeNull();
    });

    it("should query by type and tags", () => {
      setContext("goal", "goal.primary", "maximize performance", "planner", 0.9, ["performance"]);
      setContext("fact", "fact.uptime", 99.9, "monitor", 1.0, ["health"]);
      const goals = queryContext({ type: "goal" });
      expect(goals.length).toBe(1);
      expect(goals[0].key).toBe("goal.primary");
    });

    it("should return context snapshot", () => {
      setContext("fact", "a", 1, "src");
      setContext("fact", "b", 2, "src");
      const snapshot = getContextSnapshot();
      expect(snapshot["a"]).toBe(1);
      expect(snapshot["b"]).toBe(2);
    });
  });

  // ─── perpetualLearningEngine ──────────────────────────────────────────────
  describe("perpetualLearningEngine", () => {
    beforeEach(() => _resetPerpetualLearningForTest());

    it("should record events and compute stats", () => {
      recordLearningEvent("planning", { task: "optimize" }, { plan: "A" }, "success", 0.9);
      recordLearningEvent("planning", { task: "route" }, { plan: "B" }, "failure", -0.3);
      const stats = getLearningStats();
      expect(stats.totalEvents).toBe(2);
      expect(stats.successRate).toBe(0.5);
    });

    it("should build learned patterns from events", () => {
      for (let i = 0; i < 5; i++) {
        recordLearningEvent("coding", { lang: "ts" }, { result: "ok" }, "success", 0.8);
      }
      const patterns = getLearnedPatterns("coding");
      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns[0].occurrences).toBe(5);
    });

    it("should track top domains", () => {
      recordLearningEvent("domainA", {}, {}, "success", 0.9);
      recordLearningEvent("domainA", {}, {}, "success", 0.8);
      recordLearningEvent("domainB", {}, {}, "failure", -0.2);
      const stats = getLearningStats();
      expect(stats.topDomains[0].domain).toBe("domainA");
    });
  });

  // ─── adaptiveGoalHierarchy ────────────────────────────────────────────────
  describe("adaptiveGoalHierarchy", () => {
    beforeEach(() => _resetGoalHierarchyForTest());

    it("should create goals and sub-goals", () => {
      const parent = createGoal("Maximize Performance", "Improve all metrics", "high", ["p99 < 100ms"]);
      const child = createGoal("Reduce Latency", "Cut API latency", "high", ["avg < 50ms"], parent.goalId);
      const hierarchy = getGoalHierarchy(parent.goalId);
      expect(hierarchy.length).toBe(2);
      expect(hierarchy.some(g => g.goalId === child.goalId)).toBe(true);
    });

    it("should update progress and auto-complete at 100%", () => {
      const goal = createGoal("Test Goal", "desc", "medium", []);
      updateGoalProgress(goal.goalId, 1.0);
      const active = getActiveGoals();
      expect(active.some(g => g.goalId === goal.goalId)).toBe(false);
    });

    it("should adapt goals with new priority", () => {
      const goal = createGoal("Adapt Me", "desc", "low", []);
      adaptGoal(goal.goalId, "Context changed — escalating", "critical");
      const hierarchy = getGoalHierarchy();
      const adapted = hierarchy.find(g => g.goalId === goal.goalId);
      expect(adapted?.priority).toBe("critical");
      expect(adapted?.adaptations).toHaveLength(1);
    });

    it("should reprioritize goals near deadline", () => {
      const goal = createGoal("Urgent", "desc", "low", [], undefined, Date.now() + 1800000); // 30min deadline
      const reprioritized = reprioritizeGoals();
      const found = reprioritized.find(g => g.goalId === goal.goalId);
      expect(found?.priority).toBe("critical");
    });
  });

  // ─── transcendentSelfModel ────────────────────────────────────────────────
  describe("transcendentSelfModel", () => {
    beforeEach(() => _resetSelfModelForTest());

    it("should register and update capabilities", () => {
      const cap = registerCapability("TypeScript Coding", "engineering", 0.7);
      updateCapabilityProficiency(cap.capabilityId, 0.9, 0.95);
      const found = getCapabilityByName("TypeScript Coding");
      expect(found?.proficiencyLevel).toBe(0.9);
    });

    it("should capture snapshots and track trajectory", () => {
      const cap = registerCapability("Reasoning", "cognition", 0.6);
      updateCapabilityProficiency(cap.capabilityId, 0.8);
      const snap = captureSnapshot("55.0.0");
      expect(snap.totalCapabilities).toBe(1);
      expect(snap.avgProficiency).toBeCloseTo(0.8);
    });

    it("should detect improving trajectory", () => {
      const cap = registerCapability("Planning", "cognition", 0.5);
      updateCapabilityProficiency(cap.capabilityId, 0.9); // big improvement
      const snap = captureSnapshot("55.0.0");
      expect(snap.trajectory).toBe("improving");
    });

    it("should maintain snapshot history", () => {
      registerCapability("Memory", "cognition", 0.7);
      captureSnapshot("55.0.0");
      captureSnapshot("55.1.0");
      expect(getSnapshotHistory().length).toBe(2);
    });
  });

  // ─── grandUnificationMonitor ──────────────────────────────────────────────
  describe("grandUnificationMonitor", () => {
    beforeEach(() => _resetGrandUnificationMonitorForTest());

    it("should register subsystems and generate unified report", () => {
      registerSubsystem("rsi", "RSI Engine");
      registerSubsystem("safety", "Safety Guard");
      updateSubsystemMetrics("rsi", { cyclesPerHour: 12, avgImprovement: 0.05 });
      updateSubsystemMetrics("safety", { violations: 0 });
      const report = generateUnifiedReport("55.0.0");
      expect(report.subsystems.length).toBe(2);
      expect(report.overallHealthScore).toBe(1.0);
    });

    it("should detect unhealthy subsystems and lower health score", () => {
      registerSubsystem("db", "Database");
      updateSubsystemMetrics("db", { latencyMs: 5000 }, ["High latency detected"]);
      const report = generateUnifiedReport("55.0.0");
      expect(report.overallHealthScore).toBeLessThan(1.0);
      expect(report.activeAlerts.length).toBeGreaterThan(0);
    });

    it("should record system events and track trajectory", () => {
      registerSubsystem("core", "Core Engine");
      recordSystemEvent("core", "improvement", "RSI cycle completed with +5% gain", 0.05);
      recordSystemEvent("core", "improvement", "Memory optimized", 0.03);
      const report = generateUnifiedReport("55.0.0");
      expect(report.trajectory).toBe("ascending");
    });

    it("should provide recommendations for issues", () => {
      registerSubsystem("s1", "Sub1");
      registerSubsystem("s2", "Sub2");
      updateSubsystemMetrics("s1", {}, ["Alert 1", "Alert 2", "Alert 3"]);
      updateSubsystemMetrics("s2", {}, ["Alert 4", "Alert 5", "Alert 6"]);
      const report = generateUnifiedReport("55.0.0");
      expect(report.recommendations.length).toBeGreaterThan(0);
    });
  });
});
