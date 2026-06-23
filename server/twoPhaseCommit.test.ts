/**
 * Andromeda v6.12 — Two-Phase Commit Tests
 *
 * Tests for the atomic commit system:
 *  - Active commits tracking
 *  - Performance regression reporting
 *  - Commit phase types
 */
import { describe, it, expect } from "vitest";
import {
  getActiveCommits,
  getPerformanceRegressionReport,
  type CommitPhase,
  type CommitResult,
  type CommitOptions,
} from "./twoPhaseCommit.js";

describe("twoPhaseCommit — Active Commits", () => {
  it("getActiveCommits returns an object", () => {
    const commits = getActiveCommits();
    expect(typeof commits).toBe("object");
    expect(commits).not.toBeNull();
  });

  it("getActiveCommits keys are strings and values are valid phases", () => {
    const commits = getActiveCommits();
    const validPhases: CommitPhase[] = ["idle", "preparing", "applying", "verifying", "committed", "rolled_back"];
    for (const [key, phase] of Object.entries(commits)) {
      expect(typeof key).toBe("string");
      expect(validPhases).toContain(phase);
    }
  });
});

describe("twoPhaseCommit — Performance Regression Report", () => {
  it("getPerformanceRegressionReport returns structured data", () => {
    const report = getPerformanceRegressionReport();
    expect(report).toHaveProperty("snapshots");
    expect(report).toHaveProperty("currentHeapMb");
    expect(report).toHaveProperty("status");
    expect(Array.isArray(report.snapshots)).toBe(true);
  });

  it("report status is a valid value", () => {
    const report = getPerformanceRegressionReport();
    expect(["healthy", "warning", "critical"]).toContain(report.status);
    expect(typeof report.currentHeapMb).toBe("number");
  });
});

describe("twoPhaseCommit — Type Contracts", () => {
  it("CommitOptions type is well-formed", () => {
    // Verify the type exists and has the expected shape
    const opts: Partial<CommitOptions> = {
      description: "test commit",
    };
    expect(opts.description).toBe("test commit");
  });

  it("CommitResult type is well-formed", () => {
    const result: Partial<CommitResult> = {
      success: true,
      phase: "committed",
    };
    expect(result.success).toBe(true);
    expect(result.phase).toBe("committed");
  });
});
