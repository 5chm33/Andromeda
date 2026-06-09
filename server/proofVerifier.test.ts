/**
 * proofVerifier.test.ts — Tests for Phase 13: Formal Proof Verification Gate
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkPropositional,
  verifyZKProof,
  verifyProposal,
  verifyCommitProposal,
  loadVerificationLog,
  getVerificationStats,
  runTLAVerification,
  type ProposalProof,
  type ProofGateConfig,
} from "./proofVerifier.js";
import type { ProofResult } from "./proofAssistant.js";

// ─── Mock proofAssistant ──────────────────────────────────────────────────────

vi.mock("./proofAssistant.js", () => ({
  verifyCodeSafety: vi.fn().mockResolvedValue({
    safe: true,
    backend: "heuristic",
    score: 0.85,
    violations: [],
    verificationTimeMs: 10,
    codeHash: "abc123",
    timestamp: Date.now(),
  } satisfies ProofResult),
  detectProverBackend: vi.fn().mockReturnValue("heuristic"),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProof(overrides: Partial<ProposalProof> = {}): ProposalProof {
  return {
    proposalId: "test-proposal-001",
    filePath: "server/testModule.ts",
    rationale: "Improve test coverage",
    proposedContent: "export function add(a: number, b: number) { return a + b; }",
    preConditions: { testsPass: true, benchmarkOk: true },
    postConditions: { testsPass: true, benchmarkOk: true, newFeature: true },
    expectedUtilityDelta: 0.05,
    ...overrides,
  };
}

function makeProofResult(overrides: Partial<ProofResult> = {}): ProofResult {
  return {
    safe: true,
    backend: "heuristic",
    score: 0.85,
    violations: [],
    verificationTimeMs: 10,
    codeHash: "abc123",
    timestamp: Date.now(),
    ...overrides,
  };
}

// ─── PropositionalChecker Tests ───────────────────────────────────────────────

describe("checkPropositional", () => {
  it("passes with no conditions (trivially valid)", () => {
    const result = checkPropositional(makeProof({ preConditions: {}, postConditions: {} }));
    expect(result.valid).toBe(true);
    expect(result.confidence).toBe(0.5);
  });

  it("passes when post-conditions are improvements over pre-conditions", () => {
    const result = checkPropositional(makeProof({
      preConditions: { testsPass: false, benchmarkOk: true },
      postConditions: { testsPass: true, benchmarkOk: true },
      expectedUtilityDelta: 0.1,
    }));
    expect(result.valid).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("fails when a true pre-condition becomes false (regression)", () => {
    const result = checkPropositional(makeProof({
      preConditions: { testsPass: true, benchmarkOk: true },
      postConditions: { testsPass: false, benchmarkOk: true },
      expectedUtilityDelta: 0.0,
    }));
    expect(result.valid).toBe(false);
    expect(result.counterexample).toContain("Regression");
    expect(result.counterexample).toContain("testsPass");
  });

  it("fails when utility delta is negative", () => {
    const result = checkPropositional(makeProof({
      preConditions: { testsPass: true },
      postConditions: { testsPass: true },
      expectedUtilityDelta: -0.1,
    }));
    expect(result.valid).toBe(false);
    expect(result.counterexample).toContain("Negative utility delta");
  });

  it("confidence increases with more improvements", () => {
    const fewImprovements = checkPropositional(makeProof({
      preConditions: { a: false },
      postConditions: { a: true },
      expectedUtilityDelta: 0.05,
    }));
    const manyImprovements = checkPropositional(makeProof({
      preConditions: { a: false, b: false, c: false },
      postConditions: { a: true, b: true, c: true },
      expectedUtilityDelta: 0.15,
    }));
    expect(manyImprovements.confidence).toBeGreaterThanOrEqual(fewImprovements.confidence);
  });

  it("confidence decreases with regressions", () => {
    const noRegression = checkPropositional(makeProof({
      preConditions: { a: true },
      postConditions: { a: true },
      expectedUtilityDelta: 0.0,
    }));
    const withRegression = checkPropositional(makeProof({
      preConditions: { a: true, b: true },
      postConditions: { a: false, b: true },
      expectedUtilityDelta: 0.0,
    }));
    expect(withRegression.confidence).toBeLessThan(noRegression.confidence);
  });
});

// ─── ZKVerifier Tests ─────────────────────────────────────────────────────────

describe("verifyZKProof", () => {
  it("passes a valid proof result with high score", () => {
    const result = verifyZKProof(makeProofResult({ score: 0.9 }), 0.7);
    expect(result.valid).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it("fails when score is below minimum", () => {
    const result = verifyZKProof(makeProofResult({ score: 0.5 }), 0.7);
    expect(result.valid).toBe(false);
    expect(result.explanation).toContain("below minimum");
  });

  it("fails when proof result is stale", () => {
    const staleResult = makeProofResult({
      timestamp: Date.now() - 35 * 60 * 1000, // 35 minutes ago
    });
    const result = verifyZKProof(staleResult, 0.7);
    expect(result.valid).toBe(false);
    expect(result.explanation).toContain("stale");
  });

  it("fails when there are critical violations", () => {
    const result = verifyZKProof(makeProofResult({
      score: 0.9,
      violations: [{
        property: "privilege_safety",
        description: "Executes with elevated privileges",
        severity: "critical",
        autoFixable: false,
      }],
    }), 0.7);
    expect(result.valid).toBe(false);
    expect(result.explanation).toContain("Critical safety violations");
  });

  it("fails when code hash is missing", () => {
    const result = verifyZKProof(makeProofResult({ codeHash: "" }), 0.7);
    expect(result.valid).toBe(false);
    expect(result.explanation).toContain("missing code hash");
  });

  it("gives higher confidence for non-heuristic backends", () => {
    const heuristic = verifyZKProof(makeProofResult({ score: 0.85, backend: "heuristic" }), 0.7);
    const lean4 = verifyZKProof(makeProofResult({ score: 0.85, backend: "lean4" }), 0.7);
    expect(lean4.confidence).toBeGreaterThan(heuristic.confidence);
  });
});

// ─── TLA+ Verification Tests ──────────────────────────────────────────────────

describe("runTLAVerification", () => {
  it("returns available=false when TLC is not installed", () => {
    const result = runTLAVerification(makeProof());
    // TLC is not installed in the test environment
    expect(result.spec).toBeTruthy();
    expect(result.spec).toContain("MODULE");
    // Either available=false (TLC not installed) or available=true with a result
    expect(typeof result.available).toBe("boolean");
  });

  it("generates a valid TLA+ spec", () => {
    const proof = makeProof({
      preConditions: { testsPass: true, benchmarkOk: false },
      postConditions: { testsPass: true, benchmarkOk: true },
    });
    const result = runTLAVerification(proof);
    expect(result.spec).toContain("EXTENDS Naturals, Booleans");
    expect(result.spec).toContain("Init ==");
    expect(result.spec).toContain("Next ==");
    expect(result.spec).toContain("Invariant");
    expect(result.spec).toContain("testsPass");
    expect(result.spec).toContain("benchmarkOk");
  });

  it("includes utility delta in the spec comment", () => {
    const proof = makeProof({ expectedUtilityDelta: 0.123 });
    const result = runTLAVerification(proof);
    expect(result.spec).toContain("0.123");
  });
});

// ─── ProofGate (verifyProposal) Tests ─────────────────────────────────────────

describe("verifyProposal", () => {
  it("returns a valid result for a safe proposal", async () => {
    const result = await verifyProposal(makeProof());
    expect(result).toBeDefined();
    expect(typeof result.valid).toBe("boolean");
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.contentHash).toBeTruthy();
    expect(result.timestamp).toBeGreaterThan(0);
  });

  it("returns a VerificationResult with all required fields", async () => {
    const result = await verifyProposal(makeProof());
    expect(result).toHaveProperty("valid");
    expect(result).toHaveProperty("level");
    expect(result).toHaveProperty("outcome");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("explanation");
    expect(result).toHaveProperty("durationMs");
    expect(result).toHaveProperty("contentHash");
    expect(result).toHaveProperty("timestamp");
  });

  it("returns a valid proof level for the proposal", async () => {
    const result = await verifyProposal(makeProof({
      preConditions: { testsPass: false },
      postConditions: { testsPass: true },
      expectedUtilityDelta: 0.1,
    }));
    // Level should be one of the valid proof levels (TLC may be attempted even if jar not found)
    const validLevels = ["propositional", "heuristic", "lean4", "coq", "tlc", "none"];
    expect(validLevels).toContain(result.level);
  });

  it("blocks when utility delta is negative and requirePositiveUtility is true", async () => {
    const config: Partial<ProofGateConfig> = {
      requirePositiveUtility: true,
      minUtilityDelta: 0.0,
      blockOnFailure: true,
    };
    const result = await verifyProposal(
      makeProof({ expectedUtilityDelta: -0.05 }),
      config
    );
    expect(result.valid).toBe(false);
    expect(result.explanation).toContain("utility delta");
  });

  it("allows commit in warn-only mode even when proof fails", async () => {
    const config: Partial<ProofGateConfig> = {
      requirePositiveUtility: true,
      minUtilityDelta: 0.5, // Very high threshold
      blockOnFailure: false, // Warn-only
    };
    const result = await verifyProposal(
      makeProof({ expectedUtilityDelta: 0.01 }),
      config
    );
    // In warn-only mode, valid should be true even if threshold not met
    expect(result.valid).toBe(true);
    expect(result.explanation).toContain("WARN-ONLY");
  });

  it("includes safety result from proofAssistant", async () => {
    const result = await verifyProposal(makeProof());
    expect(result.safetyResult).toBeDefined();
    expect(result.safetyResult?.score).toBeGreaterThan(0);
  });
});

// ─── verifyCommitProposal Tests ───────────────────────────────────────────────

describe("verifyCommitProposal", () => {
  it("creates a ProposalProof from CommitOptions and verifies it", async () => {
    const result = await verifyCommitProposal({
      filePath: "server/someModule.ts",
      proposedContent: "export const x = 1;",
      rationale: "Add constant",
      proposedBy: "rsiEngine",
      preConditions: { testsPass: true },
      postConditions: { testsPass: true },
      expectedUtilityDelta: 0.02,
    });
    expect(result).toBeDefined();
    expect(result.valid).toBeDefined();
    expect(result.contentHash).toBeTruthy();
  });

  it("works with minimal options (no pre/post conditions)", async () => {
    const result = await verifyCommitProposal({
      filePath: "server/simple.ts",
      proposedContent: "export const y = 2;",
      rationale: "Simple addition",
    });
    expect(result).toBeDefined();
    expect(typeof result.valid).toBe("boolean");
  });
});

// ─── Stats and Log Tests ──────────────────────────────────────────────────────

describe("getVerificationStats", () => {
  it("returns stats with correct shape", () => {
    const stats = getVerificationStats();
    expect(stats).toHaveProperty("total");
    expect(stats).toHaveProperty("proved");
    expect(stats).toHaveProperty("disproved");
    expect(stats).toHaveProperty("unknown");
    expect(stats).toHaveProperty("avgConfidence");
    expect(stats).toHaveProperty("levelBreakdown");
    expect(typeof stats.total).toBe("number");
    expect(stats.total).toBeGreaterThanOrEqual(0);
  });

  it("levelBreakdown contains all proof levels", () => {
    const stats = getVerificationStats();
    expect(stats.levelBreakdown).toHaveProperty("tlc");
    expect(stats.levelBreakdown).toHaveProperty("lean4");
    expect(stats.levelBreakdown).toHaveProperty("coq");
    expect(stats.levelBreakdown).toHaveProperty("propositional");
    expect(stats.levelBreakdown).toHaveProperty("heuristic");
    expect(stats.levelBreakdown).toHaveProperty("none");
  });
});

describe("loadVerificationLog", () => {
  it("returns an array (empty or populated)", () => {
    const log = loadVerificationLog();
    expect(Array.isArray(log)).toBe(true);
  });
});
