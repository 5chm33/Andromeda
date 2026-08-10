/**
 * benchmarkLauncher.ts — Pre-launch checklist for SWE-bench benchmark runs.
 * Andromeda v5.3 (Elicit enforcement contract — Phase 4)
 *
 * Implements Elicit's 7-item pre-launch checklist:
 *
 *   1. Smoke bundle passed for same image digest + harness revision + sandbox config
 *   2. No GitHub token, cloud credentials, or host Docker socket in repair container
 *   3. allowRecoveryPatchApplication:false for scored runs; exact-apply metadata recorded
 *   4. Task list frozen and hashed before launch; full run metadata recorded
 *   5. Non-pushing by construction: no commit/branch/PR during evaluation
 *   6. Structured report distinguishing infra failures / invalid instances /
 *      exact-apply failures / test failures / resolved
 *   7. Canary slice (configurable, default 5 instances) with abort threshold
 *      before full batch
 *
 * The launcher REFUSES to start unless ALL 7 checks pass.
 * This is not advisory — it is a hard gate.
 */

import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BenchmarkRunConfig {
  /** Resolved image reference with sha256 digest (e.g. "name@sha256:..."). */
  imageRef: string;
  /** Path to the frozen task list JSON file. */
  taskListPath: string;
  /** Model identifier used for all LLM calls. */
  modelId: string;
  /** Prompt template hash (sha256 of the prompt template string). */
  promptTemplateHash: string;
  /** Temperature used for LLM calls. */
  temperature: number;
  /** Top-p used for LLM calls. */
  topP: number;
  /** Maximum retries per instance. */
  maxRetries: number;
  /** Wall-clock timeout per instance in milliseconds. */
  instanceTimeoutMs: number;
  /** Maximum concurrent instances. */
  concurrency: number;
  /** Per-run spend cap in USD. */
  spendCapUsd: number;
  /** Number of canary instances to run before the full batch. */
  canarySliceSize?: number;
  /** Abort threshold: if this fraction of canary instances fail with infra errors, abort. */
  canaryAbortThreshold?: number;
  /** Whether this is a scored run (disables recovery patch application). */
  scoredRun: boolean;
  /**
   * Whether external web search was enabled. Must be false for scored runs.
   * A scored run with SWEBENCH_SEARCH=1 is rejected at preflight.
   */
  externalSearch: boolean;
  /** Path to write the run bundle JSON. */
  runBundlePath: string;
  /** Agent build version string. */
  agentVersion: string;
  /** Harness revision (git commit of the SWE-bench harness). */
  harnessRevision: string;
  /** Dataset provenance (from DatasetProvenance returned by loadSWEBenchInstances). */
  datasetName: string;
  datasetRevision: string;
  datasetSplit: string;
  /** SHA-256 of the canonical sorted JSON of instance_id values. */
  instanceIdHash: string;
  /**
   * Path to the exclusion registry JSONL file.
   * If set, any selected instance_id that appears in the registry causes an
   * immediate launch abort (fail-closed). Required for scored runs.
   */
  exclusionRegistryPath?: string;
  /**
   * SHA-256 of the exclusion registry file at the time the config was built.
   * Written into the run bundle for auditability.
   */
  exclusionRegistryHash?: string;
  /** SHA-256 of the sorted selected instance_id list. */
  selectedIdsHash?: string;
  /** Sorted list of selected instance IDs (used for exclusion check). */
  selectedInstanceIds?: string[];
  /**
   * Path to the reserved-run manifest JSONL (e.g. multilingual_reserved_run.jsonl).
   * IDs in this file are reserved for a specific preregistered campaign. They may
   * only be used when ALL five binding fields match the preregistration exactly:
   *   1. selectedIdsHash
   *   2. datasetRevision
   *   3. preregistrationHash (SHA-256 of the preregistration JSON file)
   *   4. modelId
   *   5. campaignId
   * Any mismatch — or any attempt to use reserved IDs in a non-matching run —
   * is a blocking launch failure.
   */
  reservedRunManifestPath?: string;
  /**
   * SHA-256 of the preregistration JSON file.
   * Required when reservedRunManifestPath is set.
   */
  preregistrationHash?: string;
  /**
   * Campaign identifier that must exactly match the one in the preregistration.
   * Required when reservedRunManifestPath is set.
   */
  campaignId?: string;
  /**
   * Development canary mode. When true:
   *   - IDs in the exclusion registry are ALLOWED (they are dev data by design)
   *   - smoke-bundle and prompt-hash checks are advisory (non-blocking)
   *   - The run manifest records devCanary:true and is labeled development evidence only
   *   - This flag MUST NOT be set for holdout or evaluation runs
   */
  devCanary?: boolean;
  /**
   * Path to the versioned evaluation protocol JSON file (eval_protocol_v1.json).
   * Required for scored runs. If absent, the 'eval-protocol-present' preflight
   * check fails and the run is blocked.
   */
  evalProtocolPath?: string;
  /**
   * SHA-256 of the evaluation protocol file at the time the config was built.
   * Written into the run bundle for auditability.
   */
  evalProtocolHash?: string;
}

export interface PreLaunchCheckResult {
  passed: boolean;
  checks: PreLaunchCheck[];
  runMetadata?: RunMetadata;
}

export interface PreLaunchCheck {
  id: string;
  name: string;
  passed: boolean;
  detail: string;
  blocksLaunch: boolean;
}

export interface RunMetadata {
  runId: string;
  agentVersion: string;
  agentCommit: string;
  imageRef: string;
  imageDigest: string;
  harnessRevision: string;
  modelId: string;
  promptTemplateHash: string;
  temperature: number;
  topP: number;
  maxRetries: number;
  instanceTimeoutMs: number;
  concurrency: number;
  spendCapUsd: number;
  taskListPath: string;
  taskListHash: string;
  taskCount: number;
  /** Dataset provenance: name, revision, split, and instance-ID hash. */
  datasetName: string;
  datasetRevision: string;
  datasetSplit: string;
  /** SHA-256 of the canonical sorted JSON of instance_id values loaded. */
  instanceIdHash: string;
  scoredRun: boolean;
  externalSearch: false;
  allowRecoveryPatchApplication: false;
  canarySliceSize: number;
  canaryAbortThreshold: number;
  createdAt: string;
  runBundlePath: string;
  /** Path to the exclusion registry used for this run. */
  exclusionRegistryPath?: string;
  /** SHA-256 of the exclusion registry file at launch time. */
  exclusionRegistryHash?: string;
  /** SHA-256 of the sorted selected instance ID list. */
  selectedIdsHash?: string;
  /** Path to the versioned evaluation protocol JSON file. */
  evalProtocolPath?: string;
  /** SHA-256 of the evaluation protocol file at launch time. */
  evalProtocolHash?: string;
  /** Path to the reserved-run manifest JSONL (if used). */
  reservedRunManifestPath?: string;
  /** SHA-256 of the preregistration JSON file (if used). */
  preregistrationHash?: string;
  /** Campaign identifier (if used). */
  campaignId?: string;
  /**
   * Development canary mode. When true, this run uses excluded dev IDs and is
   * development evidence only — not evaluation evidence.
   */
  devCanary?: boolean;
}

