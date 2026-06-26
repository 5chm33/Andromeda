/**
 * guardPipeline.integration.test.ts — v11.293.0
 *
 * Integration tests for the full RSI guard pipeline:
 *   1. generateDiffPreview — produces a valid diff from a proposal
 *   2. listBackups / rollbackToBackup — backup lifecycle
 *   3. getGuardConfig / updateGuardConfig — config round-trip
 *   4. getAuditLog — returns correctly shaped entries
 *   5. sweepExpiredProposals — removes stale proposals
 *   6. shadowInstance.isDockerAvailable — returns a boolean (no crash)
 *   7. shadowInstance.runShadowTest — local fallback returns a result shape
 *   8. ciPipeline.getCiStatus / getCiHistory — returns valid shapes
 *
 * These tests use real filesystem operations but do NOT call any LLM APIs
 * and do NOT modify any production source files.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ── Guard pipeline imports ────────────────────────────────────────────────────
import {
  generateDiffPreview,
  listBackups,
  getGuardConfig,
  updateGuardConfig,
  getAuditLog,
  sweepExpiredProposals,
} from "./selfImproveGuard.js";

// ── Shadow test imports ───────────────────────────────────────────────────────
import { isDockerAvailable, runShadowTest } from "./shadowInstance.js";

// ── CI pipeline imports ───────────────────────────────────────────────────────
import { getCiStatus, getCiHistory } from "./ciPipeline.js";

// ── Test workspace ────────────────────────────────────────────────────────────
const TEST_DIR = join(tmpdir(), `andromeda-guard-test-${Date.now()}`);

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. generateDiffPreview
// ─────────────────────────────────────────────────────────────────────────────
describe("Guard: generateDiffPreview", () => {
  it("should return an object with diff and filename fields", () => {
    // ImprovementProposal shape: { id, targetFile, title, rationale, impact, category,
    //   diff, originalSnippet, proposedSnippet, status, confidence, createdAt, ... }
    const fakeProposal = {
      id: "test-diff-001",
      targetFile: "selfMonitor.ts",
      title: "Test diff",
      rationale: "Testing diff generation",
      impact: "low" as const,
      category: "refactor" as const,
      diff: "-  return 0;\n+  return 42;",
      originalSnippet: "export function foo() { return 0; }\n",
      proposedSnippet: "export function foo() { return 42; }\n",
      status: "pending" as const,
      confidence: 0.9,
      createdAt: Date.now(),
    };
    const result = generateDiffPreview(fakeProposal as any);
    expect(typeof result).toBe("object");
    expect(result).not.toBeNull();
    // Actual return shape: { filename, title, rationale, category, impact, linesRemoved, linesAdded, diff, ... }
    expect(typeof result.filename).toBe("string");
    expect(typeof result.diff).toBe("string");
    expect(typeof result.linesRemoved).toBe("number");
    expect(typeof result.linesAdded).toBe("number");
    expect(typeof result.riskAssessment).toBe("string");
  });

  it("should handle identical content gracefully", () => {
    const snippet = "export const x = 1;\n";
    const fakeProposal = {
      id: "test-diff-002",
      targetFile: "selfMonitor.ts",
      title: "No change",
      rationale: "Testing identical content",
      impact: "low" as const,
      category: "refactor" as const,
      diff: "",
      originalSnippet: snippet,
      proposedSnippet: snippet,
      status: "pending" as const,
      confidence: 0.5,
      createdAt: Date.now(),
    };
    expect(() => generateDiffPreview(fakeProposal as any)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. listBackups
// ─────────────────────────────────────────────────────────────────────────────
describe("Guard: listBackups", () => {
  it("should return an array", () => {
    const backups = listBackups();
    expect(Array.isArray(backups)).toBe(true);
  });

  it("should return backups with correct shape when entries exist", () => {
    // Actual BackupEntry shape: { id, filename, backupPath, originalSize, createdAt: string, proposalId?, reason }
    const backups = listBackups();
    for (const b of backups) {
      expect(typeof b.id).toBe("string");
      expect(typeof b.filename).toBe("string");
      expect(typeof b.backupPath).toBe("string");
      // createdAt is a string (ISO date), not a number
      expect(typeof b.createdAt).toBe("string");
      expect(typeof b.originalSize).toBe("number");
      expect(typeof b.reason).toBe("string");
    }
  });

  it("should support filename filtering", () => {
    const all = listBackups();
    const filtered = listBackups("selfMonitor.ts");
    expect(filtered.length).toBeLessThanOrEqual(all.length);
    for (const b of filtered) {
      expect(b.filename).toBe("selfMonitor.ts");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. getGuardConfig / updateGuardConfig
// ─────────────────────────────────────────────────────────────────────────────
describe("Guard: getGuardConfig / updateGuardConfig", () => {
  it("should return a valid config object", () => {
    // Actual GuardConfig shape: { requireApproval, proposalExpiryMs, runSyntaxCheck,
    //   runTestsBefore, selfRollbackOnTestFailure, maxBackupsPerFile, blockedFiles, metaGuardFiles }
    const config = getGuardConfig();
    expect(typeof config).toBe("object");
    expect(typeof config.requireApproval).toBe("boolean");
    expect(typeof config.runSyntaxCheck).toBe("boolean");
    expect(typeof config.runTestsBefore).toBe("boolean");
    expect(typeof config.selfRollbackOnTestFailure).toBe("boolean");
    expect(typeof config.maxBackupsPerFile).toBe("number");
    expect(config.maxBackupsPerFile).toBeGreaterThan(0);
    expect(Array.isArray(config.blockedFiles)).toBe(true);
  });

  it("should round-trip a config update", () => {
    const original = getGuardConfig();
    const updated = updateGuardConfig({ maxBackupsPerFile: original.maxBackupsPerFile + 1 });
    expect(updated.maxBackupsPerFile).toBe(original.maxBackupsPerFile + 1);
    // Restore original
    updateGuardConfig({ maxBackupsPerFile: original.maxBackupsPerFile });
    const restored = getGuardConfig();
    expect(restored.maxBackupsPerFile).toBe(original.maxBackupsPerFile);
  });

  it("should not allow partial updates to corrupt other fields", () => {
    const original = getGuardConfig();
    updateGuardConfig({ requireApproval: !original.requireApproval });
    const after = getGuardConfig();
    // All other fields should be unchanged
    expect(after.runSyntaxCheck).toBe(original.runSyntaxCheck);
    expect(after.runTestsBefore).toBe(original.runTestsBefore);
    expect(after.maxBackupsPerFile).toBe(original.maxBackupsPerFile);
    // Restore
    updateGuardConfig({ requireApproval: original.requireApproval });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. getAuditLog
// ─────────────────────────────────────────────────────────────────────────────
describe("Guard: getAuditLog", () => {
  it("should return an array", () => {
    const log = getAuditLog();
    expect(Array.isArray(log)).toBe(true);
  });

  it("should respect the limit parameter", () => {
    const log5 = getAuditLog(5);
    expect(log5.length).toBeLessThanOrEqual(5);
    const log50 = getAuditLog(50);
    expect(log50.length).toBeLessThanOrEqual(50);
  });

  it("should return entries with correct shape when entries exist", () => {
    // Actual GuardAuditEntry shape: { id, action, proposalId?, filename?, result, details, timestamp: string }
    const log = getAuditLog(100);
    for (const entry of log) {
      expect(typeof entry.id).toBe("string");
      expect(typeof entry.action).toBe("string");
      // timestamp is a string (ISO date), not a number
      expect(typeof entry.timestamp).toBe("string");
      expect(typeof entry.result).toBe("string");
      expect(typeof entry.details).toBe("string");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. sweepExpiredProposals
// ─────────────────────────────────────────────────────────────────────────────
describe("Guard: sweepExpiredProposals", () => {
  it("should return a non-negative number", () => {
    const swept = sweepExpiredProposals();
    expect(typeof swept).toBe("number");
    expect(swept).toBeGreaterThanOrEqual(0);
  });

  it("should be idempotent — running twice should not increase the count", () => {
    const first = sweepExpiredProposals();
    const second = sweepExpiredProposals();
    // Second run should sweep 0 (nothing new expired)
    expect(second).toBeLessThanOrEqual(first);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. shadowInstance.isDockerAvailable
// ─────────────────────────────────────────────────────────────────────────────
describe("ShadowInstance: isDockerAvailable", () => {
  it("should return a boolean without throwing", () => {
    const result = isDockerAvailable();
    expect(typeof result).toBe("boolean");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. shadowInstance.runShadowTest — local fallback shape
// ─────────────────────────────────────────────────────────────────────────────
describe("ShadowInstance: runShadowTest (local fallback)", () => {
  it("should return a result object with correct shape", async () => {
    // Use a real file that has a test — selfMonitor.ts
    // Actual ShadowTestResult shape: { proposalId, passed, testsPassed, testsFailed, stdout, stderr, durationMs }
    const result = await runShadowTest({
      proposalId: "test-shadow-001",
      targetFile: "selfMonitor.ts",
      patchContent: readFileSync(
        join(process.cwd(), "server", "selfMonitor.ts"),
        "utf-8"
      ),
    });
    expect(typeof result).toBe("object");
    expect(typeof result.passed).toBe("boolean");
    // Field is durationMs, not duration
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.testsPassed).toBe("number");
    expect(typeof result.testsFailed).toBe("number");
    expect(result.testsPassed).toBeGreaterThanOrEqual(0);
    expect(result.testsFailed).toBeGreaterThanOrEqual(0);
    expect(typeof result.stdout).toBe("string");
    expect(typeof result.stderr).toBe("string");
  }, 30_000); // 30s timeout for the vitest subprocess
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. ciPipeline.getCiStatus / getCiHistory
// ─────────────────────────────────────────────────────────────────────────────
describe("CiPipeline: getCiStatus", () => {
  it("should return a valid status object (isRunning, lastResult, history)", () => {
    // Actual shape: { lastResult: CiResult | null, history: CiResult[], isRunning: boolean }
    const status = getCiStatus();
    expect(typeof status).toBe("object");
    // Field is isRunning (not "running")
    expect(typeof status.isRunning).toBe("boolean");
    // history is an array
    expect(Array.isArray(status.history)).toBe(true);
    // lastResult is null or a CiResult
    if (status.lastResult !== null) {
      expect(typeof status.lastResult.runId).toBe("string");
      expect(typeof status.lastResult.success).toBe("boolean");
      expect(Array.isArray(status.lastResult.stages)).toBe(true);
    }
  });
});

describe("CiPipeline: getCiHistory", () => {
  it("should return an array", () => {
    const history = getCiHistory();
    expect(Array.isArray(history)).toBe(true);
  });

  it("should respect the limit parameter", () => {
    const h5 = getCiHistory(5);
    expect(h5.length).toBeLessThanOrEqual(5);
  });

  it("should return entries with correct shape when entries exist", () => {
    // Actual CiResult shape: { runId, triggeredAt, completedAt, totalDurationMs, success, stages, rolledBack }
    const history = getCiHistory(20);
    for (const entry of history) {
      expect(typeof entry.runId).toBe("string");
      expect(typeof entry.triggeredAt).toBe("string");
      expect(typeof entry.completedAt).toBe("string");
      expect(typeof entry.totalDurationMs).toBe("number");
      expect(typeof entry.success).toBe("boolean");
      expect(Array.isArray(entry.stages)).toBe(true);
      expect(typeof entry.rolledBack).toBe("boolean");
    }
  });
});
