import { describe, expect, it } from 'vitest';
import { modelVisibleEvaluationArtifacts } from './sweBenchEvalMode.js';

const TEST_PATCH = 'SENTINEL_HIDDEN_TEST_PATCH';
const TEST_NAME = 'tests/test_sentinel.py::test_hidden_expectation';

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
