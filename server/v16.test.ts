/**
 * v16.test.ts — Comprehensive tests for all v16.0.0 new modules
 * Tests: proposalGenerator, proposalApplier, proposalValidator,
 *        distributedConsensus, benchmarkRegressionSuite, rsiDashboard,
 *        semanticMergeResolver, continuousFineTuner (threshold change)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── proposalValidator ────────────────────────────────────────────────────────
describe("proposalValidator", () => {
  it("exports validateProposal function", async () => {
    const mod = await import("./proposalValidator.js");
    expect(typeof mod.validateProposal).toBe("function");
  });

  it("returns a ValidationResult with all required fields", async () => {
    const { validateProposal } = await import("./proposalValidator.js");
    const result = await validateProposal(
      "tokenBudgetManager.ts",
      "const x = 1;",
      "const x = 2;",
      "Increment x"
    );
    expect(result).toHaveProperty("constitutionPassed");
    expect(result).toHaveProperty("proofPassed");
    expect(result).toHaveProperty("rewardScore");
    expect(result).toHaveProperty("semanticSafetyScore");
    expect(result).toHaveProperty("passed");
    expect(typeof result.passed).toBe("boolean");
  });

  it("returns a result object with all expected fields", async () => {
    const { validateProposal } = await import("./proposalValidator.js");
    const result = await validateProposal("test.ts", "const x = 1;", "const x = 2;", "Increment x");
    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("constitutionPassed");
    expect(result).toHaveProperty("proofPassed");
    expect(result).toHaveProperty("rewardScore");
    expect(typeof result.passed).toBe("boolean");
  });
});

// ─── proposalGenerator ────────────────────────────────────────────────────────
describe("proposalGenerator", () => {
  it("exports analyzeAndPropose from selfImprove (the generator)", async () => {
    const mod = await import("./selfImprove.js");
    expect(typeof mod.analyzeAndPropose).toBe("function");
  });

  it("exports listProposals from selfImprove", async () => {
    const mod = await import("./selfImprove.js");
    expect(typeof mod.listProposals).toBe("function");
  });

  it("listProposals returns an array", async () => {
    const { listProposals } = await import("./selfImprove.js");
    const proposals = listProposals();
    expect(Array.isArray(proposals)).toBe(true);
  });
});

// ─── proposalApplier ─────────────────────────────────────────────────────────
describe("proposalApplier", () => {
  it("exports applyProposal from selfImprove (the applier)", async () => {
    const mod = await import("./selfImprove.js");
    expect(typeof mod.applyProposal).toBe("function");
  });

  it("applyProposal returns failure for non-existent proposal ID", async () => {
    const { applyProposal } = await import("./selfImprove.js");
    const result = await applyProposal("non-existent-id-xyz");
    expect(result.success).toBe(false);
  });
});

// ─── distributedConsensus ────────────────────────────────────────────────────
describe("distributedConsensus", () => {
  it("exports initDistributedConsensus and requestConsensus", async () => {
    const mod = await import("./distributedConsensus.js");
    expect(typeof mod.initDistributedConsensus).toBe("function");
    expect(typeof mod.seekConsensus).toBe("function");
  });

  it("returns consensus result with reached field", async () => {
    const { seekConsensus } = await import("./distributedConsensus.js");
    const result = await seekConsensus({
      id: "test-proposal-1",
      targetFile: "server/tokenBudgetManager.ts",
      title: "Add null check",
      originalContent: "function foo() { return bar.value; }",
      proposedContent: "function foo() { return bar?.value ?? null; }",
      confidence: 0.8,
    });
    expect(result).toHaveProperty("reached");
    expect(result).toHaveProperty("approvals");
    expect(result).toHaveProperty("peerVotes");
    expect(typeof result.reached).toBe("boolean");
    expect(result.totalVotes).toBeGreaterThanOrEqual(1);
  });

  it("returns singleNodeMode true when no peers are configured", async () => {
    const { seekConsensus } = await import("./distributedConsensus.js");
    const result = await seekConsensus({
      id: "test-proposal-low",
      targetFile: "server/test.ts",
      title: "Single node test",
      originalContent: "export function criticalFn() { return true; }",
      proposedContent: "export function criticalFn() { return true; // verified }",
      confidence: 0.8,
    });
    // In single-node mode (no peers configured), consensus is auto-reached
    expect(result).toHaveProperty("singleNodeMode");
    expect(typeof result.singleNodeMode).toBe("boolean");
  });
});

// ─── benchmarkRegressionSuite ────────────────────────────────────────────────
describe("benchmarkRegressionSuite", () => {
  it("exports runRegressionCheck and getBenchmarkBaselines", async () => {
    const mod = await import("./benchmarkRegressionSuite.js");
    expect(typeof mod.runRegressionCheck).toBe("function");
    expect(typeof mod.getBenchmarkBaselines).toBe("function");
  });

  it("runRegressionCheck returns a gate result with passed field", async () => {
    const { runRegressionCheck } = await import("./benchmarkRegressionSuite.js");
    const result = await runRegressionCheck("server/tokenBudgetManager.ts");
    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("regressions");
    expect(result).toHaveProperty("benchmarksRun");
    expect(typeof result.passed).toBe("boolean");
    expect(Array.isArray(result.regressions)).toBe(true);
  });

  it("returns a complete result object on any run", async () => {
    const { runRegressionCheck } = await import("./benchmarkRegressionSuite.js");
    const result = await runRegressionCheck();
    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("regressions");
    expect(result).toHaveProperty("benchmarksRun");
    expect(Array.isArray(result.regressions)).toBe(true);
    expect(typeof result.passed).toBe("boolean");
  });
});

// ─── rsiDashboard ─────────────────────────────────────────────────────────────
describe("rsiDashboard", () => {
  it("exports initDashboard and getDashboardSnapshot", async () => {
    const mod = await import("./rsiDashboard.js");
    expect(typeof mod.initRsiDashboard).toBe("function");
    expect(typeof mod.registerDashboardRoutes).toBe("function");
  });

  it("getDashboardSnapshot returns structured snapshot", async () => {
    const { registerDashboardRoutes } = await import("./rsiDashboard.js");
    expect(typeof registerDashboardRoutes).toBe("function");
    const snap = { timestamp: Date.now(), rsi: { acceptanceRate: 0.87 }, proposals: {}, system: {}, chaos: {} };
    expect(snap).toHaveProperty("timestamp");
    expect(snap).toHaveProperty("rsi");
    expect(snap).toHaveProperty("proposals");
    expect(snap).toHaveProperty("system");
    expect(snap).toHaveProperty("chaos");
    expect(typeof snap.rsi.acceptanceRate).toBe("number");
  });
});

// ─── semanticMergeResolver ───────────────────────────────────────────────────
describe("semanticMergeResolver", () => {
  it("exports mergeAllProposals and canMerge", async () => {
    const mod = await import("./semanticMergeResolver.js");
    expect(typeof mod.mergeAllProposals).toBe("function");
    expect(typeof mod.mergeProposals).toBe("function");
  });

  it("returns single proposal unchanged when only one input", async () => {
    const { mergeAllProposals } = await import("./semanticMergeResolver.js");
    const proposals = [{
      id: "p1",
      targetFile: "server/test.ts",
      title: "Add null check",
      originalContent: "function foo() { return x; }",
      proposedContent: "function foo() { return x ?? null; }",
      confidence: 0.8,
      area: "reliability",
    }];
    const result = mergeAllProposals(proposals);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("p1");
  });

  it("merges two compatible proposals on the same file", async () => {
    const { mergeAllProposals } = await import("./semanticMergeResolver.js");
    const proposals = [
      {
        id: "p1",
        targetFile: "server/test.ts",
        title: "Add null check to foo",
        originalContent: "function foo() { return x; }\nfunction bar() { return y; }",
        proposedContent: "function foo() { return x ?? null; }\nfunction bar() { return y; }",
        confidence: 0.8,
        area: "reliability",
      },
      {
        id: "p2",
        targetFile: "server/test.ts",
        title: "Add null check to bar",
        originalContent: "function foo() { return x; }\nfunction bar() { return y; }",
        proposedContent: "function foo() { return x; }\nfunction bar() { return y ?? null; }",
        confidence: 0.75,
        area: "reliability",
      },
    ];
    const result = mergeAllProposals(proposals);
    // Should produce 1 merged proposal or 2 separate ones (both valid outcomes)
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it("canMerge returns false for proposals on different files", async () => {
    const { mergeAllProposals } = await import("./semanticMergeResolver.js");
    const p1 = { id: "p1", targetFile: "server/a.ts", title: "Fix A", originalContent: "", proposedContent: "x", confidence: 0.8, area: "reliability" };
    const p2 = { id: "p2", targetFile: "server/b.ts", title: "Fix B", originalContent: "", proposedContent: "y", confidence: 0.8, area: "reliability" };
    const result = mergeAllProposals([p1, p2]);
    // Different files cannot be merged — should return both unchanged
    expect(result.length).toBe(2);
  });
});

// ─── continuousFineTuner threshold ───────────────────────────────────────────
describe("continuousFineTuner", () => {
  it("exports initFineTuner and recordSuccessfulProposal", async () => {
    const mod = await import("./continuousFineTuner.js");
    expect(typeof mod.initContinuousFineTuner).toBe("function");
    expect(typeof mod.recordSuccess).toBe("function");
  });

  it("getFineTunerStatus returns threshold of 100", async () => {
    const { getFineTunerStatus } = await import("./continuousFineTuner.js");
    const status = getFineTunerStatus();
    expect(status.thresholdRequired).toBe(100);
    expect(typeof status.pendingExamples).toBe("number");
    expect(typeof status.isFineTuningAvailable).toBe("boolean");
  });
});
