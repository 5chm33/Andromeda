/**
 * evalMode.test.ts — Regression tests for the scored_strict / test_aware split.
 *
 * These tests verify that in scored_strict mode, sentinel test_patch code and
 * FAIL_TO_PASS test names never appear in any model-visible prompt.
 *
 * Strategy: intercept every call to the LLM provider and record the prompt.
 * Then assert that neither the sentinel test patch diff nor the sentinel test
 * name appears in any recorded prompt.
 */
import { describe, it, expect } from "vitest";
import { buildRevisionPrompt } from "../sweBenchTracebackLoop.js";
import { runSOTAPipeline, type PipelineConfig } from "../sweBenchPipeline.js";

// ─── Sentinel values ──────────────────────────────────────────────────────────
// These strings are unique enough that they cannot appear in prompts by accident.
const SENTINEL_TEST_PATCH = `--- a/tests/test_sentinel_xk7q2.py
+++ b/tests/test_sentinel_xk7q2.py
@@ -0,0 +1,5 @@
+def test_sentinel_xk7q2_must_not_leak():
+    assert False, "SENTINEL_TEST_PATCH_LEAKED_INTO_PROMPT"`;

const SENTINEL_FAIL_TO_PASS = "tests/test_sentinel_xk7q2.py::test_sentinel_xk7q2_must_not_leak";

// ─── Unit test: buildRevisionPrompt ──────────────────────────────────────────

describe("buildRevisionPrompt: evalMode isolation", () => {
  const TRACEBACK = "Traceback (most recent call last):\n  File 'foo.py', line 1\nAssertionError";
  const PATCH = "--- a/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n-old\n+new";
  const FILE_CONTENTS = { "foo.py": "def foo():\n    return 'old'\n" };

  it("test_aware: inserts sentinel test names and test patch into revision prompt", () => {
    const prompt = buildRevisionPrompt(
      "test-instance",
      PATCH,
      TRACEBACK,
      1,
      {
        issueDescription: "Fix the foo function",
        fileContents: FILE_CONTENTS,
        failToPassTests: [SENTINEL_FAIL_TO_PASS],
        testPatch: SENTINEL_TEST_PATCH,
      }
    );
    // In test_aware mode (no evalMode gate at this layer — caller must gate),
    // the sentinel strings ARE present when passed directly.
    expect(prompt).toContain("test_sentinel_xk7q2");
    expect(prompt).toContain("SENTINEL_TEST_PATCH_LEAKED_INTO_PROMPT");
  });

  it("scored_strict: passing undefined for failToPassTests and testPatch produces a clean prompt", () => {
    const prompt = buildRevisionPrompt(
      "test-instance",
      PATCH,
      TRACEBACK,
      1,
      {
        issueDescription: "Fix the foo function",
        fileContents: FILE_CONTENTS,
        // scored_strict: caller passes undefined (gated by _promptFailToPass / _promptTestPatch)
        failToPassTests: undefined,
        testPatch: undefined,
      }
    );
    expect(prompt).not.toContain("test_sentinel_xk7q2");
    expect(prompt).not.toContain("SENTINEL_TEST_PATCH_LEAKED_INTO_PROMPT");
    // The issue description and file content are still present
    expect(prompt).toContain("Fix the foo function");
  });
});

// ─── Integration test: runSOTAPipeline in scored_strict mode ─────────────────

describe("runSOTAPipeline: scored_strict blocks test data from all prompts", () => {
  it("no prompt sent to the LLM contains the sentinel test patch or test name", async () => {
    const capturedPrompts: string[] = [];

    // Mock LLM provider that records every prompt and returns a minimal patch
    const mockLLM = async (prompt: string): Promise<string> => {
      capturedPrompts.push(prompt);
      // Return a trivial patch so the pipeline doesn't hang
      return `--- a/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n-old\n+new`;
    };

    const config: PipelineConfig = {
      llmProvider: mockLLM,
      agentCount: 1,          // Minimize LLM calls
      maxTracebackAttempts: 1, // One attempt only
      useConsensus: false,     // Skip consensus to reduce calls
      useTracebackLoop: false, // Skip traceback loop — we only test the pipeline layer
      evalMode: "scored_strict",
    };

    // The pipeline options carry the sentinel values as if they came from the dataset.
    // In scored_strict mode, these must NEVER reach the LLM.
    await runSOTAPipeline(
      "django__django-99999",
      "swebench/sweb.eval.x86_64.django__django-99999:latest",
      "Fix the foo function in foo.py",
      { "foo.py": "def foo():\n    return 'old'\n" },
      "--- a/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n-old\n+new",
      config,
      {
        testPatch: SENTINEL_TEST_PATCH,
        failToPassTests: [SENTINEL_FAIL_TO_PASS],
      }
    );

    // Assert: no prompt contains either sentinel string
    const allPrompts = capturedPrompts.join("\n\n===PROMPT_BOUNDARY===\n\n");
    expect(allPrompts).not.toContain("test_sentinel_xk7q2");
    expect(allPrompts).not.toContain("SENTINEL_TEST_PATCH_LEAKED_INTO_PROMPT");
  });

  it("test_aware: sentinel test data IS present in prompts (confirms the gate is the only barrier)", async () => {
    const capturedPrompts: string[] = [];

    const mockLLM = async (prompt: string): Promise<string> => {
      capturedPrompts.push(prompt);
      return `--- a/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n-old\n+new`;
    };

    const config: PipelineConfig = {
      llmProvider: mockLLM,
      agentCount: 1,
      maxTracebackAttempts: 1,
      useConsensus: true,   // Consensus inserts test hints
      useTracebackLoop: false,
      evalMode: "test_aware",
    };

    await runSOTAPipeline(
      "django__django-99999",
      "swebench/sweb.eval.x86_64.django__django-99999:latest",
      "Fix the foo function in foo.py",
      { "foo.py": "def foo():\n    return 'old'\n" },
      "--- a/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n-old\n+new",
      config,
      {
        testPatch: SENTINEL_TEST_PATCH,
        failToPassTests: [SENTINEL_FAIL_TO_PASS],
      }
    );

    // In test_aware mode the sentinel strings should appear in at least one prompt.
    const allPrompts = capturedPrompts.join("\n\n===PROMPT_BOUNDARY===\n\n");
    expect(allPrompts).toContain("test_sentinel_xk7q2");
  });
});
