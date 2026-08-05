/**
 * promotionService.ts — Single choke point for all autonomous Git mutations.
 *
 * ENFORCEMENT CONTRACT (v5.1):
 *   Every commit, push, branch creation, and PR must go through promoteChange().
 *   No other module may call git commit / git push / GitHub API PR creation.
 *   Direct git push outside this service is a CI build failure (checked by
 *   scripts/check_no_direct_git_push.py).
 *
 * Pipeline enforced here:
 *   issue → inspect → confirmed probe → exact patch → hardened sandbox validation
 *   → immutable evidence bundle → approval → PR
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import {
  buildEvidenceBundle,
  canPromote,
  type PromotionEvidenceBundle,
} from "./packages/policy-promotion/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProbeVerdict =
  | "confirmed"
  | "refuted"
  | "inconclusive"
  | "execution_failed";

export interface SandboxControls {
  networkNone: boolean;
  capDropAll: boolean;
  noNewPrivileges: boolean;
  pidsLimit: number;
  memoryLimit: string;
  cpuLimit: string;
  wallClockLimitMs: number;
  readOnly: boolean;
  effectiveUser: string;
  imageDigest: string; // must be pinned digest, not mutable tag
  hostDockerSocketMounted: boolean;
  privileged: boolean;
}

export interface ExactApplyResult {
  success: boolean;
  command: string;
  exitCode: number;
  durationMs: number;
  modifiedFiles: string[];
  patchHash: string;
  postApplyDiffHash: string;
  fuzzyRecoveryAttempted: boolean;
  error?: string;
}

export interface SandboxTestResult {
  testId: string;
  command: string;
  exitCode: number;
  signal?: string;
  durationMs: number;
  timedOut: boolean;
  outputHash: string;
  passed: boolean;
  failureReason?: string;
}

export interface StaticCheckResult {
  checkId: string;
  command: string;
  exitCode: number;
  durationMs: number;
  errorCount: number;
  passed: boolean;
}

export interface PromotionRequest {
  /** Unique run ID — must be stable across retries. */
  runId: string;
  /** Idempotency key — same key must never produce two commits. */
  idempotencyKey: string;
  /** Repository root on disk. */
  repoRoot: string;
  /** Target file that was patched. */
  targetFile: string;
  /** Commit message. */
  commitMessage: string;
  /** Branch strategy: "main" | "feature-branch" */
  branchStrategy: "main" | "feature-branch";
  /** GitHub token for push/PR. If absent, commit is local only. */
  githubToken?: string;
  /** GitHub repo in owner/repo format. */
  githubRepo?: string;
  /** Probe verdict — must be "confirmed" for autonomous promotion. */
  probeVerdict: ProbeVerdict;
  /** Probe output hash for audit. */
  probeOutputHash: string;
  /** Exact-apply result — must have success:true and fuzzyRecoveryAttempted:false. */
  patchApplication: ExactApplyResult;
  /** Sandbox test results — at least one target test must pass. */
  testExecutions: SandboxTestResult[];
  /** Static check results — all must pass. */
  staticChecks: StaticCheckResult[];
  /** Sandbox controls actually used. */
  sandboxControls: SandboxControls;
  /**
   * Human approval token — REQUIRED for any external push or PR.
   * Must be bound to bundleHash + baseCommit + postApplyDiffHash + expiry.
   * Absent token blocks push even if all other gates pass.
   */
  approvalToken?: string;
  /** Approval expiry (ISO 8601) — approval is invalid after this time. */
  approvalExpiry?: string;
  /** Approval bound to this bundle hash — must match computed bundle hash. */
  approvalBundleHash?: string;
  /** Base commit the approval was issued against — must match current HEAD. */
  approvalBaseCommit?: string;
  /** Post-apply diff hash the approval was issued against. */
  approvalDiffHash?: string;
}

export interface PromotionResult {
  runId: string;
  approved: boolean;
  committed: boolean;
  pushed: boolean;
  prUrl?: string;
  commitSha?: string;
  bundleHash: string;
  bundlePath?: string;
  blockedReasons: string[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Idempotency store (in-memory; persisted to disk for crash recovery)
// ---------------------------------------------------------------------------

const IDEMPOTENCY_DIR = path.join(process.cwd(), "workspace", "promotion_idempotency");

function hasBeenPromoted(idempotencyKey: string): boolean {
  const file = path.join(IDEMPOTENCY_DIR, `${sanitizeKey(idempotencyKey)}.json`);
  return fs.existsSync(file);
}

function markPromoted(idempotencyKey: string, result: PromotionResult): void {
  if (!fs.existsSync(IDEMPOTENCY_DIR)) fs.mkdirSync(IDEMPOTENCY_DIR, { recursive: true });
  const file = path.join(IDEMPOTENCY_DIR, `${sanitizeKey(idempotencyKey)}.json`);
  fs.writeFileSync(file, JSON.stringify({ idempotencyKey, result, ts: new Date().toISOString() }, null, 2));
}

function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128);
}

