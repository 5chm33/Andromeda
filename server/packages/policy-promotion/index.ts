/**
 * packages/policy-promotion/index.ts — Policy & Promotion Package Boundary
 * Andromeda v5.1 (Elicit recommendation #6 — enforced, not just described)
 *
 * Public API for the policy-promotion package.
 *
 * PROMOTION CONTRACT — A change may only reach main if ALL of the following hold:
 *   1. Patch applies exactly (no fuzzy recovery unless explicitly opted in)
 *   2. Changed files are NOT in the security perimeter (FORBIDDEN_FILES)
 *   3. At least one test actually executed (not timed out, not killed, not skipped)
 *   4. All executed tests passed
 *   5. TypeScript type-check passed (zero errors)
 *   6. Mode is "promote" (not "explore" or "candidate")
 *   7. Evidence bundle signature is valid (tamper detection)
 *
 * Usage:
 *   import { buildEvidenceBundle, canPromote } from
 *     "./packages/policy-promotion/index.js";
 *
 *   const bundle = buildEvidenceBundle({ ... });
 *   const decision = canPromote(bundle);
 *   if (!decision.approved) throw new Error(decision.reason);
 *
 * See: SAFETY.md for the fail-open vs. fail-closed design rationale.
 * See: THREAT_MODEL.md for the adversarial threat surface.
 */

import { createHash } from "crypto";

// ── Evidence Bundle Types ─────────────────────────────────────────────────────

/** The result of executing a single test. */
export interface TestExecutionRecord {
  /** The test identifier (e.g. "server/selfImprove.test.ts > should improve") */
  testId: string;
  /** Whether the test passed. false includes timeout, skip, and indeterminate. */
  passed: boolean;
  /** Duration in milliseconds. */
  durationMs: number;
  /** If failed: the failure message or traceback excerpt. */
  failureReason?: string;
}

/** The result of applying a patch. */
export interface PatchApplicationRecord {
  /** Whether the patch applied exactly (no fuzzy/offset recovery). */
  exactApply: boolean;
  /** Whether fuzzy recovery was attempted (must be false for promotion). */
  fuzzyRecoveryAttempted: boolean;
  /** The files that were modified. */
  modifiedFiles: string[];
  /** SHA-256 of the raw patch string (for audit trail). */
  patchHash: string;
}

/** The result of running the TypeScript type-checker. */
export interface StaticCheckRecord {
  /** Whether tsc --noEmit passed with zero errors. */
  passed: boolean;
  /** Number of TypeScript errors (0 for a passing check). */
  errorCount: number;
  /** First error message if any. */
  firstError?: string;
}

/**
 * The complete evidence bundle that must be produced before a change
 * may be promoted (committed + pushed) to the repository.
 *
 * Immutable once built — the signature covers all fields except itself.
 * Any post-hoc modification invalidates the signature and blocks promotion.
 */
export interface PromotionEvidenceBundle {
  /** ISO-8601 timestamp when the bundle was created. */
  createdAt: string;
  /** Git commit SHA of the agent that produced this change. */
  agentCommit: string;
  /** The target file that was modified. */
  targetFile: string;
  /** Patch application result. */
  patchApplication: PatchApplicationRecord;
  /** Static type-check result. */
  staticCheck: StaticCheckRecord;
  /** All test execution records. At least one must exist. */
  testExecutions: TestExecutionRecord[];
  /** The promotion mode: explore and candidate may not promote. */
  mode: "explore" | "candidate" | "promote";
  /** SHA-256 signature over the bundle content (excluding this field). */
  signature: string;
}

/** The result of the canPromote() gate. */
export interface PromotionDecision {
  approved: boolean;
  reason: string;
  /** The specific gate that blocked promotion, if any. */
  blockedBy?: keyof PromotionGates;
}

/** The individual gates that must all pass for promotion. */
export interface PromotionGates {
  signatureValid: boolean;
  modeIsPromote: boolean;
  changedFilesAllowed: boolean;
  exactPatchApply: boolean;
  noFuzzyRecovery: boolean;
  atLeastOneTestExecuted: boolean;
  allTestsPassed: boolean;
  staticCheckPassed: boolean;
}

// ── Security Perimeter ────────────────────────────────────────────────────────

/**
 * Files that may NEVER be modified by an autonomous promotion.
 * Matches the forbidden list in andromeda-constitution.json.
 */
export const FORBIDDEN_FILES = new Set([
  "server/adminAuth.ts",
  "server/rbac.ts",
  "server/privilegeSeparation.ts",
  "server/gitSandbox.ts",
  "server/recursionGuard.ts",
  "server/constitutionalConstraints.ts",
  "server/polyglotRsi.ts",
  "server/packages/policy-promotion/index.ts",
  "andromeda-constitution.json",
  "SAFETY.md",
  "THREAT_MODEL.md",
]);

// ── Bundle Builder ────────────────────────────────────────────────────────────

/**
 * Builds and signs a PromotionEvidenceBundle from raw execution results.
 * The signature is SHA-256(agentCommit + JSON(bundle_without_signature)).
 */
