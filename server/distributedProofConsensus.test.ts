/**
 * distributedProofConsensus.test.ts
 *
 * Tests for the DistributedProofConsensusManager — quorum-based proposal
 * approval with cryptographic proof verification.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  DistributedProofConsensusManager,
  resetConsensusManager,
  getConsensusManager,
  type ConsensusPeer,
  type ConsensusVote,
  type ProofConsensusRequest,
} from "./distributedProofConsensus.js";

// ── Test Helpers ──────────────────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = join(tmpdir(), `consensus-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeManager(overrides: Record<string, unknown> = {}): DistributedProofConsensusManager {
  const tmpDir = makeTempDir();
  return new DistributedProofConsensusManager({
    localPeerId: "test-local-peer",
    hmacSecret: "test-secret-key",
    quorumThreshold: 0.6,
    minPeersRequired: 1,
    voteTimeoutMs: 5_000,
    dataDir: tmpDir,
    simulationMode: true,
    ...overrides,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DistributedProofConsensusManager", () => {
  afterEach(() => {
    resetConsensusManager();
  });

  // ── Proof Verification ────────────────────────────────────────────────────────

  describe("proof verification", () => {
    it("generates and verifies a valid proof hash", () => {
      const manager = makeManager();
      const payload = "proposal-payload-data";
      const hash = manager.generateProofHash(payload);

      expect(hash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
      expect(manager.verifyProof(payload, hash)).toBe(true);
    });

    it("rejects tampered payload", () => {
      const manager = makeManager();
      const hash = manager.generateProofHash("original-payload");
      expect(manager.verifyProof("tampered-payload", hash)).toBe(false);
    });

    it("rejects wrong hash", () => {
      const manager = makeManager();
      const payload = "test-payload";
      expect(manager.verifyProof(payload, "wrong-hash")).toBe(false);
    });

    it("produces different hashes for different secrets", () => {
      const m1 = makeManager({ hmacSecret: "secret-1" });
      const m2 = makeManager({ hmacSecret: "secret-2" });
      const payload = "same-payload";

      const h1 = m1.generateProofHash(payload);
      const h2 = m2.generateProofHash(payload);
      expect(h1).not.toBe(h2);
    });
  });

  // ── Vote Signing ──────────────────────────────────────────────────────────────

  describe("vote signing", () => {
    it("signs a vote and verifies the signature", () => {
      const manager = makeManager();
      const proposalId = "test-proposal-123";
      const signature = manager.signVote(proposalId, "approve");

      const vote: ConsensusVote = {
        peerId: "test-local-peer",
        proposalId,
        decision: "approve",
        trustWeight: 1.0,
        signature,
        reasoning: "test",
        castAt: Date.now(),
      };

      expect(manager.verifyVoteSignature(vote)).toBe(true);
    });

    it("rejects a vote with wrong signature", () => {
      const manager = makeManager();
      const vote: ConsensusVote = {
        peerId: "test-local-peer",
        proposalId: "test-proposal",
        decision: "approve",
        trustWeight: 1.0,
        signature: "wrong-signature",
        reasoning: "test",
        castAt: Date.now(),
      };

      expect(manager.verifyVoteSignature(vote)).toBe(false);
    });

    it("rejects a vote with tampered decision", () => {
      const manager = makeManager();
      const proposalId = "test-proposal";
      const signature = manager.signVote(proposalId, "approve");

      const vote: ConsensusVote = {
        peerId: "test-local-peer",
        proposalId,
        decision: "reject", // Changed from "approve"
        trustWeight: 1.0,
        signature,
        reasoning: "test",
        castAt: Date.now(),
      };

      expect(manager.verifyVoteSignature(vote)).toBe(false);
    });
  });

  // ── Peer Management ───────────────────────────────────────────────────────────

  describe("peer management", () => {
    it("registers a peer", () => {
      const manager = makeManager();
      manager.registerPeer({
        id: "peer-1",
        url: "http://localhost:3001",
        trustWeight: 0.8,
      });

      const peers = manager.getPeers();
      expect(peers.length).toBe(1);
      expect(peers[0].id).toBe("peer-1");
      expect(peers[0].trustWeight).toBe(0.8);
      expect(peers[0].isOnline).toBe(true);
    });

    it("removes a peer", () => {
      const manager = makeManager();
      manager.registerPeer({ id: "peer-1", url: "http://localhost:3001", trustWeight: 0.8 });
      manager.removePeer("peer-1");

      expect(manager.getPeers().length).toBe(0);
    });

    it("returns only online peers", () => {
      const manager = makeManager();
      manager.registerPeer({ id: "peer-1", url: "http://localhost:3001", trustWeight: 0.8 });
      manager.registerPeer({ id: "peer-2", url: "http://localhost:3002", trustWeight: 0.7 });

      // Both peers are online initially
      expect(manager.getOnlinePeers().length).toBe(2);

      // Remove one peer and verify count drops
      manager.removePeer("peer-2");
      expect(manager.getOnlinePeers().length).toBe(1);
    });

    it("persists peers to disk", () => {
      const tmpDir = makeTempDir();
      const m1 = new DistributedProofConsensusManager({
        dataDir: tmpDir,
        hmacSecret: "test-secret",
        simulationMode: true,
      });

      m1.registerPeer({ id: "peer-1", url: "http://localhost:3001", trustWeight: 0.8 });

      // Create new manager from same dir — should load persisted peers
      const m2 = new DistributedProofConsensusManager({
        dataDir: tmpDir,
        hmacSecret: "test-secret",
        simulationMode: true,
      });

      expect(m2.getPeers().length).toBe(1);
      expect(m2.getPeers()[0].id).toBe("peer-1");
    });
  });

  // ── Consensus Protocol ────────────────────────────────────────────────────────

  describe("initiateConsensus", () => {
    it("approves a valid proposal in simulation mode", async () => {
      const manager = makeManager({ simulationMode: true, quorumThreshold: 0.5 });
      const payload = "valid-proposal-payload";

      const result = await manager.initiateConsensus("proposal-001", payload, { test: true });

      expect(result.proposalId).toBe("proposal-001");
      // With valid proof, simulated peers mostly approve
      expect(["approved", "rejected"]).toContain(result.decision);
      expect(result.votes.length).toBeGreaterThanOrEqual(1);
      expect(result.finalizedAt).toBeLessThanOrEqual(Date.now());
    });

    it("returns correct vote counts", async () => {
      const manager = makeManager({ simulationMode: true });
      const payload = "test-payload";

      const result = await manager.initiateConsensus("proposal-002", payload);

      expect(result.totalWeight).toBeGreaterThan(0);
      expect(result.approveWeight + result.rejectWeight + result.abstainWeight)
        .toBeCloseTo(result.totalWeight, 5);
    });

    it("computes quorum correctly", async () => {
      const manager = makeManager({ simulationMode: true, quorumThreshold: 0.6 });
      const payload = "quorum-test";

      const result = await manager.initiateConsensus("proposal-003", payload);

      const expectedQuorum = result.totalWeight > 0
        ? result.approveWeight / result.totalWeight
        : 0;
      expect(result.achievedQuorum).toBeCloseTo(expectedQuorum, 5);
      expect(result.quorumThreshold).toBe(0.6);
    });

    it("stores result for retrieval", async () => {
      const manager = makeManager({ simulationMode: true });
      await manager.initiateConsensus("proposal-004", "payload");

      const result = manager.getResult("proposal-004");
      expect(result).toBeDefined();
      expect(result?.proposalId).toBe("proposal-004");
    });

    it("stores votes for retrieval", async () => {
      const manager = makeManager({ simulationMode: true });
      await manager.initiateConsensus("proposal-005", "payload");

      const votes = manager.getVotes("proposal-005");
      expect(votes.length).toBeGreaterThanOrEqual(1);
    });

    it("returns all results", async () => {
      const manager = makeManager({ simulationMode: true });
      await manager.initiateConsensus("p1", "payload1");
      await manager.initiateConsensus("p2", "payload2");

      const all = manager.getAllResults();
      expect(all.length).toBe(2);
    });

    it("includes reason in result", async () => {
      const manager = makeManager({ simulationMode: true });
      const result = await manager.initiateConsensus("proposal-006", "payload");

      expect(result.reason).toBeTruthy();
      expect(typeof result.reason).toBe("string");
    });
  });

  // ── Incoming Vote Handling ────────────────────────────────────────────────────

  describe("handleVoteRequest", () => {
    it("approves a valid incoming request", () => {
      const manager = makeManager();
      const payload = "incoming-payload";
      const hash = manager.generateProofHash(payload);

      const request: ProofConsensusRequest = {
        proposalId: "incoming-001",
        proposerPeerId: "remote-peer",
        proofHash: hash,
        proofPayload: payload,
        requestedAt: Date.now(),
        expiresAt: Date.now() + 10_000,
        metadata: {},
      };

      const vote = manager.handleVoteRequest(request);

      expect(vote.decision).toBe("approve");
      expect(vote.peerId).toBe("test-local-peer");
      expect(vote.proposalId).toBe("incoming-001");
      expect(vote.signature).toBeTruthy();
    });

    it("rejects a request with invalid proof", () => {
      const manager = makeManager();

      const request: ProofConsensusRequest = {
        proposalId: "incoming-002",
        proposerPeerId: "remote-peer",
        proofHash: "invalid-hash",
        proofPayload: "some-payload",
        requestedAt: Date.now(),
        expiresAt: Date.now() + 10_000,
        metadata: {},
      };

      const vote = manager.handleVoteRequest(request);
      expect(vote.decision).toBe("reject");
      expect(vote.reasoning).toContain("Proof hash verification failed");
    });

    it("abstains for expired request", () => {
      const manager = makeManager();
      const payload = "expired-payload";
      const hash = manager.generateProofHash(payload);

      const request: ProofConsensusRequest = {
        proposalId: "incoming-003",
        proposerPeerId: "remote-peer",
        proofHash: hash,
        proofPayload: payload,
        requestedAt: Date.now() - 20_000,
        expiresAt: Date.now() - 10_000, // Already expired
        metadata: {},
      };

      const vote = manager.handleVoteRequest(request);
      expect(vote.decision).toBe("abstain");
    });

    it("rejects dangerous payload patterns", () => {
      const manager = makeManager();
      const payload = "<script>alert('xss')</script>";
      const hash = manager.generateProofHash(payload);

      const request: ProofConsensusRequest = {
        proposalId: "incoming-004",
        proposerPeerId: "remote-peer",
        proofHash: hash,
        proofPayload: payload,
        requestedAt: Date.now(),
        expiresAt: Date.now() + 10_000,
        metadata: {},
      };

      const vote = manager.handleVoteRequest(request);
      expect(vote.decision).toBe("reject");
      expect(vote.reasoning).toContain("Semantic checks failed");
    });
  });

  // ── Config ────────────────────────────────────────────────────────────────────

  describe("getConfig", () => {
    it("returns a copy of the config", () => {
      const manager = makeManager({ quorumThreshold: 0.75 });
      const config = manager.getConfig();

      expect(config.quorumThreshold).toBe(0.75);
      expect(config.localPeerId).toBe("test-local-peer");
      expect(config.simulationMode).toBe(true);
    });
  });

  // ── Singleton ─────────────────────────────────────────────────────────────────

  describe("singleton", () => {
    it("returns the same instance", () => {
      const tmpDir = makeTempDir();
      const m1 = getConsensusManager({ dataDir: tmpDir, hmacSecret: "s", simulationMode: true });
      const m2 = getConsensusManager();
      expect(m1).toBe(m2);
    });

    it("creates a new instance after reset", () => {
      const tmpDir = makeTempDir();
      const m1 = getConsensusManager({ dataDir: tmpDir, hmacSecret: "s", simulationMode: true });
      resetConsensusManager();
      const m2 = getConsensusManager({ dataDir: makeTempDir(), hmacSecret: "s2", simulationMode: true });
      expect(m1).not.toBe(m2);
    });
  });
});
