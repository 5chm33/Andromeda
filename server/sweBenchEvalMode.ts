/**
 * Centralizes the boundary between evaluator artifacts and model-visible
 * context.  A strict scored run is issue-and-repository only: evaluator test
 * patches and test identifiers cannot steer localization, retrieval, prompts,
 * or downstream pipeline calls.
 */
export type SWEBenchEvalMode = 'scored_strict' | 'test_aware';

export interface ModelVisibleEvaluationArtifacts {
  promptTestPatch: string;
  promptFailToPassTests: string[];
  allowTargetedTestContext: boolean;
  pipelineTestPatch?: string;
  pipelineFailToPassTests?: string[];
}

export function modelVisibleEvaluationArtifacts(
  mode: SWEBenchEvalMode,
  testPatch: string | undefined,
  failToPassTests: string[] | undefined,
): ModelVisibleEvaluationArtifacts {
  if (mode === 'scored_strict') {
    return {
      promptTestPatch: '',
      promptFailToPassTests: [],
      allowTargetedTestContext: false,
      pipelineTestPatch: undefined,
      pipelineFailToPassTests: undefined,
    };
  }

  const tests = failToPassTests ?? [];
  return {
    promptTestPatch: testPatch ?? '',
    promptFailToPassTests: tests,
    allowTargetedTestContext: tests.length > 0,
    pipelineTestPatch: testPatch,
    pipelineFailToPassTests: tests,
  };
}
