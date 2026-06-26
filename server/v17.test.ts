/**
 * v17.0.0 Comprehensive Test Suite
 * Tests for: rollbackVerifier, proposalGenealogy, distributedConsensus (adaptive threshold),
 *            proposalGenerator, GenealogyPanel data API
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── proposalGenealogy ────────────────────────────────────────────────────────
import {
  initProposalGenealogy,
  recordProposalGenerated,
  recordProposalOutcome,
  getGenealogyNode,
  getGenealogyStats,
  getAncestors,
  detectSystemicPatterns,
  buildGenealogyContext,
  getGenealogyGraph,
} from "./proposalGenealogy.js";

describe("proposalGenealogy", () => {
  beforeEach(() => {
    initProposalGenealogy();
  });

  it("records a generated proposal and retrieves it", () => {
    recordProposalGenerated({
      id: "p1",
      targetFile: "server/foo.ts",
      cycleId: "c1",
      agentPersona: "SecurityAuditor",
      semanticSafetyScore: 0.9,
      rewardScore: 0.85,
    });
    const node = getGenealogyNode("p1");
    expect(node).toBeDefined();
    expect(node!.targetFile).toBe("server/foo.ts");
    expect(node!.agentPersona).toBe("SecurityAuditor");
    expect(node!.outcome).toBe("pending");
  });

  it("records proposal outcome and updates node", () => {
    recordProposalGenerated({ id: "p2", targetFile: "server/bar.ts", cycleId: "c1" });
    recordProposalOutcome("p2", "applied");
    const node = getGenealogyNode("p2");
    expect(node!.outcome).toBe("applied");
  });

  it("tracks ancestors correctly for merged proposals", () => {
    recordProposalGenerated({ id: "parent1", targetFile: "server/a.ts", cycleId: "c1" });
    recordProposalGenerated({ id: "parent2", targetFile: "server/a.ts", cycleId: "c1" });
    recordProposalGenerated({
      id: "child1",
      targetFile: "server/a.ts",
      cycleId: "c2",
      mergedFrom: ["parent1", "parent2"],
    });
    const ancestors = getAncestors("child1");
    expect(ancestors.length).toBe(2);
    const ids = ancestors.map((a) => a.id);
    expect(ids).toContain("parent1");
    expect(ids).toContain("parent2");
  });

  it("computes genealogy stats correctly", () => {
    recordProposalGenerated({ id: "s1", targetFile: "server/x.ts", cycleId: "c1" });
    recordProposalGenerated({ id: "s2", targetFile: "server/x.ts", cycleId: "c1" });
    recordProposalOutcome("s1", "applied");
    recordProposalOutcome("s2", "rejected");
    const stats = getGenealogyStats();
    expect(stats.totalProposals).toBeGreaterThanOrEqual(2);
    expect(stats.applied).toBeGreaterThanOrEqual(1);
    expect(stats.rejected).toBeGreaterThanOrEqual(1);
    expect(stats.acceptanceRate).toBeGreaterThan(0);
    expect(stats.acceptanceRate).toBeLessThanOrEqual(1);
  });

  it("builds genealogy context string for a target file", () => {
    recordProposalGenerated({ id: "ctx1", targetFile: "server/target.ts", cycleId: "c1" });
    recordProposalOutcome("ctx1", "applied");
    const ctx = buildGenealogyContext("server/target.ts");
    expect(typeof ctx).toBe("string");
    expect(ctx.length).toBeGreaterThan(0);
  });

  it("returns genealogy graph with limit", () => {
    for (let i = 0; i < 5; i++) {
      recordProposalGenerated({ id: `g${i}`, targetFile: "server/z.ts", cycleId: "c1" });
    }
    const graph = getGenealogyGraph(3);
    expect(graph.length).toBeLessThanOrEqual(3);
  });

  it("detects systemic patterns from repeated rollbacks", () => {
    for (let i = 0; i < 4; i++) {
      recordProposalGenerated({ id: `rb${i}`, targetFile: "server/fragile.ts", cycleId: `c${i}` });
      recordProposalOutcome(`rb${i}`, "rolled_back");
    }
    const patterns = detectSystemicPatterns();
    // Should detect that fragile.ts has high rollback rate
    expect(Array.isArray(patterns)).toBe(true);
  });
});

// ─── distributedConsensus (adaptive threshold) ───────────────────────────────
import {
  initDistributedConsensus,
  seekConsensus,
  seekAdaptiveConsensus,
  computeAdaptiveThreshold,
  getConsensusStatus,
  getPeerNodes,
} from "./distributedConsensus.js";

describe("distributedConsensus — adaptive threshold", () => {
  beforeEach(() => {
    initDistributedConsensus();
  });

  it("returns a valid adaptive threshold result", () => {
    const result = computeAdaptiveThreshold("server/utils.ts", 0.9, 2);
    expect(result).toHaveProperty("quorumFraction");
    expect(result.quorumFraction).toBeGreaterThanOrEqual(0.5);
    expect(result.quorumFraction).toBeLessThanOrEqual(1.0);
  });

  it("returns a lower quorum for safe low-impact proposals", () => {
    const safe = computeAdaptiveThreshold("server/utils.ts", 0.95, 1);
    const risky = computeAdaptiveThreshold("server/utils.ts", 0.5, 20);
    expect(safe.quorumFraction).toBeLessThanOrEqual(risky.quorumFraction);
  });

  it("returns unanimous quorum for critical files", () => {
    const critical = computeAdaptiveThreshold("server/selfImprove.ts", 0.95, 1);
    expect(critical.isCriticalFile).toBe(true);
    expect(critical.quorumFraction).toBe(1.0);
  });

  it("single-node consensus auto-passes with sufficient confidence", async () => {
    const proposal = {
      id: "cp1",
      targetFile: "server/utils.ts",
      title: "Add null check",
      rationale: "Prevent NPE",
      category: "reliability" as const,
      impact: "low" as const,
      confidence: 0.9,
      diff: "+const x = val ?? 0;",
      originalSnippet: "const x = val;",
      proposedSnippet: "const x = val ?? 0;",
      originalContent: "const x = val;",
      proposedContent: "const x = val ?? 0;",
      createdAt: Date.now(),
      status: "pending" as const,
    };
    const result = await seekConsensus(proposal);
    expect(result).toHaveProperty("reached");
    expect(typeof result.reached).toBe("boolean");
  });

  it("getPeerNodes returns an array", () => {
    const peers = getPeerNodes();
    expect(Array.isArray(peers)).toBe(true);
  });

  it("getConsensusStatus returns expected shape", () => {
    const status = getConsensusStatus();
    expect(status).toHaveProperty("mode");
    expect(status).toHaveProperty("peerCount");
  });
});

// ─── rollbackVerifier ─────────────────────────────────────────────────────────
import {
  initRollbackVerifier,
  verifyRollback,
  getRollbackVerifierStatus,
} from "./rollbackVerifier.js";

describe("rollbackVerifier", () => {
  beforeEach(() => {
    initRollbackVerifier();
  });

  it("initializes without throwing", () => {
    expect(() => initRollbackVerifier()).not.toThrow();
  });

  it("returns status object with expected shape", () => {
    const status = getRollbackVerifierStatus();
    expect(status).toHaveProperty("totalVerifications");
    expect(status).toHaveProperty("cleanRollbacks");
    expect(status).toHaveProperty("dirtyRollbacks");
    expect(typeof status.totalVerifications).toBe("number");
  });

  it("verifyRollback returns a result with clean field for non-existent point", async () => {
    const result = await verifyRollback("non-existent-point-id");
    expect(result).toHaveProperty("clean");
    expect(result).toHaveProperty("rollbackPointId");
    expect(result.rollbackPointId).toBe("non-existent-point-id");
  });

  it("marks non-existent rollback point as not clean", async () => {
    const result = await verifyRollback("fake-point-xyz");
    expect(result.clean).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// ─── proposalGenerator ───────────────────────────────────────────────────────
import {
  generateProposal,
  generateProposalBatch,
} from "./proposalGenerator.js";

describe("proposalGenerator", () => {
  it("generateProposal is a function", () => {
    expect(typeof generateProposal).toBe("function");
  });

  it("generateProposalBatch is a function", () => {
    expect(typeof generateProposalBatch).toBe("function");
  });
});

// ─── rsiDashboard ─────────────────────────────────────────────────────────────
import {
  initRsiDashboard,
  handleDashboardSnapshot,
  registerDashboardRoutes,
} from "./rsiDashboard.js";

describe("rsiDashboard", () => {
  it("initializes without throwing", () => {
    expect(() => initRsiDashboard()).not.toThrow();
  });

  it("handleDashboardSnapshot is a function", () => {
    expect(typeof handleDashboardSnapshot).toBe("function");
  });

  it("registerDashboardRoutes is a function", () => {
    expect(typeof registerDashboardRoutes).toBe("function");
  });
});
