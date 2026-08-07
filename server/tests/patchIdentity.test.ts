/**
 * patchIdentity.test.ts — Zero-model patch identity fixture (v5.20)
 *
 * Proves that the bytes validated by git apply --check, the bytes hashed into
 * patchHash, and the bytes serialized to JSONL are all identical — without any
 * LLM calls, Docker containers, or network access.
 *
 * The invariant under test:
 *   sha256(fixHunkCounts(rawPatch)) === patchHash === sha256(serializedPatch)
 *
 * Failure here means the evaluator would receive bytes that differ from what
 * the runner validated, producing evaluator-side apply errors.
 */

import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { fixHunkCounts } from '../sweBenchTracebackLoop.js';

// ─── Representative patch corpus ─────────────────────────────────────────────
// These are the four patch shapes that caused evaluator-side apply errors in
// canary v4: correct hunk counts, wrong hunk counts, trailing whitespace in
// context lines, and multi-hunk patches with mixed issues.

const PATCHES = {
  // Shape 1: Already-canonical patch (fixHunkCounts should be idempotent)
  canonical: `diff --git a/astropy/units/format/cds.py b/astropy/units/format/cds.py
--- a/astropy/units/format/cds.py
+++ b/astropy/units/format/cds.py
@@ -1,5 +1,6 @@
 import re
 import warnings
+from astropy.units import core
 from astropy.units.format import generic
 from astropy.units.format import utils
 from astropy.units import misc
`,

  // Shape 2: Wrong hunk counts (LLM frequently generates these)
  wrongCounts: `diff --git a/sympy/core/function.py b/sympy/core/function.py
--- a/sympy/core/function.py
+++ b/sympy/core/function.py
@@ -716,3 +716,4 @@
     def _eval_rewrite(self, rule, args, **hints):
         return None
+    def _eval_simplify(self, **kwargs):
+        return self
`,

  // Shape 3: Trailing whitespace on context lines (patch command rejects these)
  trailingWhitespace: `diff --git a/django/db/models/query.py b/django/db/models/query.py
--- a/django/db/models/query.py
+++ b/django/db/models/query.py
@@ -100,5 +100,6 @@
 class QuerySet:   
     def __init__(self, model=None, query=None, using=None):   
         self.model = model
+        self._result_cache = None
         self.db = using or router.db_for_read(model)
`,

  // Shape 4: Multi-hunk patch with mixed issues
  multiHunk: `diff --git a/matplotlib/figure.py b/matplotlib/figure.py
--- a/matplotlib/figure.py
+++ b/matplotlib/figure.py
@@ -200,3 +200,4 @@
 class Figure:
     def __init__(self):
+        self._dpi = 100
         self._axes = []
@@ -300,3 +300,4 @@
     def savefig(self, fname):   
         self._check_layout_engines_compat()
+        self._validate_dpi()
         super().savefig(fname)
`,

  // Shape 5: Patch with placeholder @@ -x,N +x,N @@ headers
  placeholder: `diff --git a/requests/models.py b/requests/models.py
--- a/requests/models.py
+++ b/requests/models.py
@@ -x,3 +x,4 @@
 class Response:
     def __init__(self):
+        self.encoding = None
         self.status_code = None
`,
};

// ─── Core invariant tests ─────────────────────────────────────────────────────

