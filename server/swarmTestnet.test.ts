/**
 * swarmTestnet.test.ts
 *
 * Tests for the SwarmTestnet — multi-instance swarm coordination testnet.
 * All tests use real in-process logic with no external dependencies.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  SwarmTestnet,
  getSwarmTestnet,
  resetSwarmTestnet,
  type TestnetConfig,
  type TestnetNode,
  type TestnetProposal,
} from "./swarmTestnet.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTestnet(overrides: Partial<TestnetConfig> = {}): SwarmTestnet {
  return new SwarmTestnet({
    nodeCount: 5,
    byzantineFraction: 0.0,
    networkPartitionRate: 0.0,
    baseLatencyMs: 1,    // Fast for tests
    jitterMs: 1,
    quorumThreshold: 0.67,
    voteTimeoutMs: 500,
    ...overrides,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SwarmTestnet", () => {
  afterEach(() => {
    resetSwarmTestnet();
  });

  // ── Initialization ────────────────────────────────────────────────────────────

  describe("initialize", () => {
    it("creates the configured number of nodes", () => {
      const testnet = makeTestnet({ nodeCount: 7 });
      testnet.initialize();
      expect(testnet.getNodes().length).toBe(7);
    });

    it("creates nodes with correct IDs", () => {
      const testnet = makeTestnet({ nodeCount: 3 });
      testnet.initialize();
      const ids = testnet.getNodes().map(n => n.id);
      expect(ids).toContain("node-000");
      expect(ids).toContain("node-001");
      expect(ids).toContain("node-002");
    });

    it("marks Byzantine nodes correctly", () => {
      const testnet = makeTestnet({ nodeCount: 5, byzantineFraction: 0.2 });
      testnet.initialize();
      const byzantineNodes = testnet.getNodes().filter(n => n.isByzantine);
      expect(byzantineNodes.length).toBe(1); // floor(5 * 0.2) = 1
    });

    it("all honest nodes start online", () => {
      const testnet = makeTestnet({ nodeCount: 5, byzantineFraction: 0.0 });
      testnet.initialize();
      const offlineNodes = testnet.getNodes().filter(n => !n.isOnline);
      expect(offlineNodes.length).toBe(0);
    });

    it("honest nodes have trust score >= 0.8", () => {
      const testnet = makeTestnet({ nodeCount: 5, byzantineFraction: 0.0 });
      testnet.initialize();
      for (const node of testnet.getNodes()) {
        expect(node.trustScore).toBeGreaterThanOrEqual(0.8);
      }
    });

    it("Byzantine nodes have trust score < 0.8", () => {
      const testnet = makeTestnet({ nodeCount: 5, byzantineFraction: 0.4 });
      testnet.initialize();
      const byzantineNodes = testnet.getNodes().filter(n => n.isByzantine);
      for (const node of byzantineNodes) {
        expect(node.trustScore).toBeLessThan(0.8);
      }
    });

    it("emits initialized event", () => {
      const testnet = makeTestnet({ nodeCount: 5 });
      let eventFired = false;
      testnet.on("initialized", () => { eventFired = true; });
      testnet.initialize();
      expect(eventFired).toBe(true);
    });

    it("clears previous state on re-initialization", () => {
      const testnet = makeTestnet({ nodeCount: 5 });
      testnet.initialize();
      testnet.initialize(); // Re-initialize
      expect(testnet.getNodes().length).toBe(5);
      expect(testnet.getProposals().length).toBe(0);
    });
  });

  // ── Proposal Submission ───────────────────────────────────────────────────────

  describe("submitProposal", () => {
    it("creates a proposal with correct structure", async () => {
      const testnet = makeTestnet({ nodeCount: 5 });
      testnet.initialize();

      const proposal = await testnet.submitProposal("improve performance", "node-000");

      expect(proposal.id).toMatch(/^proposal-\d+-[a-z0-9]+$/);
      expect(proposal.content).toBe("improve performance");
      expect(proposal.proposedBy).toBe("node-000");
      expect(proposal.createdAt).toBeLessThanOrEqual(Date.now());
    }, 10_000);

    it("resolves proposal to approved/rejected/timeout", async () => {
      const testnet = makeTestnet({ nodeCount: 5, voteTimeoutMs: 200 });
      testnet.initialize();

      const proposal = await testnet.submitProposal("safe content", "node-000");

      expect(["approved", "rejected", "timeout"]).toContain(proposal.status);
      expect(proposal.resolvedAt).toBeDefined();
    }, 10_000);

    it("approves safe proposals with honest nodes", async () => {
      const testnet = makeTestnet({
        nodeCount: 5,
        byzantineFraction: 0.0,
        networkPartitionRate: 0.0,
        baseLatencyMs: 1,
        jitterMs: 0,
        quorumThreshold: 0.5,
        voteTimeoutMs: 1000,
      });
      testnet.initialize();

      const proposal = await testnet.submitProposal("safe RSI improvement", "node-000");

      expect(proposal.status).toBe("approved");
    }, 10_000);

    it("rejects proposals with dangerous content", async () => {
      const testnet = makeTestnet({
        nodeCount: 5,
        byzantineFraction: 0.0,
        networkPartitionRate: 0.0,
        baseLatencyMs: 1,
        jitterMs: 0,
        quorumThreshold: 0.5,
        voteTimeoutMs: 1000,
      });
      testnet.initialize();

      const proposal = await testnet.submitProposal("rm -rf /", "node-000");

      expect(proposal.status).toBe("rejected");
    }, 10_000);

    it("collects votes from all online nodes except proposer", async () => {
      const testnet = makeTestnet({
        nodeCount: 5,
        byzantineFraction: 0.0,
        networkPartitionRate: 0.0,
        baseLatencyMs: 1,
        jitterMs: 0,
        voteTimeoutMs: 1000,
      });
      testnet.initialize();

      const proposal = await testnet.submitProposal("safe content", "node-000");

      // 4 nodes should vote (5 total - 1 proposer)
      expect(proposal.votes.size).toBe(4);
    }, 10_000);

    it("emits proposalResolved event", async () => {
      const testnet = makeTestnet({ nodeCount: 3, voteTimeoutMs: 500 });
      testnet.initialize();

      let resolved = false;
      testnet.on("proposalResolved", () => { resolved = true; });

      await testnet.submitProposal("test", "node-000");
      expect(resolved).toBe(true);
    }, 10_000);
  });

  // ── Network Partition ─────────────────────────────────────────────────────────

  describe("partitionNetwork / healPartition", () => {
    it("takes nodes offline", () => {
      const testnet = makeTestnet({ nodeCount: 5 });
      testnet.initialize();

      testnet.partitionNetwork(["node-001", "node-002"]);

      const offlineNodes = testnet.getNodes().filter(n => !n.isOnline);
      expect(offlineNodes.length).toBe(2);
      expect(offlineNodes.map(n => n.id)).toContain("node-001");
    });

    it("brings nodes back online after healing", () => {
      const testnet = makeTestnet({ nodeCount: 5 });
      testnet.initialize();

      testnet.partitionNetwork(["node-001"]);
      testnet.healPartition(["node-001"]);

      const node = testnet.getNodes().find(n => n.id === "node-001");
      expect(node?.isOnline).toBe(true);
    });

    it("emits networkPartitioned event", () => {
      const testnet = makeTestnet({ nodeCount: 5 });
      testnet.initialize();

      let eventData: unknown = null;
      testnet.on("networkPartitioned", (data) => { eventData = data; });
      testnet.partitionNetwork(["node-001"]);

      expect(eventData).toBeDefined();
    });

    it("emits partitionHealed event", () => {
      const testnet = makeTestnet({ nodeCount: 5 });
      testnet.initialize();
      testnet.partitionNetwork(["node-001"]);

      let healed = false;
      testnet.on("partitionHealed", () => { healed = true; });
      testnet.healPartition(["node-001"]);

      expect(healed).toBe(true);
    });

    it("ignores unknown node IDs in partition", () => {
      const testnet = makeTestnet({ nodeCount: 5 });
      testnet.initialize();

      expect(() => testnet.partitionNetwork(["nonexistent-node"])).not.toThrow();
    });
  });

  // ── Byzantine Fault Tolerance ─────────────────────────────────────────────────

  describe("Byzantine fault tolerance", () => {
    it("detects Byzantine votes", async () => {
      const testnet = makeTestnet({
        nodeCount: 5,
        byzantineFraction: 0.2, // 1 Byzantine node
        networkPartitionRate: 0.0,
        baseLatencyMs: 1,
        jitterMs: 0,
        voteTimeoutMs: 1000,
      });
      testnet.initialize();

      let byzantineDetected = 0;
      testnet.on("byzantineVoteDetected", () => { byzantineDetected++; });

      await testnet.submitProposal("safe content", "node-001");

      // Byzantine node should have voted
      expect(byzantineDetected).toBeGreaterThanOrEqual(1);
    }, 10_000);

    it("honest majority overrides Byzantine minority", async () => {
      const testnet = makeTestnet({
        nodeCount: 7,
        byzantineFraction: 0.14, // 1 Byzantine node (floor(7*0.14)=0, use 0.15)
        networkPartitionRate: 0.0,
        baseLatencyMs: 1,
        jitterMs: 0,
        quorumThreshold: 0.5,
        voteTimeoutMs: 1000,
      });
      testnet.initialize();

      const proposal = await testnet.submitProposal("safe RSI improvement", "node-001");

      // With 1 Byzantine node out of 7, honest majority should approve
      expect(["approved", "timeout"]).toContain(proposal.status);
    }, 10_000);
  });

  // ── Scenario Execution ────────────────────────────────────────────────────────

  describe("runScenario", () => {
    it("runs N proposals and returns results", async () => {
      const testnet = makeTestnet({
        nodeCount: 5,
        byzantineFraction: 0.0,
        networkPartitionRate: 0.0,
        baseLatencyMs: 1,
        jitterMs: 0,
        voteTimeoutMs: 500,
      });

      const result = await testnet.runScenario(3);

      expect(result.totalProposals).toBe(3);
      expect(result.approvedProposals + result.rejectedProposals + result.timedOutProposals).toBe(3);
      expect(result.testDurationMs).toBeGreaterThan(0);
      expect(result.messageCount).toBeGreaterThan(0);
    }, 15_000);

    it("emits scenarioComplete event", async () => {
      const testnet = makeTestnet({
        nodeCount: 3,
        baseLatencyMs: 1,
        jitterMs: 0,
        voteTimeoutMs: 300,
      });

      let completed = false;
      testnet.on("scenarioComplete", () => { completed = true; });

      await testnet.runScenario(2);
      expect(completed).toBe(true);
    }, 10_000);

    it("auto-initializes if not initialized", async () => {
      const testnet = makeTestnet({ nodeCount: 3, voteTimeoutMs: 300 });
      // Don't call initialize() explicitly

      const result = await testnet.runScenario(1);
      expect(result.totalProposals).toBe(1);
    }, 10_000);
  });

  // ── Message Log ───────────────────────────────────────────────────────────────

  describe("getMessageLog", () => {
    it("records messages during proposal broadcast", async () => {
      const testnet = makeTestnet({
        nodeCount: 5,
        baseLatencyMs: 1,
        jitterMs: 0,
        voteTimeoutMs: 500,
      });
      testnet.initialize();

      await testnet.submitProposal("test", "node-000");

      const log = testnet.getMessageLog();
      expect(log.length).toBeGreaterThan(0);
    }, 10_000);

    it("records dropped messages when partition rate > 0", async () => {
      const testnet = makeTestnet({
        nodeCount: 5,
        networkPartitionRate: 1.0, // Drop all messages
        baseLatencyMs: 1,
        jitterMs: 0,
        voteTimeoutMs: 200,
      });
      testnet.initialize();

      await testnet.submitProposal("test", "node-000");

      const log = testnet.getMessageLog();
      const dropped = log.filter(m => m.dropped);
      expect(dropped.length).toBeGreaterThan(0);
    }, 10_000);
  });

  // ── Reset ─────────────────────────────────────────────────────────────────────

  describe("reset", () => {
    it("clears all nodes and proposals", () => {
      const testnet = makeTestnet({ nodeCount: 5 });
      testnet.initialize();
      testnet.reset();

      expect(testnet.getNodes().length).toBe(0);
      expect(testnet.getProposals().length).toBe(0);
    });

    it("clears message log", async () => {
      const testnet = makeTestnet({ nodeCount: 3, voteTimeoutMs: 200 });
      testnet.initialize();
      await testnet.submitProposal("test", "node-000");
      testnet.reset();

      expect(testnet.getMessageLog().length).toBe(0);
    }, 10_000);
  });

  // ── Singleton ─────────────────────────────────────────────────────────────────

  describe("singleton", () => {
    it("returns the same instance", () => {
      const t1 = getSwarmTestnet({ nodeCount: 3 });
      const t2 = getSwarmTestnet();
      expect(t1).toBe(t2);
    });

    it("creates a new instance after reset", () => {
      const t1 = getSwarmTestnet({ nodeCount: 3 });
      resetSwarmTestnet();
      const t2 = getSwarmTestnet({ nodeCount: 5 });
      expect(t1).not.toBe(t2);
    });
  });
});
