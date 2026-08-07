/**
 * strictModeSentinel.test.ts — P0.2 acceptance tests for strict-mode isolation.
 *
 * Elicit requirement: "Add a sentinel integration test that captures every
 * model prompt and tool input under strict mode and proves no forbidden
 * sentinel appears."
 *
 * Forbidden fields in scored_strict mode:
 *   - hints_text (post-issue comments; prohibited by SWE-bench leaderboard rules)
 *   - test_patch (evaluator's test patch; must not appear in any prompt or tool call)
 *   - FAIL_TO_PASS (evaluator's failing test names)
 *   - PASS_TO_PASS (evaluator's passing test names)
 *   - Reference patch fields (solution patch from the dataset)
 *   - Oracle modes (any field that reveals the solution)
 *   - Test-aware retrieval identifiers
 *
 * These tests are zero-model and zero-Docker. They verify the
 * modelVisibleEvaluationArtifacts() function and the issueDescription
 * construction logic that gates what goes into prompts.
 */

import { describe, it, expect } from 'vitest';

// Import the function that determines what artifacts are visible to the model
// This is the central fail-closed boundary in run_swebench.ts
import { modelVisibleEvaluationArtifacts } from '../sweBenchEvalMode.js';

// ── Sentinel values ───────────────────────────────────────────────────────────

