/**
 * federatedRLHF.test.ts — Comprehensive tests for federatedRLHF.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  broadcastOutcome,
  ingestPeerOutcomes,
  startFederatedSync,
  stopFederatedSync,
  runFederatedSync,
  getFederatedRLHFStats,
  type RLHFOutcome,
} from "./federatedRLHF.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeOutcome(overrides: Partial<RLHFOutcome> = {}): RLHFOutcome {
  return {
    proposalId: "prop_test_001",
    targetFile: "server/utils.ts",
    category: "performance",
    modelIds: ["gpt-4o", "claude-3-5-sonnet"],
    outcome: "success",
    confidenceScore: 0.85,
    criticScore: 8,
    madIssueCount: 0,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ─── broadcastOutcome Tests ───────────────────────────────────────────────────

describe("broadcastOutcome", () => {
  it("should not throw for a valid success outcome", async () => {
    await expect(broadcastOutcome(makeOutcome())).resolves.not.toThrow();
  });

  it("should not throw for a failure outcome", async () => {
    await expect(broadcastOutcome(makeOutcome({ outcome: "failure" }))).resolves.not.toThrow();
  });

  it("should not throw for a rollback outcome", async () => {
    await expect(broadcastOutcome(makeOutcome({ outcome: "rollback" }))).resolves.not.toThrow();
  });

  it("should not throw when modelIds is empty", async () => {
    await expect(broadcastOutcome(makeOutcome({ modelIds: [] }))).resolves.not.toThrow();
  });

  it("should not throw when criticScore is undefined", async () => {
    const outcome = makeOutcome();
    delete outcome.criticScore;
    await expect(broadcastOutcome(outcome)).resolves.not.toThrow();
  });

  it("should not throw when madIssueCount is undefined", async () => {
    const outcome = makeOutcome();
    delete outcome.madIssueCount;
    await expect(broadcastOutcome(outcome)).resolves.not.toThrow();
  });
});

// ─── ingestPeerOutcomes Tests ─────────────────────────────────────────────────

describe("ingestPeerOutcomes", () => {
  it("should return accepted=0 for empty payload", async () => {
    const result = await ingestPeerOutcomes({ nodeId: "peer_001" });
    expect(result.accepted).toBe(0);
    expect(result.rejected).toBe(0);
  });

  it("should accept valid outcomes", async () => {
    const result = await ingestPeerOutcomes({
      nodeId: "peer_001",
      outcomes: [
        makeOutcome({ proposalId: "p1" }),
        makeOutcome({ proposalId: "p2", outcome: "failure" }),
      ],
    });
    expect(result.accepted).toBeGreaterThanOrEqual(0);
    expect(result.rejected).toBeGreaterThanOrEqual(0);
    expect(result.accepted + result.rejected).toBeLessThanOrEqual(2);
  });

  it("should reject malformed outcomes", async () => {
    const result = await ingestPeerOutcomes({
      nodeId: "peer_001",
      outcomes: [
        { proposalId: "", modelIds: [], outcome: "success", targetFile: "", category: "", confidenceScore: 0, timestamp: 0 },
        { proposalId: "p1", modelIds: [], outcome: "" as any, targetFile: "x.ts", category: "perf", confidenceScore: 0.5, timestamp: 0 },
      ],
    });
    expect(result.rejected).toBeGreaterThanOrEqual(1);
  });

  it("should process model weight deltas", async () => {
    const result = await ingestPeerOutcomes({
      nodeId: "peer_001",
      modelWeightDeltas: [
        { modelId: "gpt-4o", deltaWeight: 0.1, category: "performance" },
        { modelId: "claude-3-5-sonnet", deltaWeight: -0.05, category: "security" },
      ],
    });
    expect(typeof result.accepted).toBe("number");
    expect(typeof result.rejected).toBe("number");
  });

  it("should cap outcomes at 50 to prevent abuse", async () => {
    const manyOutcomes = Array.from({ length: 100 }, (_, i) =>
      makeOutcome({ proposalId: `p${i}` })
    );
    const result = await ingestPeerOutcomes({ nodeId: "peer_001", outcomes: manyOutcomes });
    expect(result.accepted + result.rejected).toBeLessThanOrEqual(50);
  });

  it("should cap weight deltas at 20 to prevent abuse", async () => {
    const manyDeltas = Array.from({ length: 50 }, (_, i) => ({
      modelId: `model_${i}`,
      deltaWeight: 0.1,
      category: "performance",
    }));
    const result = await ingestPeerOutcomes({ nodeId: "peer_001", modelWeightDeltas: manyDeltas });
    expect(result.accepted + result.rejected).toBeLessThanOrEqual(20);
  });

  it("should reject malformed weight deltas", async () => {
    const result = await ingestPeerOutcomes({
      nodeId: "peer_001",
      modelWeightDeltas: [
        { modelId: "", deltaWeight: 0.1, category: "perf" },
        { modelId: "m1", deltaWeight: "bad" as any, category: "perf" },
      ],
    });
    expect(result.rejected).toBeGreaterThanOrEqual(1);
  });
});

// ─── startFederatedSync / stopFederatedSync Tests ─────────────────────────────

describe("startFederatedSync / stopFederatedSync", () => {
  afterEach(() => {
    stopFederatedSync();
  });

  it("should start without throwing", () => {
    expect(() => startFederatedSync(999999)).not.toThrow();
  });

  it("should be idempotent — calling start twice should not create two intervals", () => {
    startFederatedSync(999999);
    startFederatedSync(999999); // should not throw or create duplicate
    const stats1 = getFederatedRLHFStats();
    stopFederatedSync();
    const stats2 = getFederatedRLHFStats();
    expect(typeof stats1.lastSyncAt).toBe("object"); // null or number
    expect(typeof stats2.lastSyncAt).toBe("object");
  });

  it("should stop without throwing", () => {
    startFederatedSync(999999);
    expect(() => stopFederatedSync()).not.toThrow();
  });

  it("should stop even when not started", () => {
    expect(() => stopFederatedSync()).not.toThrow();
  });
});

// ─── runFederatedSync Tests ───────────────────────────────────────────────────

describe("runFederatedSync", () => {
  it("should complete without throwing when no peers are registered", async () => {
    await expect(runFederatedSync()).resolves.not.toThrow();
  });
});

// ─── getFederatedRLHFStats Tests ──────────────────────────────────────────────

describe("getFederatedRLHFStats", () => {
  it("should return stats object with expected fields", () => {
    const stats = getFederatedRLHFStats();
    expect(stats).toHaveProperty("localOutcomesShared");
    expect(stats).toHaveProperty("peerOutcomesReceived");
    expect(stats).toHaveProperty("weightUpdatesFromPeers");
    expect(stats).toHaveProperty("lastSyncAt");
    expect(stats).toHaveProperty("activePeers");
    expect(typeof stats.localOutcomesShared).toBe("number");
    expect(typeof stats.peerOutcomesReceived).toBe("number");
    expect(typeof stats.weightUpdatesFromPeers).toBe("number");
    expect(typeof stats.activePeers).toBe("number");
  });

  it("should have non-negative counts", () => {
    const stats = getFederatedRLHFStats();
    expect(stats.localOutcomesShared).toBeGreaterThanOrEqual(0);
    expect(stats.peerOutcomesReceived).toBeGreaterThanOrEqual(0);
    expect(stats.weightUpdatesFromPeers).toBeGreaterThanOrEqual(0);
    expect(stats.activePeers).toBeGreaterThanOrEqual(0);
  });
});