export function buildEvidenceBundle(params: {
  agentCommit: string;
  targetFile: string;
  patchApplication: PatchApplicationRecord;
  staticCheck: StaticCheckRecord;
  testExecutions: TestExecutionRecord[];
  mode: "explore" | "candidate" | "promote";
}): PromotionEvidenceBundle {
  const bundle: Omit<PromotionEvidenceBundle, "signature"> = {
    createdAt: new Date().toISOString(),
    agentCommit: params.agentCommit,
    targetFile: params.targetFile,
    patchApplication: params.patchApplication,
    staticCheck: params.staticCheck,
    testExecutions: params.testExecutions,
    mode: params.mode,
  };

  const signature = createHash("sha256")
    .update(params.agentCommit)
    .update(JSON.stringify(bundle))
    .digest("hex");

  return { ...bundle, signature };
}

// ── Promotion Gate ────────────────────────────────────────────────────────────

/**
 * The enforcement gate. Returns approved=true only when ALL gates pass.
 * This is the single choke point that all autonomous commits must pass through.
 *
 * Gates are checked in priority order — the first failure is returned.
 * Signature is verified first to detect tampered bundles before any other check.
 */
export function canPromote(bundle: PromotionEvidenceBundle): PromotionDecision {
  // Re-derive the expected signature to verify bundle integrity
  const { signature, ...bundleWithoutSig } = bundle;
  const expectedSig = createHash("sha256")
    .update(bundle.agentCommit)
    .update(JSON.stringify(bundleWithoutSig))
    .digest("hex");

  const forbiddenModified = bundle.patchApplication.modifiedFiles
    .filter(f => FORBIDDEN_FILES.has(f));

  const failedTests = bundle.testExecutions.filter(t => !t.passed);

  const gates: PromotionGates = {
    signatureValid:          signature === expectedSig,
    modeIsPromote:           bundle.mode === "promote",
    changedFilesAllowed:     forbiddenModified.length === 0,
    exactPatchApply:         bundle.patchApplication.exactApply,
    noFuzzyRecovery:         !bundle.patchApplication.fuzzyRecoveryAttempted,
    atLeastOneTestExecuted:  bundle.testExecutions.length > 0,
    allTestsPassed:          failedTests.length === 0,
    staticCheckPassed:       bundle.staticCheck.passed,
  };

  const gateOrder: (keyof PromotionGates)[] = [
    "signatureValid",
    "modeIsPromote",
    "changedFilesAllowed",
    "exactPatchApply",
    "noFuzzyRecovery",
    "atLeastOneTestExecuted",
    "allTestsPassed",
    "staticCheckPassed",
  ];

  const messages: Record<keyof PromotionGates, string> = {
    signatureValid:
      "Evidence bundle signature is invalid — bundle may have been tampered with",
    modeIsPromote:
      `Mode is '${bundle.mode}' — only 'promote' mode may commit to the repository`,
    changedFilesAllowed:
      `Modified files include security-perimeter files: ${forbiddenModified.join(", ")}`,
    exactPatchApply:
      "Patch did not apply exactly — fuzzy or offset recovery is not permitted for promotion",
    noFuzzyRecovery:
      "Fuzzy patch recovery was attempted — this patch must be regenerated cleanly",
    atLeastOneTestExecuted:
      "No tests were executed — at least one test must run and pass before promotion",
    allTestsPassed:
      `${failedTests.length} test(s) failed: ${failedTests.map(t => t.testId).join(", ")}`,
    staticCheckPassed:
      `TypeScript type-check failed with ${bundle.staticCheck.errorCount} error(s): ${
        bundle.staticCheck.firstError ?? "unknown"
      }`,
  };

  for (const gate of gateOrder) {
    if (!gates[gate]) {
      return { approved: false, reason: messages[gate], blockedBy: gate };
    }
  }

  return { approved: true, reason: `All ${gateOrder.length} promotion gates passed` };
}

// ── Re-exports from existing modules ─────────────────────────────────────────

// Promotion guard — enforces the promotion contract at the file-write layer
export {
  runTests,
  guardedApply,
  rollbackToBackup,
  getGuardConfig,
  updateGuardConfig,
  listBackups,
  generateDiffPreview,
} from "../../selfImproveGuard.js";
export type { GuardConfig, BackupEntry, GuardAuditEntry } from "../../selfImproveGuard.js";

// Daemon startup control — used by test isolation
export { isBackgroundDaemonStartupEnabled } from "../../_core/initDaemons.js";

// RBAC — role-based access control for agent operations
export type { Role } from "../../rbac.js";
export {
  roleAtLeast,
  requireRole,
  requireAdmin,
  requireOperator,
  requireEditor,
  requireSystem,
} from "../../rbac.js";

// Recursion guard — prevents infinite self-improvement loops
export {
  canModify,
  recordModification,
  enterRecursion,
  exitRecursion,
  resetGuard,
  getGuardStats,
} from "../../recursionGuard.js";