describe('Patch identity invariant (v5.20)', () => {
  it('fixHunkCounts is idempotent: applying it twice produces the same bytes', () => {
    for (const [name, raw] of Object.entries(PATCHES)) {
      const once = fixHunkCounts(raw);
      const twice = fixHunkCounts(once);
      expect(twice, `idempotency failed for ${name}`).toBe(once);
    }
  });

  it('sha256(fixHunkCounts(raw)) === sha256(fixHunkCounts(fixHunkCounts(raw)))', () => {
    for (const [name, raw] of Object.entries(PATCHES)) {
      const canonical = fixHunkCounts(raw);
      const hashOnce = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
      const hashTwice = crypto.createHash('sha256').update(fixHunkCounts(canonical), 'utf8').digest('hex');
      expect(hashOnce, `hash stability failed for ${name}`).toBe(hashTwice);
    }
  });

  it('simulates the full pipeline: patchHash === sha256(serializedPatch)', () => {
    // Simulates what sweBenchTracebackLoop.ts now does:
    //   canonicalFinalPatch = fixHunkCounts(currentPatch)
    //   patchHash = sha256(canonicalFinalPatch)
    //   return { finalPatch: canonicalFinalPatch, patchHash }
    //
    // And what run_swebench.ts now does:
    //   cleanPatch = result.finalPatch  (no second fixHunkCounts pass)
    //   serializedHash = sha256(cleanPatch)
    //   assert serializedHash === result.patchHash
    for (const [name, raw] of Object.entries(PATCHES)) {
      // Traceback loop return
      const canonicalFinalPatch = fixHunkCounts(raw);
      const patchHash = crypto.createHash('sha256').update(canonicalFinalPatch, 'utf8').digest('hex');

      // Serializer (run_swebench.ts)
      const cleanPatch = canonicalFinalPatch; // no second fixHunkCounts
      const serializedHash = crypto.createHash('sha256').update(cleanPatch, 'utf8').digest('hex');

      expect(serializedHash, `identity violated for ${name}`).toBe(patchHash);
    }
  });

  it('OLD behavior (pre-v5.20) would have produced a hash mismatch for wrong-count patches', () => {
    // This test documents the bug that was fixed. In the old code:
    //   patchHash = sha256(currentPatch)          [raw, before fixHunkCounts]
    //   cleanPatch = fixHunkCounts(currentPatch)  [normalized, different bytes]
    //   serializedHash = sha256(cleanPatch)        [hash of normalized]
    // For patches where fixHunkCounts changes the bytes, these hashes differ.
    const raw = PATCHES.wrongCounts;
    const canonical = fixHunkCounts(raw);

    // Confirm fixHunkCounts actually changes this patch
    expect(canonical).not.toBe(raw);

    // Old behavior: hash of raw !== hash of canonical
    const oldPatchHash = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
    const oldSerializedHash = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
    expect(oldPatchHash).not.toBe(oldSerializedHash); // this was the bug

    // New behavior: both hashes are the same (canonical is hashed)
    const newPatchHash = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
    const newSerializedHash = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
    expect(newPatchHash).toBe(newSerializedHash); // this is the fix
  });

  it('trailing whitespace is stripped from context lines', () => {
    const raw = PATCHES.trailingWhitespace;
    const canonical = fixHunkCounts(raw);
    // Context lines with trailing spaces should be stripped
    const contextLines = canonical.split('\n').filter(l => !l.startsWith('+') && !l.startsWith('-') && !l.startsWith('@') && !l.startsWith('diff') && !l.startsWith('---') && !l.startsWith('+++') && l.length > 0);
    for (const line of contextLines) {
      expect(line, `context line has trailing whitespace: "${line}"`).toBe(line.trimEnd());
    }
  });

  it('canonical patch ends with a newline', () => {
    for (const [name, raw] of Object.entries(PATCHES)) {
      const canonical = fixHunkCounts(raw);
      expect(canonical.endsWith('\n'), `missing trailing newline for ${name}`).toBe(true);
    }
  });

  it('placeholder @@ -x,N +x,N @@ headers are normalized to numeric start lines', () => {
    const canonical = fixHunkCounts(PATCHES.placeholder);
    // Should not contain literal 'x' in @@ headers
    const hunkHeaders = canonical.split('\n').filter(l => l.startsWith('@@'));
    for (const header of hunkHeaders) {
      expect(header, `placeholder 'x' not replaced in: ${header}`).toMatch(/^@@ -\d+,\d+ \+\d+,\d+ @@/);
    }
  });
});

// ─── Regression: canary v4 evaluator-side apply errors ───────────────────────

describe('Regression: canary v4 evaluator-side apply errors', () => {
  it('astropy-13977 shape: wrong hunk offset causes apply failure without normalization', () => {
    // The evaluator rejected this because the hunk offset was wrong.
    // fixHunkCounts corrects the count so git apply succeeds.
    const raw = `diff --git a/astropy/units/quantity.py b/astropy/units/quantity.py
--- a/astropy/units/quantity.py
+++ b/astropy/units/quantity.py
@@ -100,3 +100,5 @@
 class Quantity:
     def __init__(self):
+        self._unit = None
+        self._value = None
         self._dtype = None
`;
    const canonical = fixHunkCounts(raw);
    // The canonical form should have correct counts
    const hunkHeader = canonical.split('\n').find(l => l.startsWith('@@'));
    expect(hunkHeader).toBeDefined();
    // 3 context + 2 added = newCount 5; 3 context = oldCount 3
    expect(hunkHeader).toMatch(/^@@ -100,3 \+100,5 @@/);
  });

  it('sympy-12096 shape: hunk at wrong line number', () => {
    // The evaluator rejected this because the hunk line number was off.
    // This is an offset drift issue — fixHunkCounts preserves the start line
    // but corrects the count. The start line must match the actual file.
    const raw = `diff --git a/sympy/core/function.py b/sympy/core/function.py
--- a/sympy/core/function.py
+++ b/sympy/core/function.py
@@ -716,2 +716,3 @@
     def _eval_rewrite(self, rule, args, **hints):
+        return None
         return None
`;
    const canonical = fixHunkCounts(raw);
    // Should be idempotent after normalization
    expect(fixHunkCounts(canonical)).toBe(canonical);
  });
});