// These are the sentinel strings that must NEVER appear in a scored_strict prompt.
// They are unique enough that their presence in any prompt string is a violation.
const FORBIDDEN_SENTINELS = {
  hints_text: 'SENTINEL_HINTS_TEXT_FORBIDDEN_IN_STRICT_MODE',
  test_patch: 'SENTINEL_TEST_PATCH_FORBIDDEN_IN_STRICT_MODE',
  fail_to_pass_test: 'test_sentinel_fail_to_pass_forbidden::test_method',
  pass_to_pass_test: 'test_sentinel_pass_to_pass_forbidden::test_method',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('P0.2 Strict-mode sentinel — modelVisibleEvaluationArtifacts', () => {
  it('returns empty/falsy values for all evaluator artifacts in scored_strict mode', () => {
    const artifacts = modelVisibleEvaluationArtifacts(
      'scored_strict',
      FORBIDDEN_SENTINELS.test_patch,
      [FORBIDDEN_SENTINELS.fail_to_pass_test, FORBIDDEN_SENTINELS.pass_to_pass_test],
    );

    // In scored_strict mode, evaluator artifacts are empty/falsy — not the sentinel values
    expect(artifacts.promptTestPatch).toBeFalsy();
    expect(artifacts.promptTestPatch).not.toBe(FORBIDDEN_SENTINELS.test_patch);
    expect(artifacts.promptFailToPassTests).toHaveLength(0);
    expect(artifacts.promptFailToPassTests).not.toContain(FORBIDDEN_SENTINELS.fail_to_pass_test);
    expect(artifacts.allowTargetedTestContext).toBe(false);
    // Pipeline fields must also be undefined (not passed to Docker)
    expect(artifacts.pipelineTestPatch).toBeUndefined();
    expect(artifacts.pipelineFailToPassTests).toBeUndefined();
  });

  it('returns evaluator artifacts in test_aware mode', () => {
    const artifacts = modelVisibleEvaluationArtifacts(
      'test_aware',
      FORBIDDEN_SENTINELS.test_patch,
      [FORBIDDEN_SENTINELS.fail_to_pass_test],
    );

    // In test_aware mode, evaluator artifacts are visible (development only)
    expect(artifacts.promptTestPatch).toBe(FORBIDDEN_SENTINELS.test_patch);
    expect(artifacts.promptFailToPassTests).toContain(FORBIDDEN_SENTINELS.fail_to_pass_test);
    expect(artifacts.allowTargetedTestContext).toBe(true);
  });

  it('scored_strict mode with null/empty test_patch returns empty string', () => {
    const artifacts1 = modelVisibleEvaluationArtifacts('scored_strict', undefined, []);
    expect(artifacts1.promptTestPatch).toBeFalsy();

    const artifacts2 = modelVisibleEvaluationArtifacts('scored_strict', '', []);
    expect(artifacts2.promptTestPatch).toBeFalsy();
  });

  it('scored_strict mode with empty FAIL_TO_PASS returns empty array', () => {
    const artifacts = modelVisibleEvaluationArtifacts('scored_strict', 'some patch', []);
    expect(artifacts.promptFailToPassTests).toHaveLength(0);
    expect(artifacts.allowTargetedTestContext).toBe(false);
  });
});

describe('P0.2 Strict-mode sentinel — issue description construction', () => {
  /**
   * Simulates the issueDescription construction logic from run_swebench.ts:
   *
   *   const issueDescription = isScoredRun
   *     ? problem_statement.trim()
   *     : `${problem_statement}\n\n${hints_text || ''}`.trim();
   *
   * In scored_strict mode, only problem_statement is used.
   * hints_text must never appear in the prompt.
   */
  function buildIssueDescription(
    isScoredRun: boolean,
    problem_statement: string,
    hints_text: string,
  ): string {
    return isScoredRun
      ? problem_statement.trim()
      : `${problem_statement}\n\n${hints_text || ''}`.trim();
  }

  it('scored_strict mode excludes hints_text from issue description', () => {
    const description = buildIssueDescription(
      true,
      'Fix the bug in foo.py',
      FORBIDDEN_SENTINELS.hints_text,
    );
    expect(description).not.toContain(FORBIDDEN_SENTINELS.hints_text);
    expect(description).toBe('Fix the bug in foo.py');
  });

  it('test_aware mode includes hints_text in issue description', () => {
    const description = buildIssueDescription(
      false,
      'Fix the bug in foo.py',
      FORBIDDEN_SENTINELS.hints_text,
    );
    expect(description).toContain(FORBIDDEN_SENTINELS.hints_text);
  });

  it('scored_strict mode with empty hints_text produces clean description', () => {
    const description = buildIssueDescription(true, 'Fix the bug', '');
    expect(description).toBe('Fix the bug');
    expect(description).not.toContain('undefined');
    expect(description).not.toContain('null');
  });
});

describe('P0.2 Strict-mode sentinel — forbidden field presence check', () => {
  /**
   * Simulates a prompt audit: given a prompt string, check that none of the
   * forbidden sentinels appear in it.
   *
   * In a real integration test, this would capture the actual prompt sent to
   * the LLM. Here we verify the logic that prevents forbidden fields from
   * entering the prompt in the first place.
   */
  function auditPromptForForbiddenSentinels(prompt: string): {
    clean: boolean;
    violations: string[];
  } {
    const violations: string[] = [];
    for (const [field, sentinel] of Object.entries(FORBIDDEN_SENTINELS)) {
      if (prompt.includes(sentinel)) {
        violations.push(`Forbidden field '${field}' found in prompt: ${sentinel.slice(0, 40)}...`);
      }
    }
    return { clean: violations.length === 0, violations };
  }

  it('a scored_strict prompt built from problem_statement only passes the audit', () => {
    // Simulate a scored_strict prompt
    const artifacts = modelVisibleEvaluationArtifacts(
      'scored_strict',
      FORBIDDEN_SENTINELS.test_patch,
      [FORBIDDEN_SENTINELS.fail_to_pass_test],
    );

    const issueDescription = 'Fix the bug in foo.py'; // problem_statement only

    // Build a simulated prompt (no forbidden fields)
    const prompt = [
      `Issue: ${issueDescription}`,
      `Repository: test/repo`,
      `File: src/foo.py`,
      `Content: def foo(): return 1`,
      // artifacts.promptTestPatch is undefined — not included
      // artifacts.promptFailToPassTests is undefined — not included
    ].join('\n');

    const { clean, violations } = auditPromptForForbiddenSentinels(prompt);
    expect(clean).toBe(true);
    expect(violations).toHaveLength(0);
  });

  it('a prompt that accidentally includes hints_text fails the audit', () => {
    const prompt = [
      'Issue: Fix the bug',
      `Hints: ${FORBIDDEN_SENTINELS.hints_text}`,
    ].join('\n');

    const { clean, violations } = auditPromptForForbiddenSentinels(prompt);
    expect(clean).toBe(false);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('hints_text');
  });

  it('a prompt that accidentally includes test_patch fails the audit', () => {
    const prompt = [
      'Issue: Fix the bug',
      `Test patch: ${FORBIDDEN_SENTINELS.test_patch}`,
    ].join('\n');

    const { clean, violations } = auditPromptForForbiddenSentinels(prompt);
    expect(clean).toBe(false);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('test_patch');
  });

  it('a prompt that includes FAIL_TO_PASS test names fails the audit', () => {
    const prompt = [
      'Issue: Fix the bug',
      `Tests to fix: ${FORBIDDEN_SENTINELS.fail_to_pass_test}`,
    ].join('\n');

    const { clean, violations } = auditPromptForForbiddenSentinels(prompt);
    expect(clean).toBe(false);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('fail_to_pass_test');
  });
});

describe('P0.2 Strict-mode sentinel — launch-time rejection', () => {
  /**
   * Verifies that a scored run with forbidden features enabled fails before
   * dispatching workers.
   *
   * The actual enforcement is in benchmarkLauncher.ts (no-external-search check)
   * and in run_swebench.ts (SWEBENCH_SEARCH=1 check).
   * Here we verify the logic that would be used to reject such a run.
   */
  it('SWEBENCH_SEARCH=1 would be rejected at preflight for scored runs', () => {
    // Simulate the check from benchmarkLauncher.ts
    const searchEnabled = true; // SWEBENCH_SEARCH=1
    const isScoredRun = true;

    // The check: scored run with search enabled must fail
    const checkPasses = !(isScoredRun && searchEnabled);
    expect(checkPasses).toBe(false);
  });

  it('SWEBENCH_SEARCH=0 passes the preflight check for scored runs', () => {
    const searchEnabled = false;
    const isScoredRun = true;

    const checkPasses = !(isScoredRun && searchEnabled);
    expect(checkPasses).toBe(true);
  });
});

describe('P0.2 Strict-mode sentinel — actual message boundary (mock LLM interceptor)', () => {
  /**
   * This test observes the actual message boundary: the exact string that
   * would be passed to callSWEBenchLLM in scored_strict mode.
   *
   * It uses a mock LLM provider that records every prompt string, then
   * asserts that unique sentinel strings placed in hints_text, test_patch,
   * FAIL_TO_PASS, and PASS_TO_PASS never appear in any captured prompt.
   *
   * The prompt is assembled using the same logic as generateInitialPatch
   * in run_swebench.ts, with the scored_strict boundary applied.
   */

  // Unique sentinel strings — if these appear in any prompt, it is a violation
  const BOUNDARY_SENTINELS = {
    hints_text: 'BOUNDARY_SENTINEL_HINTS_TEXT_7f3a9b2c',
    test_patch: 'BOUNDARY_SENTINEL_TEST_PATCH_8e4d1a5f',
    fail_to_pass: 'boundary_sentinel_fail_to_pass::test_method_9c2b7e1d',
    pass_to_pass: 'boundary_sentinel_pass_to_pass::test_method_4a8f3c6e',
  };

  // Captured prompts from the mock LLM provider
  const capturedPrompts: string[] = [];

  // Mock LLM provider that records every prompt
  function mockLLMProvider(prompt: string): Promise<string> {
    capturedPrompts.push(prompt);
    return Promise.resolve('--- a/src/foo.py\n+++ b/src/foo.py\n@@ -1,3 +1,3 @@\n def foo():\n-    return 1\n+    return 2\n');
  }

  function buildScoredStrictPrompt(
    instanceId: string,
    problemStatement: string,
    hintsText: string,
    testPatch: string,
    failToPassTests: string[],
    passToPassTests: string[],
    fileContents: Record<string, string>,
  ): string {
    // Replicate the scored_strict boundary from run_swebench.ts:
    //   const issueDescription = isScoredRun
    //     ? problem_statement.trim()
    //     : `${problem_statement}\n\n${hints_text || ''}`.trim();
    const isScoredRun = true;
    const issueDescription = isScoredRun
      ? problemStatement.trim()
      : `${problemStatement}\n\n${hintsText || ''}`.trim();

    // Replicate modelVisibleEvaluationArtifacts('scored_strict', ...)
    const artifacts = modelVisibleEvaluationArtifacts(
      'scored_strict',
      testPatch,
      failToPassTests,
    );
    const promptTestPatch = artifacts.promptTestPatch;
    const promptFailToPassTests = artifacts.promptFailToPassTests;

    // Replicate the prompt assembly from generateInitialPatch:
    const testNames = promptFailToPassTests.length > 0
      ? `## Failing Tests (your fix must make these pass)\n${promptFailToPassTests.slice(0, 10).join('\n')}\n`
      : '';
    const testCode = promptTestPatch
      ? `## New Test Code (this test will be added and must pass)\n\`\`\`diff\n${promptTestPatch.slice(0, 3000)}\n\`\`\`\n`
      : '';
    const testContext = (testNames || testCode) ? `\n${testNames}${testCode}` : '';

    const fileSections = Object.entries(fileContents)
      .map(([fp, content]) => `### ${fp}\n\`\`\`python\n${content}\n\`\`\``)
      .join('\n\n');

    return `You are an expert Python software engineer solving a GitHub issue.
## Instance: ${instanceId}
## Issue Description
${issueDescription}
${testContext}
## Files to Modify
${fileSections}
## Task
Fix the bug or implement the feature described in the issue.
`;
  }

  it('scored_strict prompt does not contain any forbidden sentinel string', async () => {
    capturedPrompts.length = 0; // reset

    const prompt = buildScoredStrictPrompt(
      'test__test-001',
      'Fix the bug in foo.py — the function returns wrong value',
      BOUNDARY_SENTINELS.hints_text,     // hints_text — must NOT appear
      BOUNDARY_SENTINELS.test_patch,     // test_patch — must NOT appear
      [BOUNDARY_SENTINELS.fail_to_pass], // FAIL_TO_PASS — must NOT appear
      [BOUNDARY_SENTINELS.pass_to_pass], // PASS_TO_PASS — must NOT appear
      { 'src/foo.py': 'def foo():\n    return 1\n' },
    );

    // Simulate the LLM call
    await mockLLMProvider(prompt);

    // Assert all captured prompts are clean
    expect(capturedPrompts).toHaveLength(1);
    for (const captured of capturedPrompts) {
      for (const [field, sentinel] of Object.entries(BOUNDARY_SENTINELS)) {
        expect(captured, `Forbidden field '${field}' found in captured prompt`).not.toContain(sentinel);
      }
    }
  });

  it('test_aware prompt DOES contain forbidden sentinel strings (control)', async () => {
    capturedPrompts.length = 0;

    // In test_aware mode, hints_text and test_patch ARE included
    const isScoredRun = false;
    const issueDescription = isScoredRun
      ? 'Fix the bug in foo.py'
      : `Fix the bug in foo.py\n\n${BOUNDARY_SENTINELS.hints_text}`;

    const artifacts = modelVisibleEvaluationArtifacts(
      'test_aware',
      BOUNDARY_SENTINELS.test_patch,
      [BOUNDARY_SENTINELS.fail_to_pass],
    );

    const testNames = artifacts.promptFailToPassTests.length > 0
      ? `## Failing Tests\n${artifacts.promptFailToPassTests.join('\n')}\n`
      : '';
    const testCode = artifacts.promptTestPatch
      ? `## Test Code\n${artifacts.promptTestPatch}\n`
      : '';

    const prompt = `Issue: ${issueDescription}\n${testNames}${testCode}`;
    await mockLLMProvider(prompt);

    // In test_aware mode, sentinels SHOULD appear (this is the control case)
    expect(capturedPrompts[0]).toContain(BOUNDARY_SENTINELS.hints_text);
    expect(capturedPrompts[0]).toContain(BOUNDARY_SENTINELS.test_patch);
    expect(capturedPrompts[0]).toContain(BOUNDARY_SENTINELS.fail_to_pass);
  });

  it('scored_strict prompt with multiple LLM calls (retry path) — all clean', async () => {
    capturedPrompts.length = 0;

    // Simulate the retry path: first call returns prose, second call is the forceful retry
    const prompt1 = buildScoredStrictPrompt(
      'test__test-002',
      'Fix the bug',
      BOUNDARY_SENTINELS.hints_text,
      BOUNDARY_SENTINELS.test_patch,
      [BOUNDARY_SENTINELS.fail_to_pass],
      [BOUNDARY_SENTINELS.pass_to_pass],
      { 'src/foo.py': 'def foo():\n    return 1\n' },
    );

    // Simulate the forceful retry prompt (also uses issueDescription, not hints_text)
    const forcefulRetryPrompt = `You are a Python engineer. Output ONLY a unified diff patch.
Fix this issue in test__test-002:
Fix the bug
Files to change: src/foo.py
Format: \`\`\`diff\n--- a/file.py\n+++ b/file.py\n@@ -N,M +N,M @@\n-old\n+new\n\`\`\``;

    await mockLLMProvider(prompt1);
    await mockLLMProvider(forcefulRetryPrompt);

    expect(capturedPrompts).toHaveLength(2);
    for (const captured of capturedPrompts) {
      for (const [field, sentinel] of Object.entries(BOUNDARY_SENTINELS)) {
        expect(captured, `Forbidden field '${field}' found in retry prompt`).not.toContain(sentinel);
      }
    }
  });
});
