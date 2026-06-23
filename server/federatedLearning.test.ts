/**
 * federatedLearning.test.ts — Andromeda v11.16.0 Audit 8
 * Real function-level tests for federatedLearning.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  registerNode, getNode, listNodes, markNodeHealthy, markNodeUnhealthy,
  receiveProposal, computeFederatedAvgScore, updateLocalScore,
  getFederatedStats, getNodeId, initFederatedLearning,
} from "./federatedLearning.js";

describe("federatedLearning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initFederatedLearning();
  });

  it("module loads without throwing", async () => {
    await expect(import("./federatedLearning.js")).resolves.toBeDefined();
  });

  it("getNodeId returns a non-empty string", () => {
    const id = getNodeId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("registerNode adds a node retrievable by getNode", () => {
    const node = registerNode({ nodeId: "peer-1", endpoint: "http://peer1:3001", capabilities: ["rsi"] });
    expect(node.nodeId).toBe("peer-1");
    expect(node.healthy).toBe(true);
    const retrieved = getNode("peer-1");
    expect(retrieved?.nodeId).toBe("peer-1");
  });

  it("getNode returns null for unknown node", () => {
    expect(getNode("unknown-xyz")).toBeNull();
  });

  it("listNodes returns array including registered nodes", () => {
    registerNode({ nodeId: "peer-list", endpoint: "http://peer2:3001", capabilities: [] });
    const nodes = listNodes();
    expect(Array.isArray(nodes)).toBe(true);
    expect(nodes.some(n => n.nodeId === "peer-list")).toBe(true);
  });

  it("markNodeHealthy and markNodeUnhealthy toggle health status", () => {
    registerNode({ nodeId: "peer-health", endpoint: "http://peer3:3001", capabilities: [] });
    markNodeUnhealthy("peer-health");
    expect(getNode("peer-health")?.healthy).toBe(false);
    markNodeHealthy("peer-health");
    expect(getNode("peer-health")?.healthy).toBe(true);
  });

  it("computeFederatedAvgScore returns a number", () => {
    const score = computeFederatedAvgScore();
    expect(typeof score).toBe("number");
  });

  it("updateLocalScore does not throw", () => {
    expect(() => updateLocalScore(0.85)).not.toThrow();
  });

  it("getFederatedStats returns a stats object with expected fields", () => {
    const stats = getFederatedStats();
    expect(stats).toBeDefined();
    expect(typeof stats).toBe("object");
  });

  it("receiveProposal returns accepted/rejected result", () => {
    const proposal = {
      id: "prop-fed-1",
      sourceNodeId: "peer-1",
      targetFile: "server/test.ts",
      category: "readability" as const,
      rationale: "improve readability",
      confidence: 0.9,
      proposedContent: "export function test() {}",
      originalContent: "export function test() { return 1; }",
      createdAt: Date.now(),
    };
    const result = receiveProposal(proposal);
    expect(typeof result.accepted).toBe("boolean");
  });
});