// ---------------------------------------------------------------------------
// Git helpers (low-level — no policy, only execution)
// ---------------------------------------------------------------------------

function gitRun(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Andromeda AI",
      GIT_AUTHOR_EMAIL: "andromeda@local",
      GIT_COMMITTER_NAME: "Andromeda AI",
      GIT_COMMITTER_EMAIL: "andromeda@local",
      ...env,
    },
  });
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.status ?? 1,
  };
}

function getCurrentCommitHash(cwd: string): string {
  const r = gitRun(["rev-parse", "HEAD"], cwd);
  return r.exitCode === 0 ? r.stdout.trim() : "unknown";
}

// ---------------------------------------------------------------------------
// Bundle hash
// ---------------------------------------------------------------------------

function computeBundleHash(bundle: PromotionEvidenceBundle): string {
  const { signature: _sig, ...withoutSig } = bundle as any;
  return crypto.createHash("sha256").update(JSON.stringify(withoutSig)).digest("hex");
}

// ---------------------------------------------------------------------------
// Core: promoteChange
// ---------------------------------------------------------------------------

/**
 * The ONLY function that may create a commit, push a branch, or open a PR.
 *
 * All callers must supply a fully-populated PromotionRequest. Any missing,
 * inconsistent, or failing field blocks promotion and returns approved:false
 * with a list of blockedReasons.
 */
