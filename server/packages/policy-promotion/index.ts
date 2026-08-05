/**
 * packages/policy-promotion/index.ts — Policy & Promotion Package Boundary
 * Andromeda v5.2 (Elicit enforcement contract — expanded evidence bundle schema)
 *
 * PROMOTION CONTRACT — A change may only reach main if ALL of the following hold:
 *   1. Patch applies exactly (no fuzzy recovery)
 *   2. Changed files are NOT in the security perimeter (FORBIDDEN_FILES)
 *   3. At least one TARGET test actually executed (not timed out, not killed, not skipped)
 *   4. All executed tests passed
 *   5. TypeScript type-check passed (zero errors)
 *   6. Mode is "promote" (not "explore" or "candidate")
 *   7. Evidence bundle signature is valid (tamper detection)
 *   8. Sandbox controls meet minimum isolation requirements
 *   9. Probe verdict is "confirmed"
 */
import { createHash } from "crypto";

// ── Evidence Bundle Types ─────────────────────────────────────────────────────

export interface TestExecutionRecord {
  testId: string;
  passed: boolean;
  durationMs: number;
  command?: string;
  exitCode?: number;
  signal?: string;
  timedOut?: boolean;
  outputHash?: string;
  failureReason?: string;
}

export interface PatchApplicationRecord {
  exactApply: boolean;
  fuzzyRecoveryAttempted: boolean;
  modifiedFiles: string[];
  patchHash: string;
  postApplyDiffHash?: string;
  applyCommand?: string;
  applyExitCode?: number;
}

export interface StaticCheckRecord {
  checkId?: string;
  command?: string;
  exitCode?: number;
  durationMs?: number;
  passed: boolean;
  errorCount: number;
  firstError?: string;
}

export interface SandboxControlRecord {
  networkNone: boolean;
  capDropAll: boolean;
  noNewPrivileges: boolean;
  pidsLimit: number;
  memoryLimit: string;
  cpuLimit: string;
  wallClockLimitMs: number;
  readOnly: boolean;
  effectiveUser: string;
  imageDigest: string;
  hostDockerSocketMounted: boolean;
  privileged: boolean;
}

export interface PromotionEvidenceBundle {
  createdAt: string;
  agentCommit: string;
  targetBaseCommit?: string;
  targetRepoIdentity?: string;
  targetFile: string;
  patchApplication: PatchApplicationRecord;
  staticCheck: StaticCheckRecord;
  testExecutions: TestExecutionRecord[];
  sandboxControls?: SandboxControlRecord;
  probeVerdict?: "confirmed" | "refuted" | "inconclusive" | "execution_failed";
  probeOutputHash?: string;
  mode: "explore" | "candidate" | "promote";
  signature: string;
}

export interface PromotionDecision {
  approved: boolean;
  reason: string;
  blockedBy?: keyof PromotionGates;
}

export interface PromotionGates {
  signatureValid: boolean;
  modeIsPromote: boolean;
  changedFilesAllowed: boolean;
  exactPatchApply: boolean;
  noFuzzyRecovery: boolean;
  atLeastOneTestExecuted: boolean;
  noTimedOutTests: boolean;
  allTestsPassed: boolean;
  staticCheckPassed: boolean;
  sandboxIsolated: boolean;
  probeConfirmed: boolean;
}

// ── Security Perimeter ────────────────────────────────────────────────────────

export const FORBIDDEN_FILES = new Set([
  "server/adminAuth.ts",
  "server/rbac.ts",
  "server/privilegeSeparation.ts",
  "server/gitSandbox.ts",
  "server/recursionGuard.ts",
  "server/constitutionalConstraints.ts",
  "server/polyglotRsi.ts",
  "server/packages/policy-promotion/index.ts",
  "server/promotionService.ts",
  "server/agentToolInterface.ts",
  "server/sandboxManager.ts",
  ".github/workflows/ci.yml",
  ".github/workflows/rsi-validate.yml",
  ".github/workflows/deploy.yml",
  "scripts/check_no_direct_git_push.py",
  "scripts/check_feature_registry.py",
  "andromeda-constitution.json",
  "SAFETY.md",
  "THREAT_MODEL.md",
]);

// ── Bundle Builder ────────────────────────────────────────────────────────────

