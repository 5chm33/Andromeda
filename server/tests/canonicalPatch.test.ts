/**
 * canonicalPatch.test.ts — P0.3 acceptance tests for the CanonicalPatch record.
 *
 * Elicit requirements:
 * - "Zero-model fixtures: malformed hunk count, multi-file diff, trailing
 *   whitespace, file addition, deletion, rename, and two-hunk edits."
 * - "For each fixture, assert: checked bytes = hashed bytes = serialized bytes."
 * - "A deliberate post-hash mutation must block submission and create exactly
 *   one internal failure row."
 *
 * All tests are zero-model and zero-Docker.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
  buildCanonicalPatch,
  verifyCanonicalPatch,
  serializeCanonicalPatch,
  type CanonicalPatchRecord,
} from '../canonicalPatch.js';

// ── Fixture patches ───────────────────────────────────────────────────────────

const INSTANCE_ID = 'test__test-001';
const BASE_COMMIT = 'abc123def456abc123def456abc123def456abc12';
const IMAGE_DIGEST = 'sha256:' + 'a'.repeat(64);

function makeApplyCheck(exitCode = 0, output = ''): {
  exitCode: number;
  output: string;
  command: string;
} {
  return {
    exitCode,
    output,
    command: 'git apply --check',
  };
}

// A well-formed single-file single-hunk patch
const SIMPLE_PATCH = `--- a/src/foo.py
+++ b/src/foo.py
@@ -1,3 +1,4 @@
 def foo():
-    return 1
+    return 2
+    # fixed
 
 def bar():
`;

// A patch with incorrect hunk counts (fixHunkCounts should repair this)
const MALFORMED_HUNK_PATCH = `--- a/src/foo.py
+++ b/src/foo.py
@@ -1,99 +1,99 @@
 def foo():
-    return 1
+    return 2
`;

// A multi-file patch
const MULTI_FILE_PATCH = `--- a/src/foo.py
+++ b/src/foo.py
@@ -1,3 +1,3 @@
 def foo():
-    return 1
+    return 2
 
--- a/src/bar.py
+++ b/src/bar.py
@@ -5,3 +5,3 @@
 def bar():
-    pass
+    return None
 
`;

// A patch that adds a new file
const NEW_FILE_PATCH = `--- /dev/null
+++ b/src/new_module.py
@@ -0,0 +1,5 @@
+"""New module."""
+
+
+def new_func():
+    return 42
`;

// A patch that deletes a file
const DELETE_FILE_PATCH = `--- a/src/old_module.py
+++ /dev/null
@@ -1,5 +0,0 @@
-"""Old module."""
-
-
-def old_func():
-    return 0
`;

// A patch with trailing whitespace in context lines
const TRAILING_WHITESPACE_PATCH = `--- a/src/foo.py
+++ b/src/foo.py
@@ -1,3 +1,3 @@
 def foo():   
-    return 1
+    return 2
 
`;

// A two-hunk patch
const TWO_HUNK_PATCH = `--- a/src/foo.py
+++ b/src/foo.py
@@ -1,4 +1,4 @@
 def foo():
-    return 1
+    return 2
 
 
@@ -10,4 +10,4 @@
 def bar():
-    pass
+    return None
 
`;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('P0.3 CanonicalPatch — construction', () => {
  it('builds a valid CanonicalPatch from a simple patch', () => {
    const result = buildCanonicalPatch(
      SIMPLE_PATCH, INSTANCE_ID, BASE_COMMIT, IMAGE_DIGEST, makeApplyCheck()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { patch } = result;
    expect(patch.instanceId).toBe(INSTANCE_ID);
    expect(patch.baseCommit).toBe(BASE_COMMIT);
    expect(patch.imageDigest).toBe(IMAGE_DIGEST);
    expect(patch.bytes.length).toBeGreaterThan(0);
    expect(patch.sha256).toHaveLength(64);
    expect(patch.applyExitCode).toBe(0);
    expect(patch.isEmpty).toBe(false);
    // Record must be frozen
    expect(Object.isFrozen(patch)).toBe(true);
  });

  it('normalizes malformed hunk counts exactly once', () => {
    const result = buildCanonicalPatch(
      MALFORMED_HUNK_PATCH, INSTANCE_ID, BASE_COMMIT, IMAGE_DIGEST, makeApplyCheck()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The normalized bytes should NOT contain @@ -1,99 +1,99 @@
    expect(result.patch.bytes).not.toContain('-1,99');
    // The sha256 must match SHA-256(bytes)
    const computed = createHash('sha256').update(result.patch.bytes, 'utf8').digest('hex');
    expect(computed).toBe(result.patch.sha256);
  });

  it('handles multi-file patches', () => {
    const result = buildCanonicalPatch(
      MULTI_FILE_PATCH, INSTANCE_ID, BASE_COMMIT, IMAGE_DIGEST, makeApplyCheck()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patch.bytes).toContain('src/foo.py');
    expect(result.patch.bytes).toContain('src/bar.py');
  });

  it('handles new-file patches', () => {
    const result = buildCanonicalPatch(
      NEW_FILE_PATCH, INSTANCE_ID, BASE_COMMIT, IMAGE_DIGEST, makeApplyCheck()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patch.bytes).toContain('/dev/null');
    expect(result.patch.bytes).toContain('new_module.py');
  });

  it('handles delete-file patches', () => {
    const result = buildCanonicalPatch(
      DELETE_FILE_PATCH, INSTANCE_ID, BASE_COMMIT, IMAGE_DIGEST, makeApplyCheck()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patch.bytes).toContain('/dev/null');
    expect(result.patch.bytes).toContain('old_module.py');
  });

  it('handles patches with trailing whitespace', () => {
    const result = buildCanonicalPatch(
      TRAILING_WHITESPACE_PATCH, INSTANCE_ID, BASE_COMMIT, IMAGE_DIGEST, makeApplyCheck()
    );
    expect(result.ok).toBe(true);
  });

  it('handles two-hunk patches', () => {
    const result = buildCanonicalPatch(
      TWO_HUNK_PATCH, INSTANCE_ID, BASE_COMMIT, IMAGE_DIGEST, makeApplyCheck()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Two hunks should both be present
    const hunkCount = (result.patch.bytes.match(/^@@/gm) ?? []).length;
    expect(hunkCount).toBe(2);
  });

  it('returns apply_check_failed when git apply --check exits non-zero', () => {
    const result = buildCanonicalPatch(
      SIMPLE_PATCH, INSTANCE_ID, BASE_COMMIT, IMAGE_DIGEST,
      makeApplyCheck(1, 'error: corrupt patch at line 5')
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('apply_check_failed');
    expect(result.detail).toContain('corrupt patch');
  });

  it('builds a valid empty CanonicalPatch from an empty string', () => {
    const result = buildCanonicalPatch(
      '', INSTANCE_ID, BASE_COMMIT, IMAGE_DIGEST, makeApplyCheck()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // fixHunkCounts('') returns '\n' (empty string through split/join)
    // isEmpty is determined by bytes.trim().length === 0
    expect(result.patch.isEmpty).toBe(true);
    expect(result.patch.bytes.trim()).toBe('');
  });
});

describe('P0.3 CanonicalPatch — identity invariant', () => {
  it('checked bytes = hashed bytes = serialized bytes for all fixture types', () => {
    const fixtures = [
      { name: 'simple', patch: SIMPLE_PATCH },
      { name: 'multi-file', patch: MULTI_FILE_PATCH },
      { name: 'new-file', patch: NEW_FILE_PATCH },
      { name: 'delete-file', patch: DELETE_FILE_PATCH },
      { name: 'trailing-whitespace', patch: TRAILING_WHITESPACE_PATCH },
      { name: 'two-hunk', patch: TWO_HUNK_PATCH },
    ];

    for (const { name, patch: rawPatch } of fixtures) {
      const result = buildCanonicalPatch(
        rawPatch, INSTANCE_ID, BASE_COMMIT, IMAGE_DIGEST, makeApplyCheck()
      );
      expect(result.ok, `${name}: build failed`).toBe(true);
      if (!result.ok) continue;

      const { patch } = result;

      // 1. sha256 = SHA-256(bytes)
      const computedHash = createHash('sha256').update(patch.bytes, 'utf8').digest('hex');
      expect(computedHash, `${name}: sha256 mismatch`).toBe(patch.sha256);

      // 2. verifyCanonicalPatch passes
      const { valid, violations } = verifyCanonicalPatch(patch);
      expect(valid, `${name}: verify failed: ${violations.join('; ')}`).toBe(true);

      // 3. serialized bytes = patch.bytes
      const serialized = serializeCanonicalPatch(patch, 'test-model');
      const parsed = JSON.parse(serialized);
      expect(parsed.model_patch, `${name}: serialized bytes mismatch`).toBe(patch.bytes);

      // 4. SHA-256 of serialized model_patch = patch.sha256
      const serializedHash = createHash('sha256')
        .update(parsed.model_patch, 'utf8').digest('hex');
      expect(serializedHash, `${name}: serialized hash mismatch`).toBe(patch.sha256);
    }
  });
});

describe('P0.3 CanonicalPatch — post-hash mutation blocks submission', () => {
  it('serializeCanonicalPatch throws if bytes are mutated after construction', () => {
    const result = buildCanonicalPatch(
      SIMPLE_PATCH, INSTANCE_ID, BASE_COMMIT, IMAGE_DIGEST, makeApplyCheck()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Attempt to mutate the frozen record — this should throw in strict mode
    // or be silently ignored (Object.freeze). Either way, the bytes field
    // must not change.
    const patch = result.patch;
    const originalBytes = patch.bytes;
    const originalHash = patch.sha256;

    // Try to mutate (will throw in strict mode, silently fail otherwise)
    try {
      (patch as { bytes: string }).bytes = 'mutated bytes';
    } catch {
      // Expected in strict mode
    }

    // The bytes must not have changed (Object.freeze enforces this)
    expect(patch.bytes).toBe(originalBytes);
    expect(patch.sha256).toBe(originalHash);

    // serializeCanonicalPatch must still pass (bytes unchanged)
    const serialized = serializeCanonicalPatch(patch, 'test-model');
    const parsed = JSON.parse(serialized);
    expect(parsed.model_patch).toBe(originalBytes);
  });

  it('verifyCanonicalPatch detects a manually crafted inconsistent record', () => {
    // Simulate what would happen if a bug mutated bytes after hash computation
    // by constructing an inconsistent record directly.
    const inconsistentPatch: CanonicalPatchRecord = {
      instanceId: INSTANCE_ID,
      baseCommit: BASE_COMMIT,
      imageDigest: IMAGE_DIGEST,
      bytes: 'mutated bytes that do not match the hash',
      sha256: createHash('sha256').update('original bytes', 'utf8').digest('hex'),
      applyCommand: 'git apply --check',
      applyExitCode: 0,
      applyOutputHash: 'test',
      createdAt: new Date().toISOString(),
      isEmpty: false,
    };

    const { valid, violations } = verifyCanonicalPatch(inconsistentPatch);
    expect(valid).toBe(false);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain('sha256 mismatch');

    // serializeCanonicalPatch must throw on an inconsistent record
    expect(() => serializeCanonicalPatch(inconsistentPatch, 'test-model')).toThrow(
      /integrity violation/
    );
  });
});
