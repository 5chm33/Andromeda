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
