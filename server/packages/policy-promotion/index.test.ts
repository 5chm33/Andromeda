/**
 * policy-promotion/index.test.ts
 * Tests for the PromotionEvidenceBundle and canPromote() enforcement gate.
 */

import { describe, it, expect } from "vitest";
import {
  buildEvidenceBundle,
  canPromote,
  FORBIDDEN_FILES,
  type PatchApplicationRecord,
  type StaticCheckRecord,
  type TestExecutionRecord,
} from "./index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBundle(overrides: Partial<{
  mode: "explore" | "candidate" | "promote";
  exactApply: boolean;
  fuzzyRecovery: boolean;
  modifiedFiles: string[];
  tests: TestExecutionRecord[];
  staticPassed: boolean;
  staticErrors: number;
}> = {}) {
  const patch: PatchApplicationRecord = {
    exactApply: overrides.exactApply ?? true,
    fuzzyRecoveryAttempted: overrides.fuzzyRecovery ?? false,
    modifiedFiles: overrides.modifiedFiles ?? ["server/selfImprove.ts"],
    patchHash: "abc123",
  };
  const staticCheck: StaticCheckRecord = {
    passed: overrides.staticPassed ?? true,
    errorCount: overrides.staticErrors ?? 0,
  };
  const tests: TestExecutionRecord[] = overrides.tests ?? [
    { testId: "server/selfImprove.test.ts > should improve", passed: true, durationMs: 120 },
  ];
  return buildEvidenceBundle({
    agentCommit: "deadbeef1234",
    targetFile: "server/selfImprove.ts",
    patchApplication: patch,
    staticCheck,
    testExecutions: tests,
    mode: overrides.mode ?? "promote",
    probeVerdict: "confirmed",
    sandboxControls: {
      networkNone: true,
      capDropAll: true,
      noNewPrivileges: true,
      pidsLimit: 256,
      memoryLimit: "4g",
      cpuLimit: "2.0",
      wallClockLimitMs: 300000,
      readOnly: true,
      effectiveUser: "nobody",
      imageDigest: "sha256:abc123deadbeef",
      hostDockerSocketMounted: false,
      privileged: false,
    },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("buildEvidenceBundle", () => {
  it("produces a bundle with a valid signature", () => {
    const bundle = makeBundle();
    expect(bundle.signature).toHaveLength(64); // SHA-256 hex
    expect(bundle.createdAt).toBeTruthy();
    expect(bundle.agentCommit).toBe("deadbeef1234");
  });

  it("produces different signatures for different agent commits", () => {
    const b1 = buildEvidenceBundle({
      agentCommit: "aaa",
      targetFile: "server/selfImprove.ts",
      patchApplication: { exactApply: true, fuzzyRecoveryAttempted: false, modifiedFiles: [], patchHash: "x" },
      staticCheck: { passed: true, errorCount: 0 },
      testExecutions: [{ testId: "t1", passed: true, durationMs: 1 }],
      mode: "promote",
    });
    const b2 = buildEvidenceBundle({
      agentCommit: "bbb",
      targetFile: "server/selfImprove.ts",
      patchApplication: { exactApply: true, fuzzyRecoveryAttempted: false, modifiedFiles: [], patchHash: "x" },
      staticCheck: { passed: true, errorCount: 0 },
      testExecutions: [{ testId: "t1", passed: true, durationMs: 1 }],
      mode: "promote",
    });
    expect(b1.signature).not.toBe(b2.signature);
  });
});

describe("canPromote — happy path", () => {
  it("approves a fully valid bundle", () => {
    const decision = canPromote(makeBundle());
    expect(decision.approved).toBe(true);
    expect(decision.blockedBy).toBeUndefined();
  });
});

describe("canPromote — gate: signatureValid", () => {
  it("rejects a tampered bundle", () => {
    const bundle = makeBundle();
    // Tamper with the bundle after signing
    const tampered = { ...bundle, agentCommit: "evil_commit" };
    const decision = canPromote(tampered);
    expect(decision.approved).toBe(false);
    expect(decision.blockedBy).toBe("signatureValid");
  });
});

describe("canPromote — gate: modeIsPromote", () => {
  it("rejects explore mode", () => {
    const decision = canPromote(makeBundle({ mode: "explore" }));
    expect(decision.approved).toBe(false);
    expect(decision.blockedBy).toBe("modeIsPromote");
  });

  it("rejects candidate mode", () => {
    const decision = canPromote(makeBundle({ mode: "candidate" }));
    expect(decision.approved).toBe(false);
    expect(decision.blockedBy).toBe("modeIsPromote");
  });
});

describe("canPromote — gate: changedFilesAllowed", () => {
  it("rejects changes to security perimeter files", () => {
    const decision = canPromote(makeBundle({ modifiedFiles: ["server/adminAuth.ts"] }));
    expect(decision.approved).toBe(false);
    expect(decision.blockedBy).toBe("changedFilesAllowed");
  });

  it("rejects changes to the promotion gate itself", () => {
    const decision = canPromote(makeBundle({
      modifiedFiles: ["server/packages/policy-promotion/index.ts"],
    }));
    expect(decision.approved).toBe(false);
    expect(decision.blockedBy).toBe("changedFilesAllowed");
  });

  it("allows changes to non-perimeter files", () => {
    const decision = canPromote(makeBundle({ modifiedFiles: ["server/selfImprove.ts"] }));
    expect(decision.approved).toBe(true);
  });
});

describe("canPromote — gate: exactPatchApply", () => {
  it("rejects fuzzy patch application", () => {
    const decision = canPromote(makeBundle({ exactApply: false }));
    expect(decision.approved).toBe(false);
    expect(decision.blockedBy).toBe("exactPatchApply");
  });
});

describe("canPromote — gate: noFuzzyRecovery", () => {
  it("rejects when fuzzy recovery was attempted even if it succeeded", () => {
    const decision = canPromote(makeBundle({ fuzzyRecovery: true }));
    expect(decision.approved).toBe(false);
    expect(decision.blockedBy).toBe("noFuzzyRecovery");
  });
});

describe("canPromote — gate: atLeastOneTestExecuted", () => {
  it("rejects when no tests were executed", () => {
    const decision = canPromote(makeBundle({ tests: [] }));
    expect(decision.approved).toBe(false);
    expect(decision.blockedBy).toBe("atLeastOneTestExecuted");
  });
});

describe("canPromote — gate: allTestsPassed", () => {
  it("rejects when any test failed", () => {
    const decision = canPromote(makeBundle({
      tests: [
        { testId: "t1", passed: true, durationMs: 10 },
        { testId: "t2", passed: false, durationMs: 5, failureReason: "assertion failed" },
      ],
    }));
    expect(decision.approved).toBe(false);
    expect(decision.blockedBy).toBe("allTestsPassed");
    expect(decision.reason).toContain("t2");
  });

  it("rejects when a test timed out (passed=false)", () => {
    const decision = canPromote(makeBundle({
      tests: [{ testId: "t1", passed: false, durationMs: 30000, failureReason: "timeout" }],
    }));
    expect(decision.approved).toBe(false);
    expect(decision.blockedBy).toBe("allTestsPassed");
  });
});

describe("canPromote — gate: staticCheckPassed", () => {
  it("rejects when TypeScript type-check failed", () => {
    const decision = canPromote(makeBundle({
      staticPassed: false,
      staticErrors: 3,
    }));
    expect(decision.approved).toBe(false);
    expect(decision.blockedBy).toBe("staticCheckPassed");
    expect(decision.reason).toContain("3 error");
  });
});

describe("FORBIDDEN_FILES", () => {
  it("includes all security perimeter files", () => {
    expect(FORBIDDEN_FILES.has("server/adminAuth.ts")).toBe(true);
    expect(FORBIDDEN_FILES.has("server/rbac.ts")).toBe(true);
    expect(FORBIDDEN_FILES.has("server/gitSandbox.ts")).toBe(true);
    expect(FORBIDDEN_FILES.has("andromeda-constitution.json")).toBe(true);
    expect(FORBIDDEN_FILES.has("THREAT_MODEL.md")).toBe(true);
  });

  it("does not include normal source files", () => {
    expect(FORBIDDEN_FILES.has("server/selfImprove.ts")).toBe(false);
    expect(FORBIDDEN_FILES.has("server/reactEngine.ts")).toBe(false);
  });
});
