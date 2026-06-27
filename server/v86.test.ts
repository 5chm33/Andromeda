/**
 * v86.test.ts — Multi-Agent Coordination
 * Comprehensive tests for all 6 v86 modules.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { registerAgent, updateHeartbeat, findAgentsByCapability, deregisterAgent, getOnlineAgents, getAgent, getRegistrySize, _resetAgentRegistryForTest } from "./agentRegistry";
import { publish, subscribe, unsubscribe, getMessagesForAgent, getMessageCount, getSubscriptionCount, _resetAgentMessageBusForTest } from "./agentMessageBus";
import { makeOffer, acceptOffer, rejectOffer, getActiveContracts, _resetCapabilityNegotiatorForTest } from "./agentCapabilityNegotiator";
import { registerAgentInPool, updateAgentLoad, delegate, getDelegationLog, getPoolSize, _resetAgentTaskDelegatorForTest } from "./agentTaskDelegator";
import { writeState, readState, deleteState, getAllKeys, getStateCount, _resetAgentStateSyncForTest } from "./agentStateSync";
import { joinElection, markAgentFailed, runElection, getCurrentLeader, getElectionStatus, getElectionHistory, _resetAgentElectionProtocolForTest } from "./agentElectionProtocol";

// ─── agentRegistry ───────────────────────────────────────────────────────────
describe("agentRegistry", () => {
  beforeEach(() => _resetAgentRegistryForTest());

  it("registers an agent", () => {
    const agent = registerAgent("Worker-1", "http://localhost:3001", [{ name: "nlp", version: "1.0", maxConcurrency: 5, avgLatencyMs: 100 }]);
    expect(agent.agentId).toMatch(/^agent-/);
    expect(getRegistrySize()).toBe(1);
  });

  it("updates heartbeat and status", () => {
    const agent = registerAgent("Worker-2", "http://localhost:3002", []);
    updateHeartbeat(agent.agentId, "online", 0.3);
    expect(getAgent(agent.agentId)?.status).toBe("online");
    expect(getAgent(agent.agentId)?.load).toBe(0.3);
  });

  it("finds agents by capability", () => {
    const a1 = registerAgent("A1", "http://a1", [{ name: "vision", version: "1.0", maxConcurrency: 3, avgLatencyMs: 200 }]);
    const a2 = registerAgent("A2", "http://a2", [{ name: "nlp", version: "1.0", maxConcurrency: 5, avgLatencyMs: 100 }]);
    updateHeartbeat(a1.agentId, "online", 0.2);
    updateHeartbeat(a2.agentId, "online", 0.5);
    const found = findAgentsByCapability("vision");
    expect(found.length).toBe(1);
    expect(found[0].agentId).toBe(a1.agentId);
  });

  it("deregisters an agent", () => {
    const agent = registerAgent("Temp", "http://temp", []);
    deregisterAgent(agent.agentId);
    expect(getAgent(agent.agentId)).toBeUndefined();
  });

  it("returns only online agents", () => {
    const a = registerAgent("A", "http://a", []);
    const b = registerAgent("B", "http://b", []);
    updateHeartbeat(a.agentId, "online");
    updateHeartbeat(b.agentId, "offline");
    expect(getOnlineAgents().length).toBe(1);
  });

  it("resets cleanly", () => {
    registerAgent("X", "http://x", []);
    _resetAgentRegistryForTest();
    expect(getRegistrySize()).toBe(0);
  });
});

// ─── agentMessageBus ─────────────────────────────────────────────────────────
describe("agentMessageBus", () => {
  beforeEach(() => _resetAgentMessageBusForTest());

  it("publishes and retrieves messages", () => {
    publish("agent-1", "agent-2", "command", "task.execute", { taskId: "t1" });
    const msgs = getMessagesForAgent("agent-2");
    expect(msgs.length).toBe(1);
    expect(msgs[0].payload.taskId).toBe("t1");
  });

  it("delivers broadcast messages to all", () => {
    publish("agent-1", "broadcast", "event", "system.update", { version: "2.0" });
    const msgs = getMessagesForAgent("agent-2");
    expect(msgs.length).toBe(1);
  });

  it("subscribes to topics", () => {
    const sub = subscribe("agent-3", "alerts");
    publish("agent-1", "agent-3", "event", "alerts", { level: "critical" });
    expect(sub.receivedCount).toBe(1);
  });

  it("unsubscribes from topics", () => {
    const sub = subscribe("agent-4", "news");
    unsubscribe(sub.subscriptionId);
    expect(getSubscriptionCount()).toBe(0);
  });

  it("tracks message count", () => {
    publish("a1", "a2", "command", "t1", {});
    publish("a1", "a2", "command", "t2", {});
    expect(getMessageCount()).toBe(2);
  });

  it("resets cleanly", () => {
    publish("a1", "a2", "command", "t", {});
    _resetAgentMessageBusForTest();
    expect(getMessageCount()).toBe(0);
  });
});

// ─── agentCapabilityNegotiator ───────────────────────────────────────────────
describe("agentCapabilityNegotiator", () => {
  beforeEach(() => _resetCapabilityNegotiatorForTest());

  it("creates and accepts an offer", () => {
    const offer = makeOffer("agent-1", "agent-2", "image_processing", 100, 500, 0.01);
    const contract = acceptOffer(offer.offerId);
    expect(contract).not.toBeNull();
    expect(contract?.status).toBe("accepted");
    expect(contract?.capabilityName).toBe("image_processing");
  });

  it("respects requested throughput limit", () => {
    const offer = makeOffer("a1", "a2", "nlp", 100, 200, 0.005);
    const contract = acceptOffer(offer.offerId, 50);
    expect(contract?.agreedThroughput).toBe(50);
  });

  it("rejects an offer", () => {
    const offer = makeOffer("a1", "a2", "vision", 10, 100, 0.1);
    expect(rejectOffer(offer.offerId)).toBe(true);
  });

  it("returns active contracts for agent", () => {
    const offer = makeOffer("a1", "a2", "search", 50, 300, 0.002, 60000);
    acceptOffer(offer.offerId);
    const contracts = getActiveContracts("a2");
    expect(contracts.length).toBe(1);
  });

  it("returns null for expired offer", () => {
    const offer = makeOffer("a1", "a2", "test", 10, 100, 0.01, -1); // already expired
    const contract = acceptOffer(offer.offerId);
    expect(contract).toBeNull();
  });
});

// ─── agentTaskDelegator ──────────────────────────────────────────────────────
describe("agentTaskDelegator", () => {
  beforeEach(() => _resetAgentTaskDelegatorForTest());

  it("delegates to eligible agent", () => {
    registerAgentInPool("agent-1", ["nlp", "search"], 0.2);
    const result = delegate({ requiredCapability: "nlp", payload: {}, priority: "normal", timeoutMs: 5000, strategy: "capability_match" });
    expect(result.success).toBe(true);
    expect(result.selectedAgentId).toBe("agent-1");
  });

  it("returns failure when no eligible agents", () => {
    registerAgentInPool("agent-1", ["vision"], 0.2);
    const result = delegate({ requiredCapability: "audio", payload: {}, priority: "normal", timeoutMs: 5000, strategy: "capability_match" });
    expect(result.success).toBe(false);
    expect(result.selectedAgentId).toBeNull();
  });

  it("selects least loaded agent", () => {
    registerAgentInPool("a1", ["task"], 0.8);
    registerAgentInPool("a2", ["task"], 0.2);
    const result = delegate({ requiredCapability: "task", payload: {}, priority: "normal", timeoutMs: 5000, strategy: "least_loaded" });
    expect(result.selectedAgentId).toBe("a2");
  });

  it("logs delegations", () => {
    registerAgentInPool("a1", ["work"], 0);
    delegate({ requiredCapability: "work", payload: {}, priority: "normal", timeoutMs: 5000, strategy: "capability_match" });
    expect(getDelegationLog().length).toBe(1);
  });

  it("resets cleanly", () => {
    registerAgentInPool("a1", ["x"], 0);
    _resetAgentTaskDelegatorForTest();
    expect(getPoolSize()).toBe(0);
  });
});

// ─── agentStateSync ──────────────────────────────────────────────────────────
describe("agentStateSync", () => {
  beforeEach(() => _resetAgentStateSyncForTest());

  it("writes and reads state", () => {
    writeState("config.theme", "dark", "agent-1", 1);
    const entry = readState("config.theme");
    expect(entry?.value).toBe("dark");
  });

  it("last_write_wins strategy overwrites", () => {
    writeState("key1", "v1", "a1", 1, "last_write_wins");
    writeState("key1", "v2", "a2", 2, "last_write_wins");
    expect(readState("key1")?.value).toBe("v2");
  });

  it("highest_version_wins rejects lower version", () => {
    writeState("key2", "v1", "a1", 5, "highest_version_wins");
    writeState("key2", "v2", "a2", 3, "highest_version_wins");
    expect(readState("key2")?.value).toBe("v1");
  });

  it("merge strategy combines objects", () => {
    writeState("settings", { a: 1 }, "a1", 1, "merge");
    writeState("settings", { b: 2 }, "a2", 2, "merge");
    const entry = readState("settings") as { value: Record<string, number> };
    expect(entry.value).toHaveProperty("a");
    expect(entry.value).toHaveProperty("b");
  });

  it("deletes state", () => {
    writeState("temp", "x", "a1", 1);
    deleteState("temp");
    expect(readState("temp")).toBeUndefined();
  });

  it("resets cleanly", () => {
    writeState("x", "y", "a1", 1);
    _resetAgentStateSyncForTest();
    expect(getStateCount()).toBe(0);
  });
});

// ─── agentElectionProtocol ───────────────────────────────────────────────────
describe("agentElectionProtocol", () => {
  beforeEach(() => _resetAgentElectionProtocolForTest());

  it("elects highest priority agent as leader", () => {
    joinElection("agent-1", 10);
    joinElection("agent-2", 20);
    joinElection("agent-3", 5);
    const result = runElection();
    expect(result?.leaderId).toBe("agent-2");
    expect(getCurrentLeader()).toBe("agent-2");
  });

  it("re-elects when leader fails", () => {
    joinElection("a1", 10);
    joinElection("a2", 20);
    runElection();
    markAgentFailed("a2");
    runElection();
    expect(getCurrentLeader()).toBe("a1");
  });

  it("returns null when no participants", () => {
    const result = runElection();
    expect(result).toBeNull();
  });

  it("tracks election history", () => {
    joinElection("a1", 1);
    runElection();
    runElection();
    expect(getElectionHistory().length).toBe(2);
  });

  it("updates election status", () => {
    joinElection("a1", 1);
    runElection();
    expect(getElectionStatus()).toBe("leader_elected");
  });

  it("resets cleanly", () => {
    joinElection("a1", 1);
    runElection();
    _resetAgentElectionProtocolForTest();
    expect(getCurrentLeader()).toBeNull();
  });
});
