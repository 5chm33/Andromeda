/**
 * canonicalPatch.ts — P0.3: Immutable canonical patch evidence object.
 *
 * Elicit requirement: "Define a CanonicalPatch record: instanceId, baseCommit,
 * imageDigest, bytes, sha256, applyCommand, applyExitCode, applyOutputHash,
 * and createdAt. Normalize exactly once. Ban transformations after
 * CanonicalPatch construction."
 *
 * The CanonicalPatch is the single source of truth for what bytes are:
 *   1. Validated by git apply --check (evaluator-equivalent semantics)
 *   2. Applied by git apply (no --ignore-whitespace)
 *   3. Hashed (sha256)
 *   4. Serialized to JSONL
 *
 * Once constructed, the bytes field is frozen and must not be mutated.
 * Any attempt to modify bytes after construction throws an error.
 */

import { createHash } from 'crypto';
import { fixHunkCounts } from './sweBenchTracebackLoop.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CanonicalPatchRecord {
  /** SWE-bench instance ID this patch targets. */
  readonly instanceId: string;
  /** Git commit SHA of the base repository state the patch was generated against. */
  readonly baseCommit: string;
  /** Docker image digest (sha256:...) used for validation. */
  readonly imageDigest: string;
  /**
   * The canonical patch bytes — normalized exactly once via fixHunkCounts,
   * then frozen. Must not be mutated after construction.
   */
  readonly bytes: string;
  /** SHA-256 of the canonical bytes. Computed once at construction. */
  readonly sha256: string;
  /**
   * The exact git apply command used for validation.
   * Must match evaluator semantics (no --ignore-whitespace).
   */
  readonly applyCommand: string;
  /** Exit code from git apply --check. 0 = success. */
  readonly applyExitCode: number;
  /** SHA-256 of the stdout+stderr from git apply --check. */
  readonly applyOutputHash: string;
  /** ISO-8601 timestamp when this record was constructed. */
  readonly createdAt: string;
  /**
   * Whether the patch is empty (no changes). An empty patch is a valid
   * CanonicalPatch but will produce an empty JSONL row.
   */
  readonly isEmpty: boolean;
}

/** Result of constructing a CanonicalPatch. */
export type CanonicalPatchResult =
  | { ok: true; patch: CanonicalPatchRecord }
  | { ok: false; reason: CanonicalPatchFailureReason; detail: string };

export type CanonicalPatchFailureReason =
  | 'normalization_error'      // fixHunkCounts threw
  | 'apply_check_failed'       // git apply --check returned non-zero
  | 'hash_mismatch'            // computed hash != expected hash (post-construction check)
  | 'empty_after_normalization'; // patch was non-empty before normalization but empty after

// ── Construction ──────────────────────────────────────────────────────────────

/**
 * Constructs a CanonicalPatch from a raw LLM-generated patch string.
 *
 * This is the ONLY place where normalization (fixHunkCounts) is applied.
 * The caller must not apply fixHunkCounts before or after calling this function.
 *
 * @param rawPatch - Raw patch string from the LLM (may have incorrect hunk counts)
 * @param instanceId - SWE-bench instance ID
 * @param baseCommit - Git commit SHA of the base repository
 * @param imageDigest - Docker image digest used for validation
 * @param applyCheckResult - Result of running git apply --check on the normalized bytes
 */
export function buildCanonicalPatch(
  rawPatch: string,
  instanceId: string,
  baseCommit: string,
  imageDigest: string,
  applyCheckResult: {
    exitCode: number;
    output: string; // stdout + stderr from git apply --check
    command: string; // exact command used
  },
): CanonicalPatchResult {
  // Step 1: Normalize exactly once
  let normalizedBytes: string;
  try {
    normalizedBytes = fixHunkCounts(rawPatch);
  } catch (err) {
    return {
      ok: false,
      reason: 'normalization_error',
      detail: `fixHunkCounts threw: ${(err as Error).message}`,
    };
  }

  // Step 2: Check for empty-after-normalization (only if raw was non-empty)
  if (rawPatch.trim().length > 0 && normalizedBytes.trim().length === 0) {
    return {
      ok: false,
      reason: 'empty_after_normalization',
      detail: `Raw patch had ${rawPatch.length} bytes but normalized to empty string`,
    };
  }

  // Step 3: Compute SHA-256 of the normalized bytes
  const sha256 = createHash('sha256').update(normalizedBytes, 'utf8').digest('hex');

  // Step 4: Compute SHA-256 of the apply output
  const applyOutputHash = createHash('sha256')
    .update(applyCheckResult.output, 'utf8')
    .digest('hex');

  // Step 5: Check if git apply --check passed
  if (applyCheckResult.exitCode !== 0 && normalizedBytes.trim().length > 0) {
    return {
      ok: false,
      reason: 'apply_check_failed',
      detail: `git apply --check exited ${applyCheckResult.exitCode}: ${applyCheckResult.output.slice(0, 500)}`,
    };
  }

  // Step 6: Construct the frozen record
  const record: CanonicalPatchRecord = Object.freeze({
    instanceId,
    baseCommit,
    imageDigest,
    bytes: normalizedBytes,
    sha256,
    applyCommand: applyCheckResult.command,
    applyExitCode: applyCheckResult.exitCode,
    applyOutputHash,
    createdAt: new Date().toISOString(),
    isEmpty: normalizedBytes.trim().length === 0,
  });

  return { ok: true, patch: record };
}

/**
 * Verifies that a CanonicalPatch record is self-consistent:
 * - sha256 matches SHA-256(bytes)
 * - isEmpty matches (bytes.trim().length === 0)
 *
 * Call this before serializing to JSONL as a final integrity check.
 */
export function verifyCanonicalPatch(patch: CanonicalPatchRecord): {
  valid: boolean;
  violations: string[];
} {
  const violations: string[] = [];

  // Check sha256 matches bytes
  const computedHash = createHash('sha256').update(patch.bytes, 'utf8').digest('hex');
  if (computedHash !== patch.sha256) {
    violations.push(
      `sha256 mismatch: stored=${patch.sha256.slice(0, 16)}... computed=${computedHash.slice(0, 16)}...`
    );
  }

  // Check isEmpty is consistent
  const actuallyEmpty = patch.bytes.trim().length === 0;
  if (actuallyEmpty !== patch.isEmpty) {
    violations.push(
      `isEmpty inconsistency: stored=${patch.isEmpty} actual=${actuallyEmpty}`
    );
  }

  return { valid: violations.length === 0, violations };
}

/**
 * Serializes a CanonicalPatch to the JSONL prediction format expected by
 * the SWE-bench evaluator.
 *
 * This is the ONLY place where bytes are written to the output file.
 * The bytes field is written verbatim — no further transformation.
 */
export function serializeCanonicalPatch(
  patch: CanonicalPatchRecord,
  modelNameOrPath: string,
): string {
  // Final integrity check before serialization
  const { valid, violations } = verifyCanonicalPatch(patch);
  if (!valid) {
    throw new Error(
      `CanonicalPatch integrity violation before serialization for ${patch.instanceId}: ` +
      violations.join('; ')
    );
  }

  return JSON.stringify({
    instance_id: patch.instanceId,
    model_patch: patch.bytes,
    model_name_or_path: modelNameOrPath,
    // Evidence fields (not read by evaluator but preserved in the record)
    _patch_sha256: patch.sha256,
    _base_commit: patch.baseCommit,
    _image_digest: patch.imageDigest,
    _apply_exit_code: patch.applyExitCode,
    _created_at: patch.createdAt,
  });
}
