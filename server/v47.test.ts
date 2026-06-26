/**
 * v47.test.ts — Sub-Agent Economy II
 * Tests: agentSpawnController, agentLifecycleManager, agentCommunicationBus,
 *        agentMemoryBroker, agentCapabilityRegistry, agentCoordinator
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  spawnAgent, terminateAgent, expireStaleAgents, getActiveAgents, getAgent,
  setSpawnPolicy, _resetSpawnControllerForTest,
} from "./agentSpawnController.js";

import {
  registerLifecycle, transitionState, heartbeat, recordTaskOutcome,
  getStaleAgents, getLifecycleRecord, getHealthSummary, _resetLifecycleManagerForTest,
} from "./agentLifecycleManager.js";

import {
  subscribe, unsubscribe, publish, drainQueue, getQueueDepth,
  getSubscriberCount, _resetBusForTest,
} from "./agentCommunicationBus.js";

import {
  writeMemory, readMemory, grantAccess, deleteMemory, listKeys,
  purgeExpired, getMemoryStats, _resetMemoryBrokerForTest,
} from "./agentMemoryBroker.js";

import {
  registerCapabilities, findAgentsWithCapability, findAgentsWithAllCapabilities,
  resolveCapabilityDependencies, getAgentCapabilities, searchCapabilities,
  getRegistryStats, _resetCapabilityRegistryForTest,
} from "./agentCapabilityRegistry.js";

import {
  createPlan, addStep, assignStep, completeStep, getReadySteps,
  getPlan, getPlanProgress, _resetCoordinatorForTest,
} from "./agentCoordinator.js";

describe("v47 Sub-Agent Economy II", () => {
  // ─── agentSpawnController ──────────────────────────────────────────────────
  describe("agentSpawnController", () => {
    beforeEach(() => _resetSpawnControllerForTest());

    it("should spawn an agent successfully", () => {
      const result = spawnAgent({ requestId: "r1", requesterId: "host", agentType: "coder", capabilities: ["code"], computeUnits: 10, maxLifetimeMs: 60000 });
      expect("agentId" in result).toBe(true);
      expect((result as { agentId: string }).agentId).toBeTruthy();
    });

    it("should enforce per-requester quota", () => {
      setSpawnPolicy({ maxAgentsPerRequester: 2, minSpawnIntervalMs: 0 });
      spawnAgent({ requestId: "r1", requesterId: "host", agentType: "coder", capabilities: ["code"], computeUnits: 5, maxLifetimeMs: 60000 });
      spawnAgent({ requestId: "r2", requesterId: "host", agentType: "coder", capabilities: ["code"], computeUnits: 5, maxLifetimeMs: 60000 });
      const result = spawnAgent({ requestId: "r3", requesterId: "host", agentType: "coder", capabilities: ["code"], computeUnits: 5, maxLifetimeMs: 60000 });
      expect("error" in result).toBe(true);
    });

    it("should terminate an agent", () => {
      setSpawnPolicy({ minSpawnIntervalMs: 0 });
      const spawned = spawnAgent({ requestId: "r1", requesterId: "host", agentType: "coder", capabilities: ["code"], computeUnits: 5, maxLifetimeMs: 60000 }) as { agentId: string };
      expect(terminateAgent(spawned.agentId)).toBe(true);
      expect(getAgent(spawned.agentId)!.status).toBe("terminated");
    });

    it("should expire stale agents", () => {
      setSpawnPolicy({ minSpawnIntervalMs: 0 });
      const spawned = spawnAgent({ requestId: "r1", requesterId: "host", agentType: "coder", capabilities: ["code"], computeUnits: 5, maxLifetimeMs: 1 }) as { agentId: string };
      // Wait for expiry
      return new Promise<void>(resolve => setTimeout(() => {
        const expired = expireStaleAgents();
        expect(expired).toBeGreaterThanOrEqual(1);
        resolve();
      }, 10));
    });
  });

  // ─── agentLifecycleManager ─────────────────────────────────────────────────
  describe("agentLifecycleManager", () => {
    beforeEach(() => _resetLifecycleManagerForTest());

    it("should register and transition states", () => {
      registerLifecycle("a1");
      expect(transitionState("a1", "ready")).toBe(true);
      expect(getLifecycleRecord("a1")!.state).toBe("ready");
    });

    it("should reject invalid state transitions", () => {
      registerLifecycle("a2");
      expect(transitionState("a2", "terminated")).toBe(false); // initializing → terminated invalid
    });

    it("should update health score on task outcomes", () => {
      registerLifecycle("a3");
      transitionState("a3", "ready");
      recordTaskOutcome("a3", true);
      recordTaskOutcome("a3", false);
      const record = getLifecycleRecord("a3")!;
      expect(record.tasksCompleted).toBe(1);
      expect(record.tasksFailed).toBe(1);
      expect(record.healthScore).toBeLessThan(1.0);
    });

    it("should return health summary", () => {
      registerLifecycle("a4");
      transitionState("a4", "ready");
      registerLifecycle("a5");
      transitionState("a5", "crashed");
      const summary = getHealthSummary();
      expect(summary.healthy).toBeGreaterThanOrEqual(1);
      expect(summary.crashed).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── agentCommunicationBus ─────────────────────────────────────────────────
  describe("agentCommunicationBus", () => {
    beforeEach(() => _resetBusForTest());

    it("should deliver messages to subscribers", () => {
      const received: unknown[] = [];
      subscribe("topic.test", "sub1", msg => received.push(msg.payload));
      publish("topic.test", "sender1", { data: 42 });
      expect(received).toHaveLength(1);
      expect((received[0] as { data: number }).data).toBe(42);
    });

    it("should queue messages when no subscribers", () => {
      publish("topic.empty", "sender1", { data: "queued" });
      expect(getQueueDepth("topic.empty")).toBe(1);
    });

    it("should drain queued messages to a handler", () => {
      publish("topic.drain", "sender1", { data: 1 });
      publish("topic.drain", "sender1", { data: 2 });
      const drained: unknown[] = [];
      const count = drainQueue("topic.drain", msg => drained.push(msg.payload));
      expect(count).toBe(2);
    });

    it("should unsubscribe correctly", () => {
      const received: unknown[] = [];
      subscribe("topic.unsub", "sub1", msg => received.push(msg));
      unsubscribe("topic.unsub", "sub1");
      publish("topic.unsub", "sender1", { data: "x" });
      expect(getQueueDepth("topic.unsub")).toBe(1); // queued, not delivered
    });
  });

  // ─── agentMemoryBroker ─────────────────────────────────────────────────────
  describe("agentMemoryBroker", () => {
    beforeEach(() => _resetMemoryBrokerForTest());

    it("should write and read private memory", () => {
      writeMemory("agent1", "key1", { x: 42 }, "private");
      const val = readMemory("agent1", "agent1", "key1");
      expect((val as { x: number }).x).toBe(42);
    });

    it("should deny access to private memory from another agent", () => {
      writeMemory("agent1", "secret", "top-secret", "private");
      expect(readMemory("agent2", "agent1", "secret")).toBeNull();
    });

    it("should allow access after grant", () => {
      writeMemory("agent1", "shared-key", "hello", "shared");
      grantAccess("agent1", "shared-key", "agent2");
      expect(readMemory("agent2", "agent1", "shared-key")).toBe("hello");
    });

    it("should expire TTL entries", () => {
      writeMemory("agent1", "temp", "value", "private", 1);
      return new Promise<void>(resolve => setTimeout(() => {
        const val = readMemory("agent1", "agent1", "temp");
        expect(val).toBeNull();
        resolve();
      }, 10));
    });

    it("should list keys for an owner", () => {
      writeMemory("agent1", "k1", 1);
      writeMemory("agent1", "k2", 2);
      const keys = listKeys("agent1");
      expect(keys).toContain("k1");
      expect(keys).toContain("k2");
    });
  });

  // ─── agentCapabilityRegistry ───────────────────────────────────────────────
  describe("agentCapabilityRegistry", () => {
    beforeEach(() => _resetCapabilityRegistryForTest());

    it("should register and find agents by capability", () => {
      registerCapabilities("agent1", [{ name: "code", version: "1.0.0", description: "Coding", dependencies: [], tags: ["dev"] }]);
      const agents = findAgentsWithCapability("code");
      expect(agents).toContain("agent1");
    });

    it("should find agents with all required capabilities", () => {
      registerCapabilities("agent1", [
        { name: "code", version: "1.0.0", description: "", dependencies: [], tags: [] },
        { name: "test", version: "1.0.0", description: "", dependencies: [], tags: [] },
      ]);
      registerCapabilities("agent2", [
        { name: "code", version: "1.0.0", description: "", dependencies: [], tags: [] },
      ]);
      const agents = findAgentsWithAllCapabilities(["code", "test"]);
      expect(agents).toContain("agent1");
      expect(agents).not.toContain("agent2");
    });

    it("should resolve capability dependencies", () => {
      registerCapabilities("agent1", [
        { name: "deploy", version: "1.0.0", description: "", dependencies: ["build"], tags: [] },
        { name: "build", version: "1.0.0", description: "", dependencies: ["compile"], tags: [] },
        { name: "compile", version: "1.0.0", description: "", dependencies: [], tags: [] },
      ]);
      const resolved = resolveCapabilityDependencies("deploy");
      expect(resolved).toContain("compile");
      expect(resolved).toContain("build");
      expect(resolved).toContain("deploy");
      expect(resolved.indexOf("compile")).toBeLessThan(resolved.indexOf("build"));
    });

    it("should search capabilities by tag", () => {
      registerCapabilities("agent1", [{ name: "ml-train", version: "1.0.0", description: "", dependencies: [], tags: ["ml", "gpu"] }]);
      const caps = searchCapabilities("ml");
      expect(caps.some(c => c.name === "ml-train")).toBe(true);
    });
  });

  // ─── agentCoordinator ─────────────────────────────────────────────────────
  describe("agentCoordinator", () => {
    beforeEach(() => _resetCoordinatorForTest());

    it("should create a plan and add steps", () => {
      const plan = createPlan("Deploy service");
      addStep(plan.planId, "Build image", ["docker"]);
      addStep(plan.planId, "Push image", ["docker"]);
      const progress = getPlanProgress(plan.planId);
      expect(progress!.total).toBe(2);
    });

    it("should unlock dependent steps after completion", () => {
      const plan = createPlan("Sequential pipeline");
      const s1 = addStep(plan.planId, "Step 1", ["code"]);
      const s2 = addStep(plan.planId, "Step 2", ["test"], [s1!.stepId]);
      expect(s2!.status).toBe("waiting");
      assignStep(plan.planId, s1!.stepId, "agent1");
      completeStep(plan.planId, s1!.stepId, {}, true);
      const ready = getReadySteps(plan.planId);
      expect(ready.some(s => s.stepId === s2!.stepId)).toBe(true);
    });

    it("should mark plan completed when all steps succeed", () => {
      const plan = createPlan("Simple plan");
      const s = addStep(plan.planId, "Only step", ["code"]);
      completeStep(plan.planId, s!.stepId, {}, true);
      expect(getPlan(plan.planId)!.status).toBe("completed");
    });

    it("should mark plan failed if a step fails", () => {
      const plan = createPlan("Failing plan");
      const s = addStep(plan.planId, "Bad step", ["code"]);
      completeStep(plan.planId, s!.stepId, { error: "crash" }, false);
      expect(getPlan(plan.planId)!.status).toBe("failed");
    });
  });
});