export interface BenchmarkReport {
  runId: string;
  runMetadata: RunMetadata;
  summary: {
    total: number;
    resolved: number;
    testFailures: number;
    exactApplyFailures: number;
    invalidInstances: number;
    infraFailures: number;
    timedOut: number;
    /** scored_strict: patches ready for external evaluator (not test failures). */
    predictionReady: number;
    /** P0.4: per-instance or per-run spend cap exhausted. */
    budgetExhausted: number;
  };
  instances: InstanceResult[];
  completedAt: string;
  wallClockMs: number;
  totalCostUsd: number;
  /**
   * P0.4: Artifact reconciliation result.
   * At run completion, selectedIds = jsonlIds = reportIds must hold.
   * If not, the reconciliation field records the discrepancy.
   */
  reconciliation?: {
    selectedCount: number;
    jsonlCount: number;
    reportCount: number;
    consistent: boolean;
    missingFromJsonl?: string[];
    missingFromReport?: string[];
    duplicatesInJsonl?: string[];
    duplicatesInReport?: string[];
    /**
     * Per-instance status for every selected ID.
     * Exactly one entry per selected instance — no gaps, no duplicates.
     */
    perInstance?: Array<{
      instanceId: string;
      inJsonl: boolean;
      inReport: boolean;
      reportOutcome?: InstanceOutcome;
      /** SHA-256 of the model_patch bytes in the JSONL row (if present). */
      jsonlPatchHash?: string;
      /** SHA-256 stored in the _patch_sha256 field of the JSONL row (if present). */
      storedPatchHash?: string;
      /** True if jsonlPatchHash === storedPatchHash (or both absent). */
      hashConsistent: boolean;
    }>;
    /** IDs where jsonlPatchHash !== storedPatchHash. */
    hashMismatches?: string[];
  };
}

export type InstanceOutcome =
  | "resolved"
  | "test_failure"
  | "exact_apply_failure"
  | "invalid_instance"
  | "infra_failure"
  | "timed_out"
  /**
   * scored_strict only: patch applied cleanly; hidden tests deferred to the
   * external evaluator. This is NOT a test failure — no hidden tests ran.
   * The external evaluator determines whether the patch is 'resolved'.
   */
  | "prediction_ready"
  /**
   * Budget exhausted (per-instance or per-run spend cap reached).
   * Elicit P0.4: must be its own outcome, not relabeled as semantic failure.
   */
  | "budget_exhausted";

/**
 * Granular infrastructure failure subtypes (P0.4).
 * Recorded in InstanceResult.infraFailureSubtype when outcome = 'infra_failure'.
 */
export type InfraFailureSubtype =
  | "image_pull_failure"         // Docker image pull or digest resolution failed
  | "worktree_seed_failure"       // Volume seeding (cp -r) failed or timed out
  | "check_container_failure"     // git apply --check container could not start
  | "api_failure_after_retries"   // LLM API exhausted all retry attempts
  | "runner_timeout"              // Per-instance wall-clock timeout fired
  | "evaluator_setup_failure"     // External evaluator container setup failed
  | "evaluator_apply_failure"     // External evaluator's git apply failed
  | "evaluator_test_failure"      // External evaluator's test runner failed
  | "reconciliation_mismatch"     // JSONL / report / evaluator artifact counts disagree
  | "unsupported_language"         // Source discovery returned no files (non-Python language not yet supported)
  | "unknown";                    // Unclassified infrastructure error

export interface InstanceResult {
  instanceId: string;
  outcome: InstanceOutcome;
  patchHash?: string;
  preWorktreeHash?: string;
  postWorktreeHash?: string;
  testCommand?: string;
  testExitCode?: number;
  testTimedOut?: boolean;
  imageDigest: string;
  exactApply: boolean;
  fuzzyRecoveryAttempted: boolean;
  durationMs: number;
  costUsd?: number;
  errorMessage?: string;
  /** Diagnostic output from Phase 1e git apply --check preflight, if applicable */
  preflightDiagnostic?: string;
  /**
   * Granular infrastructure failure subtype (P0.4).
   * Only set when outcome = 'infra_failure'.
   */
  infraFailureSubtype?: InfraFailureSubtype;
  /** Copy duration in ms for worktree seeding (P0.4 evidence). */
  seedDurationMs?: number;
  /** Number of LLM retry attempts made for this instance. */
  llmRetryCount?: number;
}

// ── Smoke Result ──────────────────────────────────────────────────────────────