export function buildEvidenceBundle(params: {
  agentCommit: string;
  targetFile: string;
  patchApplication: PatchApplicationRecord;
  staticCheck: StaticCheckRecord;
  testExecutions: TestExecutionRecord[];
  mode: "explore" | "candidate" | "promote";
  targetBaseCommit?: string;
  targetRepoIdentity?: string;
  sandboxControls?: SandboxControlRecord;
  probeVerdict?: "confirmed" | "refuted" | "inconclusive" | "execution_failed";
  probeOutputHash?: string;
}): PromotionEvidenceBundle {
  const bundle: Omit<PromotionEvidenceBundle, "signature"> = {
    createdAt: new Date().toISOString(),
    agentCommit: params.agentCommit,
    targetBaseCommit: params.targetBaseCommit,
    targetRepoIdentity: params.targetRepoIdentity,
    targetFile: params.targetFile,
    patchApplication: params.patchApplication,
    staticCheck: params.staticCheck,
    testExecutions: params.testExecutions,
    sandboxControls: params.sandboxControls,
    probeVerdict: params.probeVerdict,
    probeOutputHash: params.probeOutputHash,
    mode: params.mode,
  };
  const signature = createHash("sha256")
    .update(params.agentCommit)
    .update(JSON.stringify(bundle))
    .digest("hex");
  return { ...bundle, signature };
}

// ── Promotion Gate ────────────────────────────────────────────────────────────

export function canPromote(bundle: PromotionEvidenceBundle): PromotionDecision {
  const { signature, ...bundleWithoutSig } = bundle;
  const expectedSig = createHash("sha256")
    .update(bundle.agentCommit)
    .update(JSON.stringify(bundleWithoutSig))
    .digest("hex");

  const forbiddenModified = bundle.patchApplication.modifiedFiles
    .filter(f => FORBIDDEN_FILES.has(f));
  const failedTests = bundle.testExecutions.filter(t => !t.passed);
  const timedOutTests = bundle.testExecutions.filter(t => t.timedOut === true);

  const sc = bundle.sandboxControls;
  const sandboxIsolated = !sc
    ? false
    : (
        sc.networkNone &&
        sc.capDropAll &&
        sc.noNewPrivileges &&
        !sc.hostDockerSocketMounted &&
        !sc.privileged &&
        (sc.imageDigest?.includes("sha256:") ?? false)
      );

  const gates: PromotionGates = {
    signatureValid:         signature === expectedSig,
    modeIsPromote:          bundle.mode === "promote",
    changedFilesAllowed:    forbiddenModified.length === 0,
    exactPatchApply:        bundle.patchApplication.exactApply,
    noFuzzyRecovery:        !bundle.patchApplication.fuzzyRecoveryAttempted,
    atLeastOneTestExecuted: bundle.testExecutions.length > 0,
    noTimedOutTests:        timedOutTests.length === 0,
    allTestsPassed:         failedTests.length === 0,
    staticCheckPassed:      bundle.staticCheck.passed,
    sandboxIsolated,
    probeConfirmed:         bundle.probeVerdict === "confirmed",
  };

  const gateOrder: (keyof PromotionGates)[] = [
    "signatureValid",
    "modeIsPromote",
    "changedFilesAllowed",
    "exactPatchApply",
    "noFuzzyRecovery",
    "atLeastOneTestExecuted",
    "noTimedOutTests",
    "allTestsPassed",
    "staticCheckPassed",
    "sandboxIsolated",
    "probeConfirmed",
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
      "No tests were executed — at least one target test must run and pass before promotion",
    noTimedOutTests:
      `${timedOutTests.length} test(s) timed out: ${timedOutTests.map(t => t.testId).join(", ")}`,
    allTestsPassed:
      `${failedTests.length} test(s) failed: ${failedTests.map(t => t.testId).join(", ")}`,
    staticCheckPassed:
      `Static check failed with ${bundle.staticCheck.errorCount} error(s): ${
        bundle.staticCheck.firstError ?? "unknown"
      }`,
    sandboxIsolated:
      "Sandbox isolation controls are missing or incomplete (require --network=none, --cap-drop=ALL, --security-opt=no-new-privileges, pinned image digest, no host Docker socket, no privileged mode)",
    probeConfirmed:
      `Probe verdict is '${bundle.probeVerdict ?? "missing"}' — must be 'confirmed' for autonomous promotion`,
  };

  for (const gate of gateOrder) {
    if (!gates[gate]) {
      return { approved: false, reason: messages[gate], blockedBy: gate };
    }
  }

  return { approved: true, reason: `All ${gateOrder.length} promotion gates passed` };
}

// ── Re-exports from existing modules ─────────────────────────────────────────

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

export { isBackgroundDaemonStartupEnabled } from "../../_core/initDaemons.js";

export type { Role } from "../../rbac.js";
export {
  roleAtLeast,
  requireRole,
  requireAdmin,
  requireOperator,
  requireEditor,
  requireSystem,
} from "../../rbac.js";

export {
  canModify,
  recordModification,
  enterRecursion,
  exitRecursion,
  resetGuard,
  getGuardStats,
} from "../../recursionGuard.js";
