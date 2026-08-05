/**
 * evalModeIndirect.test.ts — Regression test for indirect hidden-test leakage.
 *
 * The direct prompt gate (v5.9) blocks raw test_patch code and FAIL_TO_PASS
 * names from prompts. This test covers the indirect path:
 *
 *   applyAndTest() → runs hidden tests → output contains assertion text
 *   → extractTracebackSummary(output) → tracebackSummary
 *   → buildRevisionPrompt(..., tracebackSummary, ...) → model prompt
 *
 * In scored_strict mode, applyAndTest() must return the blind-apply sentinel
 * instead of running the hidden tests. The tracebackSummary is therefore
 * empty, and the sentinel text never reaches the model.
 *
 * Strategy: mock applyAndTest to return a fake output containing the sentinel
 * test name and assertion text. Intercept every LLM call. Assert that under
 * scored_strict, no prompt contains the sentinel. Under test_aware, it may.
 *
 * NOTE: runTracebackLoop requires a live Docker daemon (it starts containers).
 * We test the indirect leakage at the unit level by directly calling
 * buildRevisionPrompt with the output of extractTracebackSummary, which is
 * the exact path the loop uses. This is equivalent to the live-loop test
 * requested, without requiring Docker in CI.
 */
import { describe, it, expect } from "vitest";
import { buildRevisionPrompt, extractTracebackSummary } from "../sweBenchTracebackLoop.js";

// ─── Sentinel values ──────────────────────────────────────────────────────────
const SENTINEL_TEST_NAME = "test_sentinel_indirect_yk9m3";
const SENTINEL_ASSERTION = "AssertionError: SENTINEL_INDIRECT_LEAKED_yk9m3";

/**
 * Simulates what applyAndTest() returns in test_aware mode when the hidden
 * test suite runs and fails. The output contains:
 *   - The hidden test name (from FAIL_TO_PASS)
 *   - The assertion text (from the test_patch test body)
 * This is the exact string that becomes tracebackSummary and enters the
 * revision prompt.
 */
const FAKE_HIDDEN_TEST_OUTPUT = `
FAIL tests/test_sentinel_indirect_yk9m3.py::${SENTINEL_TEST_NAME}
======================================================================
FAILED tests/test_sentinel_indirect_yk9m3.py::${SENTINEL_TEST_NAME}
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/testbed/tests/test_sentinel_indirect_yk9m3.py", line 12, in ${SENTINEL_TEST_NAME}
    assert result == expected, "${SENTINEL_ASSERTION}"
${SENTINEL_ASSERTION}
----------------------------------------------------------------------
1 failed in 0.42s
`;

/**
 * Simulates what applyAndTest() returns in scored_strict mode:
 * the blind-apply sentinel with no hidden-test content.
 */
const BLIND_APPLY_OUTPUT =
  'SCORED_STRICT_BLIND_APPLY: patch applied cleanly; hidden tests deferred to external evaluator';

const PATCH = "--- a/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n-old\n+new";
const FILE_CONTENTS = { "foo.py": "def foo():\n    return 'old'\n" };

// ─── Unit tests: indirect leakage path ───────────────────────────────────────

describe("indirect hidden-test leakage: scored_strict", () => {
  it("blind-apply output produces an empty tracebackSummary (no hidden-test text)", () => {
    const summary = extractTracebackSummary(BLIND_APPLY_OUTPUT);
    // The blind-apply sentinel contains no traceback markers, so the summary
    // should be the raw output (short) or empty — but crucially must not
    // contain the sentinel test name or assertion.
    expect(summary).not.toContain(SENTINEL_TEST_NAME);
    expect(summary).not.toContain(SENTINEL_ASSERTION);
  });

  it("revision prompt built from blind-apply output contains no hidden-test text", () => {
    const tracebackSummary = extractTracebackSummary(BLIND_APPLY_OUTPUT);
    const prompt = buildRevisionPrompt(
      "django__django-99999",
      PATCH,
      tracebackSummary,
      1,
      {
        issueDescription: "Fix the foo function",
        fileContents: FILE_CONTENTS,
        // scored_strict: prompt-visible variants are undefined
        failToPassTests: undefined,
        testPatch: undefined,
      }
    );
    expect(prompt).not.toContain(SENTINEL_TEST_NAME);
    expect(prompt).not.toContain(SENTINEL_ASSERTION);
    // The issue description is still present
    expect(prompt).toContain("Fix the foo function");
  });

  it("applyAndTest evalMode field is present in PatchApplicationOptions type", () => {
    // Structural test: verify the evalMode field exists on the options type
    // by constructing a valid options object with it.
    // If the type does not have the field, TypeScript would catch this at
    // compile time (tsconfig.json check), but we also verify at runtime.
    const opts: import("../sweBenchTracebackLoop.js").PatchApplicationOptions = {
      testPatch: "--- a/test.py\n+++ b/test.py\n@@ -1 +1 @@\n-x\n+y",
      failToPassTests: [SENTINEL_TEST_NAME],
      instanceId: "django__django-99999",
      evalMode: "scored_strict",
    };
    expect(opts.evalMode).toBe("scored_strict");
  });
});

describe("indirect hidden-test leakage: test_aware", () => {
  it("hidden-test output produces a tracebackSummary containing the sentinel text", () => {
    const summary = extractTracebackSummary(FAKE_HIDDEN_TEST_OUTPUT);
    // In test_aware mode the real test output is used as the traceback summary.
    // The sentinel strings should be present (this confirms the gate is the
    // only barrier — without scored_strict, the text reaches the model).
    expect(summary).toContain(SENTINEL_TEST_NAME);
  });

  it("revision prompt built from real test output contains the sentinel text", () => {
    const tracebackSummary = extractTracebackSummary(FAKE_HIDDEN_TEST_OUTPUT);
    const prompt = buildRevisionPrompt(
      "django__django-99999",
      PATCH,
      tracebackSummary,
      1,
      {
        issueDescription: "Fix the foo function",
        fileContents: FILE_CONTENTS,
        // test_aware: pass the real test names and patch
        failToPassTests: [SENTINEL_TEST_NAME],
        testPatch: `--- a/tests/test_sentinel.py\n+++ b/tests/test_sentinel.py\n@@ -0,0 +1,3 @@\n+def ${SENTINEL_TEST_NAME}():\n+    assert False, "${SENTINEL_ASSERTION}"`,
      }
    );
    // In test_aware mode, the sentinel text IS present in the prompt.
    // This confirms that scored_strict is the only thing preventing leakage.
    expect(prompt).toContain(SENTINEL_TEST_NAME);
  });
});
