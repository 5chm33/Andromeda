/**
 * v63.test.ts — The Collaboration Hub
 */
import { describe, it, expect, beforeEach } from "vitest";
import { registerAgent, createCoordinationTask, assignTask, submitResult, getCoordinationSummary, _resetMultiAgentCoordinatorForTest } from "./multiAgentCoordinator";
import { createWorkspace, putArtifact, getArtifact, listArtifacts, addMember, _resetSharedWorkspaceManagerForTest } from "./sharedWorkspaceManager";
import { reportConflict, mediateConflict, resolveConflict, getOpenConflicts, _resetConflictMediationEngineForTest } from "./conflictMediationEngine";
import { makeCollectiveDecision, getDecisions, _resetCollectiveDecisionMakerForTest } from "./collectiveDecisionMaker";
import { publishKnowledge, syncKnowledge, getKnowledge, getAllKnowledge, _resetKnowledgeSynchronizerForTest } from "./knowledgeSynchronizer";
import { addRating, getRecommendations, _resetCollaborativeFilteringEngineForTest } from "./collaborativeFilteringEngine";

beforeEach(() => {
  _resetMultiAgentCoordinatorForTest();
  _resetSharedWorkspaceManagerForTest();
  _resetConflictMediationEngineForTest();
  _resetCollectiveDecisionMakerForTest();
  _resetKnowledgeSynchronizerForTest();
  _resetCollaborativeFilteringEngineForTest();
});

describe("multiAgentCoordinator", () => {
  it("registers agents and assigns tasks", () => {
    const a1 = registerAgent("Analyzer", ["analysis", "reporting"]);
    const a2 = registerAgent("Executor", ["analysis", "execution"]);
    const task = createCoordinationTask("Analyze data", ["analysis"]);
    const assigned = assignTask(task.taskId);
    expect(assigned.length).toBeGreaterThan(0);
    expect([a1.agentId, a2.agentId]).toContain(assigned[0]);
  });

  it("completes task when all agents submit results", () => {
    const a1 = registerAgent("Agent1", ["compute"]);
    const task = createCoordinationTask("Compute task", ["compute"]);
    assignTask(task.taskId);
    submitResult(task.taskId, a1.agentId, { value: 42 });
    const summary = getCoordinationSummary();
    expect(summary.completedTasks).toBe(1);
  });

  it("throws when no eligible agents", () => {
    createCoordinationTask("Impossible task", ["nonexistent_capability"]);
    const tasks = [...Array(1)].map(() => createCoordinationTask("task", ["x"]));
    expect(() => assignTask(tasks[0].taskId)).toThrow();
  });
});

describe("sharedWorkspaceManager", () => {
  it("creates workspace and stores artifacts", () => {
    const ws = createWorkspace("Project Alpha", ["alice", "bob"]);
    const artifact = putArtifact(ws.workspaceId, "alice", "config.json", { key: "value" });
    expect(artifact.version).toBe(1);
    expect(artifact.lastModifiedBy).toBe("alice");
  });

  it("versions artifacts on update", () => {
    const ws = createWorkspace("Project Beta", ["alice"]);
    putArtifact(ws.workspaceId, "alice", "data.json", { v: 1 });
    const v2 = putArtifact(ws.workspaceId, "alice", "data.json", { v: 2 });
    expect(v2.version).toBe(2);
  });

  it("retrieves artifacts by name", () => {
    const ws = createWorkspace("Project Gamma", ["bob"]);
    putArtifact(ws.workspaceId, "bob", "notes.txt", "hello");
    const retrieved = getArtifact(ws.workspaceId, "notes.txt");
    expect(retrieved?.content).toBe("hello");
  });

  it("adds new members", () => {
    const ws = createWorkspace("Project Delta", ["alice"]);
    const added = addMember(ws.workspaceId, "charlie");
    expect(added).toBe(true);
    expect(ws.members).toContain("charlie");
  });

  it("lists all artifacts", () => {
    const ws = createWorkspace("Project Epsilon", ["alice"]);
    putArtifact(ws.workspaceId, "alice", "a.txt", "a");
    putArtifact(ws.workspaceId, "alice", "b.txt", "b");
    expect(listArtifacts(ws.workspaceId)).toHaveLength(2);
  });
});

describe("conflictMediationEngine", () => {
  it("reports and mediates a conflict", () => {
    const conflict = reportConflict("resource", ["agent1", "agent2"], "Both want GPU");
    const mediated = mediateConflict(conflict.conflictId, "compromise");
    expect(mediated.status).toBe("mediated");
    expect(mediated.resolution).toContain("agent1");
  });

  it("resolves a mediated conflict", () => {
    const conflict = reportConflict("goal", ["a", "b"], "Conflicting goals");
    mediateConflict(conflict.conflictId);
    const resolved = resolveConflict(conflict.conflictId);
    expect(resolved).toBe(true);
  });

  it("tracks open conflicts", () => {
    reportConflict("data", ["x", "y"], "Data conflict");
    expect(getOpenConflicts()).toHaveLength(1);
  });
});

describe("collectiveDecisionMaker", () => {
  it("selects winner by weighted vote", () => {
    const result = makeCollectiveDecision("Which approach?", [
      { voterId: "a1", option: "approach_A", weight: 1.0, confidence: 0.9 },
      { voterId: "a2", option: "approach_B", weight: 1.0, confidence: 0.6 },
      { voterId: "a3", option: "approach_A", weight: 0.8, confidence: 0.8 },
    ]);
    expect(result.winner).toBe("approach_A");
    expect(result.consensusStrength).toBeGreaterThan(0.5);
  });

  it("throws with no votes", () => {
    expect(() => makeCollectiveDecision("question", [])).toThrow();
  });

  it("tracks decisions", () => {
    makeCollectiveDecision("q", [{ voterId: "v1", option: "yes", weight: 1, confidence: 1 }]);
    expect(getDecisions()).toHaveLength(1);
  });
});

describe("knowledgeSynchronizer", () => {
  it("publishes and retrieves knowledge", () => {
    publishKnowledge("agent1", "model_accuracy", 0.95, 1);
    const entry = getKnowledge("model_accuracy");
    expect(entry?.value).toBe(0.95);
    expect(entry?.agentId).toBe("agent1");
  });

  it("resolves conflicts with highest version wins", () => {
    publishKnowledge("agent1", "config", "v1", 1);
    const result = syncKnowledge([{ key: "config", value: "v2", version: 2, agentId: "agent2", timestamp: Date.now() }]);
    expect(result.mergedEntries).toBe(1);
    expect(getKnowledge("config")?.value).toBe("v2");
  });

  it("lists all knowledge", () => {
    publishKnowledge("a1", "k1", 1, 1);
    publishKnowledge("a2", "k2", 2, 1);
    expect(getAllKnowledge()).toHaveLength(2);
  });
});

describe("collaborativeFilteringEngine", () => {
  it("generates recommendations based on similar users", () => {
    addRating("user1", "item1", 5);
    addRating("user1", "item2", 4);
    addRating("user2", "item1", 5);
    addRating("user2", "item3", 4);
    const recs = getRecommendations("user1");
    expect(recs.some(r => r.itemId === "item3")).toBe(true);
  });

  it("returns empty recommendations with no similar users", () => {
    addRating("loner", "unique_item", 5);
    const recs = getRecommendations("loner");
    expect(recs).toHaveLength(0);
  });
});
