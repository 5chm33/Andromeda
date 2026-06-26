/**
 * humanInTheLoopGate.test.ts — Comprehensive tests for humanInTheLoopGate.ts
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import {
  shouldRequireHumanReview,
  queueForHumanReview,
  recordHumanDecision,
  isHumanApproved,
  getPendingReviews,
  getReviewQueue,
  getHITLStats,
  updateHITLConfig,
  pruneExpiredEntries,
} from "./humanInTheLoopGate.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hitl-test-"));
  // Reset config to defaults and clear queue state
  updateHITLConfig({
    minConfidence: 0.75,
    borderlineMargin: 0.08,
    minCriticScore: 5.0,
    criticalFilePatterns: ["auth", "payment", "schema"],
    maxPendingReviews: 50,
    enabled: true,
  });
  // Clear all entries from the queue for test isolation
  const queue = getReviewQueue();
  queue.entries.splice(0);
});

describe("shouldRequireHumanReview — auto_apply path", () => {
  it("returns auto_apply for high confidence, non-critical file", () => {
    const decision = shouldRequireHumanReview("p1", "/server/utils.ts", 0.90);
    expect(decision.action).toBe("auto_apply");
    expect(decision.requiresReview).toBe(false);
  });

  it("returns auto_apply when confidence is exactly at threshold", () => {
    const decision = shouldRequireHumanReview("p1", "/server/utils.ts", 0.75);
    expect(decision.action).toBe("auto_apply");
  });

  it("returns auto_apply when confidence is above threshold with good critic score", () => {
    const decision = shouldRequireHumanReview("p1", "/server/utils.ts", 0.85, 7.5);
    expect(decision.action).toBe("auto_apply");
  });
});

describe("shouldRequireHumanReview — human_review path", () => {
  it("routes critical files to human review", () => {
    const decision = shouldRequireHumanReview("p1", "/server/authMiddleware.ts", 0.95);
    expect(decision.action).toBe("human_review");
    expect(decision.requiresReview).toBe(true);
    expect(decision.reason).toContain("critical file");
  });

  it("routes payment files to human review", () => {
    const decision = shouldRequireHumanReview("p1", "/server/paymentProcessor.ts", 0.99);
    expect(decision.action).toBe("human_review");
  });

  it("routes schema files to human review", () => {
    const decision = shouldRequireHumanReview("p1", "/db/schema.ts", 0.99);
    expect(decision.action).toBe("human_review");
  });

  it("routes borderline confidence to human review", () => {
    // 0.70 is within [0.75 - 0.08, 0.75) = [0.67, 0.75)
    const decision = shouldRequireHumanReview("p1", "/server/utils.ts", 0.70);
    expect(decision.action).toBe("human_review");
    expect(decision.reason).toContain("borderline zone");
  });

  it("routes low Actor-Critic score to human review", () => {
    const decision = shouldRequireHumanReview("p1", "/server/utils.ts", 0.85, 3.5);
    expect(decision.action).toBe("human_review");
    expect(decision.reason).toContain("Actor-Critic score");
  });

  it("routes proposals with >= 2 unresolved MAD issues to human review", () => {
    const decision = shouldRequireHumanReview("p1", "/server/utils.ts", 0.85, 7.0, 2);
    expect(decision.action).toBe("human_review");
    expect(decision.reason).toContain("MAD debate");
  });

  it("does NOT route proposals with 1 MAD issue to human review", () => {
    const decision = shouldRequireHumanReview("p1", "/server/utils.ts", 0.85, 7.0, 1);
    expect(decision.action).toBe("auto_apply");
  });
});

describe("shouldRequireHumanReview — auto_reject path", () => {
  it("auto-rejects proposals below the borderline zone", () => {
    // 0.60 < 0.75 - 0.08 = 0.67 → auto_reject
    const decision = shouldRequireHumanReview("p1", "/server/utils.ts", 0.60);
    expect(decision.action).toBe("auto_reject");
    expect(decision.requiresReview).toBe(false);
  });

  it("auto-rejects proposals with confidence 0", () => {
    const decision = shouldRequireHumanReview("p1", "/server/utils.ts", 0.0);
    expect(decision.action).toBe("auto_reject");
  });
});

describe("shouldRequireHumanReview — disabled gate", () => {
  it("returns auto_apply for everything when gate is disabled", () => {
    updateHITLConfig({ enabled: false });
    const decision = shouldRequireHumanReview("p1", "/server/authMiddleware.ts", 0.1);
    expect(decision.action).toBe("auto_apply");
    updateHITLConfig({ enabled: true });
  });
});

describe("queueForHumanReview", () => {
  it("adds a proposal to the pending queue", () => {
    queueForHumanReview("p1", "/server/auth.ts", "Fix auth bug", 0.70, "Borderline confidence");
    const pending = getPendingReviews();
    expect(pending.length).toBe(1);
    expect(pending[0].proposalId).toBe("p1");
    expect(pending[0].status).toBe("pending");
  });

  it("does not add duplicate entries for the same proposal", () => {
    queueForHumanReview("p1", "/server/auth.ts", "Fix auth bug", 0.70, "Borderline confidence");
    queueForHumanReview("p1", "/server/auth.ts", "Fix auth bug", 0.70, "Borderline confidence");
    const pending = getPendingReviews();
    expect(pending.length).toBe(1);
  });

  it("stores confidence and reason correctly", () => {
    queueForHumanReview("p2", "/server/payment.ts", "Payment fix", 0.68, "Critical file", 4.5, 1);
    const entry = getPendingReviews().find(e => e.proposalId === "p2");
    expect(entry?.confidence).toBe(0.68);
    expect(entry?.reason).toBe("Critical file");
    expect(entry?.criticScore).toBe(4.5);
    expect(entry?.madIssueCount).toBe(1);
  });
});

describe("recordHumanDecision", () => {
  it("approves a pending proposal", () => {
    queueForHumanReview("p1", "/server/auth.ts", "Fix auth", 0.70, "Borderline");
    const success = recordHumanDecision({
      proposalId: "p1",
      decision: "approved",
      reviewedBy: "admin",
      reviewedAt: Date.now(),
    });
    expect(success).toBe(true);
    expect(isHumanApproved("p1")).toBe(true);
  });

  it("rejects a pending proposal", () => {
    queueForHumanReview("p2", "/server/auth.ts", "Fix auth 2", 0.70, "Borderline");
    recordHumanDecision({
      proposalId: "p2",
      decision: "rejected",
      reviewedBy: "admin",
      reviewedAt: Date.now(),
      notes: "Too risky",
    });
    expect(isHumanApproved("p2")).toBe(false);
    const entry = getReviewQueue().entries.find(e => e.proposalId === "p2");
    expect(entry?.status).toBe("rejected");
    expect(entry?.decision?.notes).toBe("Too risky");
  });

  it("returns false for a non-existent proposal", () => {
    const success = recordHumanDecision({
      proposalId: "nonexistent",
      decision: "approved",
      reviewedBy: "admin",
      reviewedAt: Date.now(),
    });
    expect(success).toBe(false);
  });
});

describe("isHumanApproved", () => {
  it("returns false for a proposal that has never been queued", () => {
    expect(isHumanApproved("unknown-proposal")).toBe(false);
  });

  it("returns false for a pending (not yet reviewed) proposal", () => {
    queueForHumanReview("p-pending", "/server/auth.ts", "Pending", 0.70, "Borderline");
    expect(isHumanApproved("p-pending")).toBe(false);
  });
});

describe("getHITLStats", () => {
  it("returns correct stats after queuing and reviewing proposals", () => {
    queueForHumanReview("s1", "/server/auth.ts", "Fix 1", 0.70, "Borderline");
    queueForHumanReview("s2", "/server/auth.ts", "Fix 2", 0.70, "Borderline");
    recordHumanDecision({ proposalId: "s1", decision: "approved", reviewedBy: "admin", reviewedAt: Date.now() });
    const stats = getHITLStats();
    expect(stats.pending).toBe(1);
    expect(stats.approved).toBe(1);
    expect(stats.rejected).toBe(0);
    expect(stats.total).toBe(2);
    expect(stats.enabled).toBe(true);
  });
});

describe("pruneExpiredEntries", () => {
  it("returns 0 when no entries are stale", () => {
    queueForHumanReview("fresh", "/server/auth.ts", "Fresh", 0.70, "Borderline");
    const pruned = pruneExpiredEntries();
    expect(pruned).toBe(0);
  });

  it("expires stale pending entries", () => {
    queueForHumanReview("stale", "/server/auth.ts", "Stale", 0.70, "Borderline");
    // Backdate the entry by 8 days
    const queue = getReviewQueue();
    const entry = queue.entries.find(e => e.proposalId === "stale");
    if (entry) {
      entry.queuedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    }
    const pruned = pruneExpiredEntries();
    expect(pruned).toBe(1);
    const stats = getHITLStats();
    expect(stats.expired).toBe(1);
    expect(stats.pending).toBe(0);
  });
});

describe("updateHITLConfig", () => {
  it("updates minConfidence at runtime", () => {
    updateHITLConfig({ minConfidence: 0.90 });
    // Now 0.85 should be in the borderline zone [0.82, 0.90)
    const decision = shouldRequireHumanReview("p1", "/server/utils.ts", 0.85);
    expect(decision.action).toBe("human_review");
    // Reset
    updateHITLConfig({ minConfidence: 0.75 });
  });

  it("disabling the gate allows all proposals through", () => {
    updateHITLConfig({ enabled: false });
    const decision = shouldRequireHumanReview("p1", "/server/authMiddleware.ts", 0.0);
    expect(decision.action).toBe("auto_apply");
    updateHITLConfig({ enabled: true });
  });
});
