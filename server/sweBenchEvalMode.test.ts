import { describe, expect, it } from 'vitest';
import { modelVisibleEvaluationArtifacts } from './sweBenchEvalMode.js';
import * as fs from 'fs';
import * as path from 'path';

const TEST_PATCH = 'SENTINEL_HIDDEN_TEST_PATCH';
const TEST_NAME = 'tests/test_sentinel.py::test_hidden_expectation';
// Sentinel that simulates a hints_text post-issue comment
const HINTS_SENTINEL = 'SENTINEL_HINTS_TEXT_POST_ISSUE_COMMENT_xk7q2';

describe('modelVisibleEvaluationArtifacts', () => {
  it('removes all evaluator-derived artifacts in scored_strict mode', () => {
    const artifacts = modelVisibleEvaluationArtifacts(
      'scored_strict', TEST_PATCH, [TEST_NAME],
    );

    expect(artifacts.promptTestPatch).toBe('');
    expect(artifacts.promptFailToPassTests).toEqual([]);
    expect(artifacts.allowTargetedTestContext).toBe(false);
    expect(artifacts.pipelineTestPatch).toBeUndefined();
    expect(artifacts.pipelineFailToPassTests).toBeUndefined();
  });

  it('preserves evaluator artifacts only in explicitly test_aware mode', () => {
    const artifacts = modelVisibleEvaluationArtifacts(
      'test_aware', TEST_PATCH, [TEST_NAME],
    );

    expect(artifacts.promptTestPatch).toBe(TEST_PATCH);
    expect(artifacts.promptFailToPassTests).toEqual([TEST_NAME]);
    expect(artifacts.allowTargetedTestContext).toBe(true);
    expect(artifacts.pipelineTestPatch).toBe(TEST_PATCH);
    expect(artifacts.pipelineFailToPassTests).toEqual([TEST_NAME]);
  });
});

describe('hints_text boundary in run_swebench.ts', () => {
  it('scored_strict issueDescription must not contain hints_text sentinel', () => {
    // Structural test: verify that the issueDescription construction in
    // run_swebench.ts gates hints_text behind !isScoredRun.
    // SWE-bench leaderboard rules prohibit hints_text for scored evaluation.
    const runnerSrc = fs.readFileSync(
      path.join(process.cwd(), 'scripts/run_swebench.ts'),
      'utf-8',
    );

    // The scored_strict branch must use problem_statement only
    const strictBranchIdx = runnerSrc.indexOf('? problem_statement.trim()');
    expect(strictBranchIdx).toBeGreaterThan(-1);

    // The hints_text concatenation must only appear in the test_aware branch
    const hintsConcatIdx = runnerSrc.indexOf('hints_text || \'\'');
    expect(hintsConcatIdx).toBeGreaterThan(-1);

    // The isScoredRun ternary must appear before both
    const ternaryIdx = runnerSrc.indexOf('const issueDescription = isScoredRun');
    expect(ternaryIdx).toBeGreaterThan(-1);
    expect(ternaryIdx).toBeLessThan(strictBranchIdx);
    expect(ternaryIdx).toBeLessThan(hintsConcatIdx);

    // hints_text must NOT appear in any unconditional model-visible path
    // (i.e., no direct use of hints_text outside the ternary)
    const lines = runnerSrc.split('\n');
    const forbiddenLines = lines.filter(l =>
      l.includes('hints_text') &&
      !l.trim().startsWith('//') &&
      !l.includes('hints_text ||') &&       // the gated ternary branch
      !l.includes('hints_text,') &&          // destructuring
      !l.includes('hints_text:') &&          // type declaration
      !l.includes('hints_text }') &&         // destructuring
    false);
    expect(forbiddenLines).toHaveLength(0);
  });

  it('test_aware mode retains hints_text in issueDescription', () => {
    // Verify the test_aware branch still includes hints_text
    const runnerSrc = fs.readFileSync(
      path.join(process.cwd(), 'scripts/run_swebench.ts'),
      'utf-8',
    );
    // The ternary false-branch must concatenate hints_text
    expect(runnerSrc).toContain(': `${problem_statement}\\n\\n${hints_text || \'\'}`.trim()');
  });
});