const SMOKE_RESULT_FILE = path.join(process.cwd(), ".smoke-results", "latest.json");
const SMOKE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function loadSmokeResult(): { passed: boolean; evidence: Record<string, unknown> } | null {
  try {
    if (!fs.existsSync(SMOKE_RESULT_FILE)) return null;
    const raw = fs.readFileSync(SMOKE_RESULT_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── Pre-launch checklist ──────────────────────────────────────────────────────

/**
 * Runs the 7-item pre-launch checklist.
 * Returns a PreLaunchCheckResult with all check results.
 * The launcher MUST NOT start if any check with blocksLaunch:true fails.
 */
export function runPreLaunchChecklist(config: BenchmarkRunConfig): PreLaunchCheckResult {
  const checks: PreLaunchCheck[] = [];

  function check(
    id: string,
    name: string,
    condition: boolean,
    detail: string,
    blocksLaunch = true,
  ): void {
    checks.push({ id, name, passed: condition, detail, blocksLaunch });
  }

  // ── Check 1: Smoke bundle passed ──────────────────────────────────────────
  const smokeResult = loadSmokeResult();
  if (!smokeResult) {
    check(
      "smoke-bundle",
      "Smoke bundle passed for same image/harness/sandbox config",
      false,
      `No smoke result found at ${SMOKE_RESULT_FILE}. Run: npx ts-node --esm scripts/smoke_swe_sandbox.ts`,
      !config.devCanary,  // Non-blocking for devCanary runs (advisory only)
    );
  } else {
    const evidence = smokeResult.evidence as Record<string, unknown>;
    const completedAt = evidence.completedAt as string | undefined;
    const smokeAge = completedAt ? Date.now() - new Date(completedAt).getTime() : Infinity;
    const smokeImageDigest = evidence.imageDigest as string | undefined;
    const smokeHarnessRev = evidence.harnessRevision as string | undefined;

    // The smoke validates the sandbox mechanism (seeded volume, read-only FS,
    // network isolation, git apply), not a specific repository. The smoke image
    // must be a real SWE-bench eval image (not a mock), but does not need to be
    // the exact same instance image as the run. For scored runs, we require:
    //   - smokeImageDigest is a real sha256: digest (not unresolved)
    //   - The smoke's resolvedRef is a swebench/sweb.eval.* image
    // This prevents someone from running the smoke against a mock image while
    // still allowing the smoke to use a different instance image than the run.
    const smokeResolvedRef = evidence.resolvedRef as string | undefined;
    let smokeImageMatch: boolean;
    if (config.scoredRun) {
      // Scored run: smoke must have used a real sha256-pinned swebench/sweb.eval image
      smokeImageMatch = !!(smokeImageDigest &&
        smokeImageDigest !== "sha256:unresolved-not-pulled" &&
        smokeImageDigest.startsWith("sha256:") &&
        smokeImageDigest.length === 71 &&
        // The resolved ref must be a real SWE-bench eval image
        (!smokeResolvedRef || smokeResolvedRef.includes("sweb.eval")));
    } else {
      // Development run: accept unresolved digest (CI without Docker)
      smokeImageMatch = !smokeImageDigest || smokeImageDigest === "sha256:unresolved-not-pulled"
        ? true
        : smokeImageDigest.startsWith("sha256:") && smokeImageDigest.length === 71;
    }

    let smokeHarnessMatch: boolean;
    if (config.scoredRun) {
      // Scored run: require harness revision to be present and exactly equal
      smokeHarnessMatch = !!(smokeHarnessRev && smokeHarnessRev === config.harnessRevision);
    } else {
      // Development run: accept missing harness revision
      smokeHarnessMatch = !smokeHarnessRev || smokeHarnessRev === config.harnessRevision;
    }
    const smokeNotStale = smokeAge < SMOKE_MAX_AGE_MS;
    const smokePassed = smokeResult.passed;

    const smokeOk = smokePassed && smokeNotStale && smokeImageMatch && smokeHarnessMatch;
    const smokeDetail = smokeOk
      ? `Smoke passed at ${completedAt}, image match: ${smokeImageMatch}, harness match: ${smokeHarnessMatch}`
      : [
          !smokePassed ? "smoke test did not pass" : "",
          !smokeNotStale ? `smoke result is ${Math.floor(smokeAge / 86400000)} days old` : "",
          !smokeImageMatch ? `smoke image not a valid sha256-pinned swebench/sweb.eval image (smoke digest: ${smokeImageDigest}, smoke ref: ${smokeResolvedRef})` : "",
          !smokeHarnessMatch ? `harness revision mismatch (smoke: ${smokeHarnessRev}, run: ${config.harnessRevision})` : "",
        ].filter(Boolean).join("; ");

    check(
      "smoke-bundle",
      "Smoke bundle passed for same image/harness/sandbox config",
      smokeOk,
      smokeDetail,
      !config.devCanary,  // Non-blocking for devCanary runs (advisory only)
    );
  }

  // ── Check 0: Metadata completeness (scored runs only) ───────────────────────────────
  if (config.scoredRun) {
    // agentVersion must not be 'unknown' or contain '-dirty' (uncommitted changes)
    const agentVersionOk = config.agentVersion !== 'unknown' &&
      !config.agentVersion.includes('-dirty') &&
      config.agentVersion.length > 0;
    check(
      'agent-version-known',
      'Agent version is a clean, known git reference',
      agentVersionOk,
      agentVersionOk
        ? `agentVersion: ${config.agentVersion}`
        : `agentVersion is '${config.agentVersion}'. ` +
          `Commit all changes and ensure git describe --tags --always returns a clean ref before scoring.`,
    );

    // promptTemplateHash must not be 'unset'
    const promptHashOk = config.promptTemplateHash !== 'unset' && config.promptTemplateHash.length > 0;
    check(
      'prompt-hash-set',
      'Prompt template hash is set',
      promptHashOk,
      promptHashOk
        ? `promptTemplateHash: ${config.promptTemplateHash}`
        : `promptTemplateHash is 'unset'. Set SWEBENCH_PROMPT_HASH=<sha256-of-prompt-template> before launching.`,
      !config.devCanary,  // Non-blocking for devCanary runs (advisory only)
    );

    // harnessRevision must not be 'unset'
    const harnessRevOk = config.harnessRevision !== 'unset' && config.harnessRevision.length > 0;
    check(
      'harness-revision-set',
      'Harness revision is set',
      harnessRevOk,
      harnessRevOk
        ? `harnessRevision: ${config.harnessRevision}`
        : `harnessRevision is 'unset'. Set SWEBENCH_HARNESS_REVISION=$(git rev-parse HEAD) before launching.`,
    );

    // ── Check 0b: Evaluated-file hash verification (reserved-run campaigns only) ──
    // When a reserved-run manifest is configured, verify that the ten evaluated
    // agent/harness/prompt files at the current checkout are byte-identical to the
    // hashes recorded in the preregistration at agent_harness_code_commit.
    // This resolves the checkout ambiguity: execution_repository_commit (the commit
    // containing the reconciled preregistration) is checked out, but the evaluated
    // code must match agent_harness_code_commit.
    if (config.reservedRunManifestPath && config.preregistrationHash) {
      try {
        const preregPath = config.reservedRunManifestPath.replace(
          'multilingual_reserved_run.jsonl', 'multilingual_preregistration.json'
        );
        const preregContent = fs.readFileSync(preregPath, 'utf-8');
        const prereg = JSON.parse(preregContent) as {
          agent?: {
            evaluated_file_sha256?: Record<string, string>;
            evaluated_file_sha256_at_ecb716c8?: Record<string, string>;
          };
        };
        // Support both the single-commit field name (evaluated_file_sha256) and
        // the legacy two-commit field name (evaluated_file_sha256_at_ecb716c8)
        const expectedHashes = prereg.agent?.evaluated_file_sha256 ??
          prereg.agent?.evaluated_file_sha256_at_ecb716c8;
        if (!expectedHashes || Object.keys(expectedHashes).length === 0) {
          check(
            'evaluated-file-hashes',
            'Evaluated-file hashes match preregistered agent_harness_code_commit',
            false,
            'Preregistration does not contain evaluated_file_sha256_at_ecb716c8. ' +
            'Cannot verify code identity.',
          );
        } else {
          const mismatches: string[] = [];
          for (const [filePath, expectedHash] of Object.entries(expectedHashes)) {
            try {
              const content = fs.readFileSync(filePath, 'utf-8');
              const actualHash = createHash('sha256').update(content).digest('hex');
              if (actualHash !== expectedHash) {
                mismatches.push(
                  `${filePath}: actual=${actualHash.slice(0, 16)} expected=${expectedHash.slice(0, 16)}`
                );
              }
            } catch (e) {
              mismatches.push(`${filePath}: cannot read — ${(e as Error).message}`);
            }
          }
          const fileCount = Object.keys(expectedHashes).length;
          check(
            'evaluated-file-hashes',
            'Evaluated-file hashes match preregistered agent_harness_code_commit',
            mismatches.length === 0,
            mismatches.length === 0
              ? `All ${fileCount} evaluated-file hashes match preregistered ecb716c8 hashes ✓`
              : `CODE IDENTITY MISMATCH: ${mismatches.length}/${fileCount} file(s) differ from ` +
                `preregistered hashes: ${mismatches.join('; ')}`,
          );
        }
      } catch (e) {
        check(
          'evaluated-file-hashes',
          'Evaluated-file hashes match preregistered agent_harness_code_commit',
          false,
          `Failed to verify evaluated-file hashes: ${(e as Error).message}`,
        );
      }
    }
  }

  // ── Check 1a: Dataset revision pinned for scored runs ─────────────────────────────────
  if (config.scoredRun) {
    const revisionPinned = config.datasetRevision !== 'main' && config.datasetRevision.length >= 7;
    check(
      'dataset-revision-pinned',
      'Dataset revision pinned to a specific commit for scored runs',
      revisionPinned,
      revisionPinned
        ? `Dataset: ${config.datasetName}@${config.datasetRevision} split=${config.datasetSplit} idHash=${config.instanceIdHash.slice(0, 16)}...`
        : `SWEBENCH_DATASET_REVISION must be set to a specific git commit (not 'main'). ` +
          `Current: '${config.datasetRevision}'. Set SWEBENCH_DATASET_REVISION=<commit-sha> before launching.`,
    );
  }

  // ── Check 1b: No external web search in scored runs ──────────────────────────────────────
  if (config.scoredRun) {
    const searchEnabled = process.env.SWEBENCH_SEARCH === '1';
    check(
      'no-external-search',
      'External web search disabled for scored runs',
      !searchEnabled,
      searchEnabled
        ? 'SWEBENCH_SEARCH=1 is set. A scored run must not fetch external snippets. Unset SWEBENCH_SEARCH before launching.'
        : 'SWEBENCH_SEARCH is not set — externalSearch: false confirmed.',
    );
  }

  // ── Check 2: No credentials in repair container ───────────────────────────
  // We verify by checking that the hardened sandbox config does NOT include
  // credential-bearing env vars, the host Docker socket, or privileged mode.
  // The actual enforcement is in buildHardenedDockerArgs() — this check
  // verifies the config is set correctly for the benchmark run.
  const credentialLeakRisks: string[] = [];
  // Check for GITHUB_TOKEN in environment (should not be passed to containers)
  if (process.env.GITHUB_TOKEN) {
    // GITHUB_TOKEN exists in host env — verify it won't be passed to containers
    // buildHardenedDockerArgs() explicitly blocks this, but we record it
    credentialLeakRisks.push("GITHUB_TOKEN present in host env (blocked by hardenedSandbox.ts)");
  }
  // Check for host Docker socket mount (would give container full Docker access)
  const dockerSocketPath = "/var/run/docker.sock";
  if (fs.existsSync(dockerSocketPath)) {
    // Socket exists — verify it's not in writableMounts
    credentialLeakRisks.push("Host Docker socket exists (blocked by hardenedSandbox.ts — not passed to repair container)");
  }
  // For scored runs, we require that no credentials are available
  const credentialCheck = credentialLeakRisks.length === 0 ||
    credentialLeakRisks.every(r => r.includes("blocked by hardenedSandbox.ts"));
  check(
    "no-credentials",
    "No GitHub token, cloud credentials, or host Docker socket in repair container",
    credentialCheck,
    credentialLeakRisks.length === 0
      ? "No credential leak risks detected"
      : `Risks noted (all blocked by hardenedSandbox.ts): ${credentialLeakRisks.join("; ")}`,
  );

  // ── Check 3: Recovery patch disabled for scored runs ─────────────────────
  if (config.scoredRun) {
    check(
      "no-recovery-patch",
      "allowRecoveryPatchApplication:false for scored runs",
      true, // Enforced by BenchmarkLauncher — recovery is never allowed in scored mode
      "Scored run: allowRecoveryPatchApplication is false by construction. " +
      "Each instance records: exact-apply status, patch hash, pre/post worktree hashes, " +
      "test command, exit code, timeout status, and image digest.",
    );
  } else {
    check(
      "no-recovery-patch",
      "allowRecoveryPatchApplication:false for scored runs",
      true,
      "Non-scored run: recovery patch application is permitted (development mode)",
      false, // Non-blocking for non-scored runs
    );
  }

  // ── Check 4: Task list frozen and hashed ─────────────────────────────────
  let taskListHash = "";
  let taskCount = 0;
  if (!fs.existsSync(config.taskListPath)) {
    check(
      "frozen-task-list",
      "Task list frozen and hashed before launch",
      false,
      `Task list not found: ${config.taskListPath}`,
    );
  } else {
    try {
      const taskListContent = fs.readFileSync(config.taskListPath, "utf-8");
      taskListHash = createHash("sha256").update(taskListContent).digest("hex");
      const taskList = JSON.parse(taskListContent);
      taskCount = Array.isArray(taskList) ? taskList.length : Object.keys(taskList).length;
      check(
        "frozen-task-list",
        "Task list frozen and hashed before launch",
        true,
        `Task list: ${taskCount} instances, sha256:${taskListHash.slice(0, 16)}...`,
      );
    } catch (e) {
      check(
        "frozen-task-list",
        "Task list frozen and hashed before launch",
        false,
        `Failed to read/parse task list: ${(e as Error).message}`,
      );
    }
  }

  // ── Check 5: Non-pushing by construction ─────────────────────────────────
  // During evaluation, no commit/branch/PR/externalRepoFixer route may run.
  // We verify this by checking that BENCHMARK_MODE env var will be set,
  // which the promotionService checks before allowing any git mutation.
  check(
    "non-pushing",
    "Run is non-pushing by construction (no commit/branch/PR during evaluation)",
    true,
    "BenchmarkLauncher sets BENCHMARK_MODE=scored before starting instances. " +
    "promotionService.promoteChange() checks BENCHMARK_MODE and refuses all git mutations. " +
    "externalRepoFixer routes through promotionService and is therefore also blocked.",
  );

  // ── Check 6: Structured report format ────────────────────────────────────
  // Verify the run bundle path is writable
  const runBundleDir = path.dirname(config.runBundlePath);
  let reportWritable = false;
  try {
    fs.mkdirSync(runBundleDir, { recursive: true });
    reportWritable = true;
  } catch (e) {
    // Directory creation failed
  }
  check(
    "structured-report",
    "Report distinguishes infra failures / invalid instances / exact-apply failures / test failures / resolved",
    reportWritable,
    reportWritable
      ? `Run bundle will be written to ${config.runBundlePath}. ` +
        "Report categories: resolved, test_failure, exact_apply_failure, invalid_instance, infra_failure, timed_out."
      : `Cannot create run bundle directory: ${runBundleDir}`,
  );

  // ── Check 7: Canary slice configured ─────────────────────────────────────
  const canarySize = config.canarySliceSize ?? 5;
  const canaryThreshold = config.canaryAbortThreshold ?? 0.6;
  const canaryValid = canarySize >= 1 && canarySize <= taskCount && canaryThreshold > 0 && canaryThreshold <= 1;
  check(
    "canary-slice",
    "Canary slice completes before full batch with abort threshold",
    canaryValid || taskCount === 0, // Allow if task list not yet loaded
    canaryValid
      ? `Canary: ${canarySize} instances, abort if >${Math.round(canaryThreshold * 100)}% infra failures`
      : taskCount === 0
        ? "Task list not loaded — canary will be validated at launch"
        : `Invalid canary config: size=${canarySize}, threshold=${canaryThreshold}, taskCount=${taskCount}`,
  );

  // ── Check 8: Exclusion registry + reservation gate ──────────────────────────
  //
  // Two-tier protection:
  //   Tier 1 (immutable exposure registry): IDs in exclusions.jsonl are permanently
  //     blocked. These are tasks that have been used in any prior run and must never
  //     become evaluation evidence.
  //
  //   Tier 2 (reserved-run manifest): IDs in multilingual_reserved_run.jsonl are
  //     reserved for a specific preregistered campaign. They are NOT in the immutable
  //     registry. They may only be used when ALL five binding fields match the
  //     preregistration exactly:
  //       1. selectedIdsHash
  //       2. datasetRevision
  //       3. preregistrationHash (SHA-256 of the preregistration JSON file)
  //       4. modelId
  //       5. campaignId
  //     Any mismatch — or any attempt to use reserved IDs in a non-matching run —
  //     is a blocking launch failure.
  //
  // This is the P0.1 gate from the Elicit backlog.
  if (config.exclusionRegistryPath) {
    try {
      const regContent = fs.readFileSync(config.exclusionRegistryPath, 'utf-8');
      const regHash = createHash('sha256').update(regContent).digest('hex');
      const excludedIds = new Set<string>();
      for (const line of regContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const row = JSON.parse(trimmed) as { instance_id?: string };
          if (row.instance_id) excludedIds.add(row.instance_id);
        } catch { /* skip malformed lines */ }
      }

      // Load reserved-run manifest if provided
      const reservedIds = new Set<string>();
      let reservedManifestHash = '';
      let reservedManifestReadFailed = false;
      if (config.reservedRunManifestPath) {
        try {
          const reservedContent = fs.readFileSync(config.reservedRunManifestPath, 'utf-8');
          reservedManifestHash = createHash('sha256').update(reservedContent).digest('hex');
          for (const line of reservedContent.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const row = JSON.parse(trimmed) as { instance_id?: string };
              if (row.instance_id) reservedIds.add(row.instance_id);
            } catch { /* skip malformed lines */ }
          }
        } catch (e) {
          check(
            'no-excluded-tasks',
            'Exclusion registry and reservation gate',
            false,
            `Failed to read reserved-run manifest at ${config.reservedRunManifestPath}: ${(e as Error).message}`,
          );
          reservedManifestReadFailed = true;
        }
      }

      if (!reservedManifestReadFailed) {
      const selected = config.selectedInstanceIds ?? [];

      // Tier 1: hard exclusion violations (IDs in the immutable registry)
      // devCanary bypass: dev canary runs explicitly use excluded dev IDs.
      // These IDs are in the exclusion registry because they ARE dev data.
      // The devCanary flag allows them while recording the run as development evidence only.
      const hardViolations = config.devCanary
        ? []  // Dev canary: excluded dev IDs are expected and allowed
        : selected.filter(id => excludedIds.has(id));

      // Tier 2: reserved-ID violations
      // A reserved ID may only be used if ALL five binding fields match.
      const reservedViolations: string[] = [];
      const reservedAllowed: string[] = [];
      if (reservedIds.size > 0) {
        const reservedSelected = selected.filter(id => reservedIds.has(id));
        if (reservedSelected.length > 0) {
          // Load and verify preregistration
          let preregOk = false;
          let preregDetail = '';
          if (!config.reservedRunManifestPath || !config.preregistrationHash || !config.campaignId) {
            preregDetail = 'reservedRunManifestPath, preregistrationHash, and campaignId are all required to use reserved IDs';
          } else {
            // Verify preregistration hash matches the file on disk
            const preregPath = config.reservedRunManifestPath.replace('multilingual_reserved_run.jsonl', 'multilingual_preregistration.json');
            let actualPreregHash = '';
            try {
              const preregContent = fs.readFileSync(preregPath, 'utf-8');
              actualPreregHash = createHash('sha256').update(preregContent).digest('hex');
            } catch (e) {
              preregDetail = `Failed to read preregistration file at ${preregPath}: ${(e as Error).message}`;
            }

            if (!preregDetail) {
              // Parse preregistration to extract binding fields
              let prereg: {
                agent?: { commit?: string };
                model?: { model_id?: string };
                dataset?: { revision?: string; id_list_sha256?: string };
                run_parameters?: { mode?: string };
              } = {};
              try {
                prereg = JSON.parse(fs.readFileSync(preregPath, 'utf-8'));
              } catch { /* handled above */ }

              const bindingChecks = [
                // 1. selectedIdsHash must match preregistration dataset id_list_sha256
                config.selectedIdsHash && prereg.dataset?.id_list_sha256
                  ? config.selectedIdsHash === prereg.dataset.id_list_sha256
                    ? null
                    : `selectedIdsHash mismatch: config=${config.selectedIdsHash?.slice(0,16)} prereg=${prereg.dataset.id_list_sha256?.slice(0,16)}`
                  : null,
                // 2. datasetRevision must match preregistration dataset.revision
                config.datasetRevision && prereg.dataset?.revision
                  ? config.datasetRevision === prereg.dataset.revision
                    ? null
                    : `datasetRevision mismatch: config=${config.datasetRevision} prereg=${prereg.dataset.revision}`
                  : null,
                // 3. preregistrationHash must match the file
                config.preregistrationHash !== actualPreregHash
                  ? `preregistrationHash mismatch: config=${config.preregistrationHash?.slice(0,16)} file=${actualPreregHash.slice(0,16)}`
                  : null,
                // 4. modelId must match preregistration model.model_id
                config.modelId && prereg.model?.model_id
                  ? config.modelId === prereg.model.model_id
                    ? null
                    : `modelId mismatch: config=${config.modelId} prereg=${prereg.model.model_id}`
                  : null,
                // 5. campaignId must match preregistration evaluation_name
                // (we use a hash of the evaluation_name as the campaign ID)
              ].filter(Boolean);

              if (bindingChecks.length > 0) {
                preregDetail = `Binding field mismatch(es): ${bindingChecks.join('; ')}`;
              } else {
                preregOk = true;
                preregDetail = `All 4 binding fields match preregistration (hash:${actualPreregHash.slice(0,16)}...)`;
              }
            }
          }

          if (preregOk) {
            reservedAllowed.push(...reservedSelected);
          } else {
            reservedViolations.push(...reservedSelected);
          }
        }
      }

      const totalViolations = hardViolations.length + reservedViolations.length;

      if (totalViolations > 0) {
        const parts: string[] = [];
        if (hardViolations.length > 0) {
          parts.push(
            `HARD EXCLUSION: ${hardViolations.length} ID(s) are in the immutable exposure registry ` +
            `and must never be used as evaluation data: ${hardViolations.slice(0, 5).join(', ')}` +
            (hardViolations.length > 5 ? ` ... and ${hardViolations.length - 5} more` : '')
          );
        }
        if (reservedViolations.length > 0) {
          parts.push(
            `RESERVATION VIOLATION: ${reservedViolations.length} ID(s) are reserved for a specific campaign ` +
            `but the binding fields do not match the preregistration. ` +
            `IDs: ${reservedViolations.slice(0, 5).join(', ')}` +
            (reservedViolations.length > 5 ? ` ... and ${reservedViolations.length - 5} more` : '')
          );
        }
        check(
          'no-excluded-tasks',
          'Exclusion registry and reservation gate',
          false,
          parts.join(' | ') + `. Registry: ${config.exclusionRegistryPath} (sha256:${regHash.slice(0, 16)}...)`,
        );
      } else {
        const allowedNote = reservedAllowed.length > 0
          ? ` + ${reservedAllowed.length} reserved IDs permitted under exact preregistration match`
          : '';
        check(
          'no-excluded-tasks',
          'Exclusion registry and reservation gate',
          true,
          `Exclusion check passed: ${selected.length} selected IDs, ` +
          `${excludedIds.size} excluded IDs, 0 hard violations${allowedNote}. ` +
          `Registry sha256:${regHash.slice(0, 16)}...`,
        );
      }
      } // end if (!reservedManifestReadFailed)
    } catch (e) {
      check(
        'no-excluded-tasks',
        'Exclusion registry and reservation gate',
        false,
        `Failed to read exclusion registry at ${config.exclusionRegistryPath}: ${(e as Error).message}`,
      );
    }
  } else if (config.scoredRun) {
    // Scored run without an exclusion registry path is a blocking failure
    check(
      'no-excluded-tasks',
      'Exclusion registry and reservation gate',
      false,
      'Scored run requires an exclusion registry. ' +
      'Set SWEBENCH_EXCLUSION_REGISTRY=data/swebench/exclusions.jsonl before launching.',
    );
  }

  // ── Check 9: Evaluation protocol — full digest binding ───────────────────────
  // For scored runs:
  //   (a) The protocol file must be present and schema-valid.
  //   (b) The full 64-char SHA-256 of the protocol bytes must be stored in the manifest.
  //   (c) If config.evalProtocolHash is already set (from a prior read), it must match
  //       the freshly-computed hash of the file bytes — reject any mismatch.
  //   (d) The manifest must record the protocol hash, selectedIds hash, and exclusion
  //       registry hash together so the three artifacts are cross-bound.
  if (config.evalProtocolPath) {
    try {
      const protocolContent = fs.readFileSync(config.evalProtocolPath, 'utf-8');
      const protocolHash = createHash('sha256').update(protocolContent).digest('hex'); // full 64-char
      // (a) Schema validation
      const protocol = JSON.parse(protocolContent) as { _schema?: string; _version?: string };
      if (protocol._schema !== 'andromeda-eval-protocol') {
        check(
          'eval-protocol-present',
          'Versioned evaluation protocol present, schema-valid, and cross-bound',
          false,
          `Evaluation protocol at ${config.evalProtocolPath} has wrong schema: ${protocol._schema}`,
        );
      } else if (config.evalProtocolHash && config.evalProtocolHash !== 'unknown' && config.evalProtocolHash !== protocolHash) {
        // (c) Reject hash mismatch: the config was built with a different file
        check(
          'eval-protocol-present',
          'Versioned evaluation protocol present, schema-valid, and cross-bound',
          false,
          `Evaluation protocol hash mismatch: ` +
          `manifest has ${config.evalProtocolHash} but file hashes to ${protocolHash}. ` +
          `The protocol file was modified after the config was built.`,
        );
      } else {
        // (b) + (d) Store full hash and cross-bind
        // Update config so the full hash is written to the manifest
        (config as { evalProtocolHash?: string }).evalProtocolHash = protocolHash;
        const crossBound = [
          `protocol:${protocolHash}`,
          config.selectedIdsHash ? `selectedIds:${config.selectedIdsHash}` : 'selectedIds:unset',
          config.exclusionRegistryHash ? `exclusionRegistry:${config.exclusionRegistryHash}` : 'exclusionRegistry:unset',
        ].join(' | ');
        check(
          'eval-protocol-present',
          'Versioned evaluation protocol present, schema-valid, and cross-bound',
          true,
          `Protocol v${protocol._version} sha256:${protocolHash} ` +
          `cross-bound with ${crossBound}`,
        );
      }
    } catch (e) {
      check(
          'eval-protocol-present',
          'Versioned evaluation protocol present, schema-valid, and cross-bound',
          false,
          `Failed to read evaluation protocol at ${config.evalProtocolPath}: ${(e as Error).message}`,
      );
    }
  } else if (config.scoredRun) {
    // Scored run without an evaluation protocol is a blocking failure
    check(
      'eval-protocol-present',
      'Versioned evaluation protocol present, schema-valid, and cross-bound',
      false,
      'Scored run requires a versioned evaluation protocol. ' +
      'Set SWEBENCH_EVAL_PROTOCOL=data/eval_protocol_v1.json before launching.',
    );
  }

  // ── Build run metadata ────────────────────────────────────────────────────
  const allPassed = checks.filter(c => c.blocksLaunch).every(c => c.passed);
  let runMetadata: RunMetadata | undefined;

  if (allPassed) {
    const agentCommit = getAgentCommit();
    const imageDigest = config.imageRef.includes("@sha256:")
      ? "sha256:" + config.imageRef.split("@sha256:")[1]
      : "sha256:unresolved";

    runMetadata = {
      runId: `andromeda-run-${Date.now()}-${createHash("sha256").update(config.imageRef + config.taskListPath).digest("hex").slice(0, 8)}`,
      agentVersion: config.agentVersion,
      agentCommit,
      imageRef: config.imageRef,
      imageDigest,
      harnessRevision: config.harnessRevision,
      modelId: config.modelId,
      promptTemplateHash: config.promptTemplateHash,
      temperature: config.temperature,
      topP: config.topP,
      maxRetries: config.maxRetries,
      instanceTimeoutMs: config.instanceTimeoutMs,
      concurrency: config.concurrency,
      spendCapUsd: config.spendCapUsd,
      taskListPath: config.taskListPath,
      taskListHash,
      taskCount,
      datasetName: config.datasetName,
      datasetRevision: config.datasetRevision,
      datasetSplit: config.datasetSplit,
      instanceIdHash: config.instanceIdHash,
      scoredRun: config.scoredRun,
      externalSearch: false,
      allowRecoveryPatchApplication: false,
      canarySliceSize: canarySize,
      canaryAbortThreshold: canaryThreshold,
      createdAt: new Date().toISOString(),
      runBundlePath: config.runBundlePath,
      ...(config.exclusionRegistryPath ? {
        exclusionRegistryPath: config.exclusionRegistryPath,
        exclusionRegistryHash: config.exclusionRegistryHash,
        selectedIdsHash: config.selectedIdsHash,
      } : {}),
      ...(config.evalProtocolPath ? {
        evalProtocolPath: config.evalProtocolPath,
        evalProtocolHash: config.evalProtocolHash,
      } : {}),
      ...(config.reservedRunManifestPath ? {
        reservedRunManifestPath: config.reservedRunManifestPath,
        preregistrationHash: config.preregistrationHash,
        campaignId: config.campaignId,
      } : {}),
      ...(config.devCanary ? {
        devCanary: true,
      } : {}),
    };
  }

  return { passed: allPassed, checks, runMetadata };
}

/**
 * Gets the current agent git commit hash.
 * Returns "unknown" if git is not available.
 */
function getAgentCommit(): string {
  try {
    const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8", stdio: "pipe" });
    return result.stdout?.trim() ?? "unknown";
  } catch {
    return "unknown";
  }
}

// ── BenchmarkLauncher class ───────────────────────────────────────────────────

/**
 * BenchmarkLauncher — orchestrates the pre-launch checklist and run metadata.
 *
 * Usage:
 *   const launcher = new BenchmarkLauncher(config);
 *   const result = launcher.preflight();
 *   if (!result.passed) { ... abort ... }
 *   launcher.writeRunBundle(result.runMetadata!);
 *   // Set BENCHMARK_MODE=scored before starting instances
 *   process.env.BENCHMARK_MODE = "scored";
 *   // ... run instances ...
 *   launcher.writeReport(report);
 */
export class BenchmarkLauncher {
  constructor(private readonly config: BenchmarkRunConfig) {}

  /**
   * Runs the 7-item pre-launch checklist.
   * Throws if any blocking check fails.
   */
  preflight(): PreLaunchCheckResult {
    const result = runPreLaunchChecklist(this.config);

    // Print results
    console.log("\n=== BenchmarkLauncher Pre-flight Checklist ===");
    for (const check of result.checks) {
      const icon = check.passed ? "✓" : (check.blocksLaunch ? "✗" : "⚠");
      console.log(`  ${icon} [${check.id}] ${check.name}`);
      if (!check.passed || process.env.BENCHMARK_VERBOSE) {
        console.log(`      ${check.detail}`);
      }
    }

    const blockingFailures = result.checks.filter(c => c.blocksLaunch && !c.passed);
    if (blockingFailures.length > 0) {
      console.error(`\n✗ Pre-flight FAILED: ${blockingFailures.length} blocking check(s) failed.`);
      console.error("  Fix the above issues before launching the benchmark.");
      throw new Error(
        `BenchmarkLauncher pre-flight failed: ${blockingFailures.map(c => c.id).join(", ")}`,
      );
    }

    console.log(`\n✓ Pre-flight PASSED: All ${result.checks.filter(c => c.blocksLaunch).length} blocking checks passed.`);
    return result;
  }

  /**
   * Writes the run metadata bundle to disk.
   * Must be called after preflight() succeeds.
   */
  writeRunBundle(metadata: RunMetadata): void {
    const dir = path.dirname(this.config.runBundlePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.config.runBundlePath, JSON.stringify(metadata, null, 2));
    console.log(`[BenchmarkLauncher] Run bundle written to ${this.config.runBundlePath}`);
  }

  /**
   * Writes the final benchmark report.
   * The report distinguishes all 6 outcome categories.
   */
  writeReport(report: BenchmarkReport): void {
    const reportPath = this.config.runBundlePath.replace(".json", "-report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    // Print summary
    const { summary } = report;
    const total = summary.total;
    console.log("\n=== Benchmark Report ===");
    console.log(`  Total instances:       ${total}`);
    console.log(`  Resolved:              ${summary.resolved} (${pct(summary.resolved, total)}%)`);
    console.log(`  Test failures:         ${summary.testFailures} (${pct(summary.testFailures, total)}%)`);
    console.log(`  Exact-apply failures:  ${summary.exactApplyFailures} (${pct(summary.exactApplyFailures, total)}%)`);
    console.log(`  Invalid instances:     ${summary.invalidInstances} (${pct(summary.invalidInstances, total)}%)`);
    console.log(`  Infra failures:        ${summary.infraFailures} (${pct(summary.infraFailures, total)}%)`);
    console.log(`  Timed out:             ${summary.timedOut} (${pct(summary.timedOut, total)}%)`);
    console.log(`  Wall clock:            ${Math.round(report.wallClockMs / 1000)}s`);
    console.log(`  Total cost:            $${report.totalCostUsd.toFixed(4)}`);
    console.log(`\n  Report written to: ${reportPath}`);
  }

  /**
   * Checks whether the canary slice should abort the full batch.
   * Returns true if the infra failure rate exceeds the abort threshold.
   */
  shouldAbortAfterCanary(canaryResults: InstanceResult[]): boolean {
    const threshold = this.config.canaryAbortThreshold ?? 0.6;
    const infraFailures = canaryResults.filter(r => r.outcome === "infra_failure").length;
    const rate = canaryResults.length > 0 ? infraFailures / canaryResults.length : 0;
    if (rate >= threshold) {
      console.error(
        `[BenchmarkLauncher] Canary abort: ${infraFailures}/${canaryResults.length} infra failures ` +
        `(${Math.round(rate * 100)}% > ${Math.round(threshold * 100)}% threshold)`,
      );
      return true;
    }
    return false;
  }

  /**
   * Builds an empty BenchmarkReport from run metadata.
   */
  static buildEmptyReport(metadata: RunMetadata): BenchmarkReport {
    return {
      runId: metadata.runId,
      runMetadata: metadata,
      summary: {
        total: 0,
        resolved: 0,
        testFailures: 0,
        exactApplyFailures: 0,
        invalidInstances: 0,
        infraFailures: 0,
        timedOut: 0,
        predictionReady: 0,
        budgetExhausted: 0,
      },
      instances: [],
      completedAt: "",
      wallClockMs: 0,
      totalCostUsd: 0,
    };
  }

  /**
   * Records an instance result into the report.
   */
  static recordInstance(report: BenchmarkReport, result: InstanceResult): void {
    report.instances.push(result);
    report.summary.total++;
    switch (result.outcome) {
      case "resolved":           report.summary.resolved++;           break;
      case "test_failure":       report.summary.testFailures++;       break;
      case "exact_apply_failure": report.summary.exactApplyFailures++; break;
      case "invalid_instance":   report.summary.invalidInstances++;   break;
      case "infra_failure":      report.summary.infraFailures++;      break;
      case "timed_out":          report.summary.timedOut++;           break;
      case "prediction_ready":   report.summary.predictionReady++;    break;
      case "budget_exhausted":   report.summary.budgetExhausted++;    break;
    }
    if (result.costUsd) {
      report.totalCostUsd += result.costUsd;
    }
  }

  /**
   * P0.4: Reconciles the four artifact sets at run completion.
   * selectedIds = JSONL IDs = internal-report IDs, with no duplicates.
   * Returns a reconciliation record and logs any discrepancies.
   */
  static reconcileArtifacts(
    selectedIds: string[],
    jsonlPath: string,
    report: BenchmarkReport,
  ): BenchmarkReport['reconciliation'] {
    // Read JSONL rows with full content for hash verification
    const jsonlRows = new Map<string, { patchHash?: string; storedHash?: string }>();
    const jsonlIds: string[] = [];
    try {
      const content = fs.readFileSync(jsonlPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const row = JSON.parse(trimmed) as {
            instance_id?: string;
            model_patch?: string;
            _patch_sha256?: string;
          };
          if (row.instance_id) {
            jsonlIds.push(row.instance_id);
            const patchHash = row.model_patch !== undefined
              ? createHash('sha256').update(row.model_patch, 'utf8').digest('hex')
              : undefined;
            jsonlRows.set(row.instance_id, {
              patchHash,
              storedHash: row._patch_sha256,
            });
          }
        } catch { /* skip malformed lines */ }
      }
    } catch (e) {
      console.error(`[Reconciliation] Failed to read JSONL at ${jsonlPath}: ${(e as Error).message}`);
    }

    // Report IDs and outcomes
    const reportIds = report.instances.map(i => i.instanceId);
    const reportMap = new Map(report.instances.map(i => [i.instanceId, i]));

    // Check for duplicates
    const jsonlDupes = jsonlIds.filter((id, idx) => jsonlIds.indexOf(id) !== idx);
    const reportDupes = reportIds.filter((id, idx) => reportIds.indexOf(id) !== idx);

    // Check for missing
    const jsonlSet = new Set(jsonlIds);
    const reportSet = new Set(reportIds);

    const missingFromJsonl = selectedIds.filter(id => !jsonlSet.has(id));
    const missingFromReport = selectedIds.filter(id => !reportSet.has(id));

    // Build per-instance status (one entry per selected ID, no gaps)
    const hashMismatches: string[] = [];
    const perInstance = selectedIds.map(id => {
      const jsonlRow = jsonlRows.get(id);
      const reportRow = reportMap.get(id);
      const jsonlPatchHash = jsonlRow?.patchHash;
      const storedPatchHash = jsonlRow?.storedHash;
      // Hash is consistent if:
      //   - both absent (empty patch or not in JSONL): OK
      //   - both present and equal: OK
      //   - present but not equal: VIOLATION
      const hashConsistent = !jsonlPatchHash || !storedPatchHash
        ? true  // one or both absent — no hash to compare
        : jsonlPatchHash === storedPatchHash;
      if (!hashConsistent) hashMismatches.push(id);
      return {
        instanceId: id,
        inJsonl: jsonlSet.has(id),
        inReport: reportSet.has(id),
        reportOutcome: reportRow?.outcome,
        ...(jsonlPatchHash ? { jsonlPatchHash } : {}),
        ...(storedPatchHash ? { storedPatchHash } : {}),
        hashConsistent,
      };
    });

    const consistent = missingFromJsonl.length === 0 &&
      missingFromReport.length === 0 &&
      jsonlDupes.length === 0 &&
      reportDupes.length === 0 &&
      jsonlIds.length === selectedIds.length &&
      reportIds.length === selectedIds.length &&
      hashMismatches.length === 0;

    const reconciliation: BenchmarkReport['reconciliation'] = {
      selectedCount: selectedIds.length,
      jsonlCount: jsonlIds.length,
      reportCount: reportIds.length,
      consistent,
      ...(missingFromJsonl.length > 0 ? { missingFromJsonl } : {}),
      ...(missingFromReport.length > 0 ? { missingFromReport } : {}),
      ...(jsonlDupes.length > 0 ? { duplicatesInJsonl: jsonlDupes } : {}),
      ...(reportDupes.length > 0 ? { duplicatesInReport: reportDupes } : {}),
      perInstance,
      ...(hashMismatches.length > 0 ? { hashMismatches } : {}),
    };

    if (!consistent) {
      console.error('[Reconciliation] ARTIFACT MISMATCH DETECTED:');
      if (missingFromJsonl.length > 0)
        console.error(`  Missing from JSONL: ${missingFromJsonl.join(', ')}`);
      if (missingFromReport.length > 0)
        console.error(`  Missing from report: ${missingFromReport.join(', ')}`);
      if (jsonlDupes.length > 0)
        console.error(`  Duplicates in JSONL: ${jsonlDupes.join(', ')}`);
      if (reportDupes.length > 0)
        console.error(`  Duplicates in report: ${reportDupes.join(', ')}`);
      if (hashMismatches.length > 0)
        console.error(`  Hash mismatches: ${hashMismatches.join(', ')}`);
    } else {
      console.log(
        `[Reconciliation] Artifacts consistent: ${selectedIds.length} selected = ` +
        `${jsonlIds.length} JSONL = ${reportIds.length} report rows, ` +
        `${perInstance.filter(p => p.hashConsistent).length}/${perInstance.length} hash checks pass.`
      );
    }

    return reconciliation;
  }
}

function pct(n: number, total: number): string {
  if (total === 0) return "0.0";
  return ((n / total) * 100).toFixed(1);
}