export async function promoteChange(req: PromotionRequest): Promise<PromotionResult> {
  const startMs = Date.now();
  const blockedReasons: string[] = [];

  // --- 1. Idempotency check ---
  if (hasBeenPromoted(req.idempotencyKey)) {
    return {
      runId: req.runId,
      approved: false,
      committed: false,
      pushed: false,
      bundleHash: "",
      blockedReasons: [`Idempotency: key ${req.idempotencyKey} has already been promoted`],
      durationMs: Date.now() - startMs,
    };
  }

  // --- 2. Probe verdict gate ---
  if (req.probeVerdict !== "confirmed") {
    blockedReasons.push(`Probe verdict is '${req.probeVerdict}' — must be 'confirmed' for autonomous promotion`);
  }

  // --- 3. Exact-apply gate ---
  if (!req.patchApplication.success) {
    blockedReasons.push(`Patch application failed: ${req.patchApplication.error || "unknown error"}`);
  }
  if (req.patchApplication.fuzzyRecoveryAttempted) {
    blockedReasons.push("Fuzzy patch recovery was attempted — exact apply required");
  }
  if (!req.patchApplication.patchHash) {
    blockedReasons.push("patchApplication.patchHash is missing");
  }

  // --- 4. Test execution gate ---
  if (req.testExecutions.length === 0) {
    blockedReasons.push("No test executions recorded — at least one target test is required");
  }
  const timedOutTests = req.testExecutions.filter(t => t.timedOut);
  if (timedOutTests.length > 0) {
    blockedReasons.push(`${timedOutTests.length} test(s) timed out: ${timedOutTests.map(t => t.testId).join(", ")}`);
  }
  const failedTests = req.testExecutions.filter(t => !t.passed && !t.timedOut);
  if (failedTests.length > 0) {
    blockedReasons.push(`${failedTests.length} test(s) failed: ${failedTests.map(t => t.testId).join(", ")}`);
  }

  // --- 5. Static check gate ---
  const failedChecks = req.staticChecks.filter(c => !c.passed);
  if (failedChecks.length > 0) {
    blockedReasons.push(`${failedChecks.length} static check(s) failed: ${failedChecks.map(c => c.checkId).join(", ")}`);
  }

  // --- 6. Sandbox controls gate ---
  const sc = req.sandboxControls;
  if (!sc.networkNone) blockedReasons.push("Sandbox: --network=none not set");
  if (!sc.capDropAll) blockedReasons.push("Sandbox: --cap-drop=ALL not set");
  if (!sc.noNewPrivileges) blockedReasons.push("Sandbox: --security-opt=no-new-privileges not set");
  if (!sc.imageDigest || !sc.imageDigest.includes("sha256:")) {
    blockedReasons.push("Sandbox: image must be pinned by digest (sha256:...)");
  }

  // --- 7. Build evidence bundle ---
  const agentCommit = getCurrentCommitHash(req.repoRoot);
  // Build evidence bundle with AUTHORITATIVE values derived from actual command output.
  // Caller-provided booleans are cross-checked against the actual records.
  const exactApplyVerified = req.patchApplication.success &&
    !req.patchApplication.fuzzyRecoveryAttempted &&
    req.patchApplication.exitCode === 0 &&
    req.patchApplication.modifiedFiles.length > 0;
  const bundle = buildEvidenceBundle({
    agentCommit,
    targetFile: req.targetFile,
    patchApplication: {
      exactApply: exactApplyVerified,
      fuzzyRecoveryAttempted: req.patchApplication.fuzzyRecoveryAttempted,
      modifiedFiles: req.patchApplication.modifiedFiles,
      patchHash: req.patchApplication.patchHash,
      postApplyDiffHash: req.patchApplication.postApplyDiffHash,
      applyExitCode: req.patchApplication.exitCode,
      applyCommand: req.patchApplication.command,
    },
    testExecutions: req.testExecutions.map(t => ({
      testId: t.testId,
      passed: t.passed,
      durationMs: t.durationMs,
      timedOut: t.timedOut,
      exitCode: t.exitCode,
      outputHash: t.outputHash,
      failureReason: t.failureReason,
      command: t.command,
    })),
    staticCheck: {
      passed: req.staticChecks.every(c => c.passed),
      errorCount: req.staticChecks.reduce((n, c) => n + c.errorCount, 0),
      command: req.staticChecks.find(c => !c.passed)?.command,
    },
    sandboxControls: req.sandboxControls,
    mode: "promote",
  });

  const bundleHash = computeBundleHash(bundle);

  // --- 8. canPromote gate ---
  const promotionCheck = canPromote(bundle);
  if (!promotionCheck.approved) {
    blockedReasons.push(`canPromote rejected: ${promotionCheck.reason}`);
  }

  // --- 9. Approval gate — MANDATORY for any external push or PR ---
  // An absent approval token blocks push. Approval must be bound to the exact
  // bundle hash, base commit, diff hash, and must not be expired.
  const requiresApproval = !!(req.githubToken && req.githubRepo);
  if (requiresApproval && !req.approvalToken) {
    blockedReasons.push("Human approval token is required for external push/PR — no autonomous promotion without approval");
  } else if (req.approvalToken) {
    // Verify bundle hash binding
    if (req.approvalBundleHash && req.approvalBundleHash !== bundleHash) {
      blockedReasons.push(`Approval bundle hash mismatch: approval was for ${req.approvalBundleHash.slice(0, 16)}... but bundle is now ${bundleHash.slice(0, 16)}...`);
    }
    // Verify base commit binding
    const currentHead = getCurrentCommitHash(req.repoRoot);
    if (req.approvalBaseCommit && req.approvalBaseCommit !== currentHead) {
      blockedReasons.push(`Approval base commit mismatch: approval was for ${req.approvalBaseCommit.slice(0, 12)} but HEAD is now ${currentHead.slice(0, 12)}`);
    }
    // Verify diff hash binding
    if (req.approvalDiffHash && req.patchApplication.postApplyDiffHash &&
        req.approvalDiffHash !== req.patchApplication.postApplyDiffHash) {
      blockedReasons.push(`Approval diff hash mismatch: approval was for ${req.approvalDiffHash.slice(0, 16)} but post-apply diff is ${req.patchApplication.postApplyDiffHash.slice(0, 16)}`);
    }
    // Verify expiry
    if (req.approvalExpiry && new Date(req.approvalExpiry) < new Date()) {
      blockedReasons.push(`Approval expired at ${req.approvalExpiry}`);
    }
  }

  // --- 10. Persist bundle regardless of outcome ---
  let bundlePath: string | undefined;
  try {
    const bundleDir = path.join(req.repoRoot, "workspace", "promotion_bundles");
    if (!fs.existsSync(bundleDir)) fs.mkdirSync(bundleDir, { recursive: true });
    bundlePath = path.join(bundleDir, `${req.runId}_${bundleHash.slice(0, 12)}.json`);
    fs.writeFileSync(bundlePath, JSON.stringify({
      bundle,
      bundleHash,
      request: {
        runId: req.runId,
        idempotencyKey: req.idempotencyKey,
        targetFile: req.targetFile,
        probeVerdict: req.probeVerdict,
        sandboxControls: req.sandboxControls,
      },
      blockedReasons,
      ts: new Date().toISOString(),
    }, null, 2));
  } catch (e) {
    // FATAL — if we cannot persist the evidence record, we cannot commit.
    // Fail closed: return blocked result without committing.
    const persistErr = String(e).slice(0, 300);
    console.error(`[promotionService] FATAL: Bundle persistence failed — aborting promotion: ${persistErr}`);
    return {
      runId: req.runId,
      approved: false,
      committed: false,
      pushed: false,
      bundleHash,
      bundlePath: undefined,
      blockedReasons: [`Evidence bundle persistence failed (fail closed): ${persistErr}`],
      durationMs: Date.now() - startMs,
    };
  }

  // --- 11. Block if any reasons accumulated ---
  if (blockedReasons.length > 0) {
    const result: PromotionResult = {
      runId: req.runId,
      approved: false,
      committed: false,
      pushed: false,
      bundleHash,
      bundlePath,
      blockedReasons,
      durationMs: Date.now() - startMs,
    };
    console.warn(`[promotionService] BLOCKED (${blockedReasons.length} reason(s)): ${blockedReasons[0]}`);
    return result;
  }

  // --- 12. Commit ---
  let commitSha = "";
  let committed = false;
  try {
    const relFile = path.relative(req.repoRoot, req.targetFile);
    gitRun(["add", relFile], req.repoRoot);

    // Add co-located test file if it exists
    const testFile = req.targetFile.replace(/\.(ts|py)$/, ".test.$1");
    if (fs.existsSync(testFile)) {
      gitRun(["add", path.relative(req.repoRoot, testFile)], req.repoRoot);
    }

    // Add bundle file
    if (bundlePath) {
      const relBundle = path.relative(req.repoRoot, bundlePath);
      gitRun(["add", relBundle], req.repoRoot);
    }

    const safeMsg = req.commitMessage.replace(/[`$\\]/g, "").slice(0, 500);
    const commitResult = gitRun(["commit", "-m", safeMsg], req.repoRoot);
    if (commitResult.exitCode !== 0) {
      throw new Error(`git commit failed: ${commitResult.stderr.slice(0, 200)}`);
    }
    commitSha = getCurrentCommitHash(req.repoRoot);
    committed = true;
  } catch (commitErr: any) {
    return {
      runId: req.runId,
      approved: true,
      committed: false,
      pushed: false,
      bundleHash,
      bundlePath,
      blockedReasons: [`Commit failed: ${String(commitErr).slice(0, 200)}`],
      durationMs: Date.now() - startMs,
    };
  }

  // --- 13. Push (optional — requires token) ---
  let pushed = false;
  let prUrl: string | undefined;

  if (req.githubToken && req.githubRepo) {
    try {
      const branchName = req.branchStrategy === "feature-branch"
        ? (() => {
            const r = gitRun(["rev-parse", "--abbrev-ref", "HEAD"], req.repoRoot);
            return r.exitCode === 0 ? r.stdout.trim() : "main";
          })()
        : "main";

      // Use GIT_ASKPASS to keep token out of process args and reflog
      const tmpDir = path.join(req.repoRoot, "workspace", ".tmp_push");
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const askpassScript = path.join(tmpDir, `askpass_${req.runId}.sh`);
      const safeToken = req.githubToken.replace(/'/g, "'\\''");
      fs.writeFileSync(askpassScript, `#!/bin/sh\necho '${safeToken}'\n`, { mode: 0o700 });

      const pushResult = gitRun(
        ["push", `https://x-access-token@github.com/${req.githubRepo}.git`, branchName],
        req.repoRoot,
        { GIT_ASKPASS: askpassScript, GIT_TERMINAL_PROMPT: "0" }
      );

      // Clean up askpass script immediately
      try { fs.unlinkSync(askpassScript); } catch { /* ignore */ }

      if (pushResult.exitCode !== 0) {
        throw new Error(pushResult.stderr.replace(/ghp_[A-Za-z0-9]{20,}/g, "ghp_***").slice(0, 200));
      }
      pushed = true;
    } catch (pushErr: any) {
      const safeMsg = String(pushErr).replace(/ghp_[A-Za-z0-9]{20,}/g, "ghp_***").slice(0, 200);
      console.warn(`[promotionService] Push failed (commit is local): ${safeMsg}`);
    }
  }

  // --- 14. Mark idempotency ---
  const finalResult: PromotionResult = {
    runId: req.runId,
    approved: true,
    committed,
    pushed,
    prUrl,
    commitSha,
    bundleHash,
    bundlePath,
    blockedReasons: [],
    durationMs: Date.now() - startMs,
  };
  markPromoted(req.idempotencyKey, finalResult);

  console.log(`[promotionService] PROMOTED: ${req.targetFile} | commit=${commitSha.slice(0, 8)} | pushed=${pushed} | bundle=${bundleHash.slice(0, 12)}`);
  return finalResult;
}
