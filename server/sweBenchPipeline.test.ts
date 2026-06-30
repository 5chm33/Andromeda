/**
 * sweBenchPipeline.test.ts — Unit tests for the SOTA SWE-bench pipeline modules
 *
 * Tests cover:
 * - Traceback extraction and prompt building
 * - Patch extraction from LLM responses
 * - Consensus judge selection logic
 * - Test count parsing
 * - Infrastructure disk space utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  extractTracebackSummary,
  buildRevisionPrompt,
  extractPatchFromLLMResponse,
  MAX_ATTEMPTS,
} from './sweBenchTracebackLoop.js';

import {
  selectWinningPatch,
  parseTestCounts,
  buildAgentPrompt,
  CandidatePatch,
} from './sweBenchConsensus.js';

// ─── sweBenchTracebackLoop tests ──────────────────────────────────────────────

describe('extractTracebackSummary', () => {
  it('extracts the relevant failure section from pytest output', () => {
    const output = `
collecting ... collected 10 items

test_models.py::TestQuery::test_basic PASSED
test_models.py::TestQuery::test_filter FAILED

FAILED test_models.py::TestQuery::test_filter - AssertionError: Expected 3, got 2

short test summary info
FAILED test_models.py::TestQuery::test_filter
1 failed, 1 passed in 0.45s
`;
    const summary = extractTracebackSummary(output);
    expect(summary).toContain('FAILED');
    expect(summary).toContain('AssertionError');
  });

  it('returns the last N lines when no failure marker is found', () => {
    const output = 'line1\nline2\nline3\nall passed';
    const summary = extractTracebackSummary(output);
    expect(summary).toContain('all passed');
  });

  it('handles empty output gracefully', () => {
    const summary = extractTracebackSummary('');
    expect(typeof summary).toBe('string');
  });
});

describe('buildRevisionPrompt', () => {
  it('includes the instance ID and attempt number', () => {
    const prompt = buildRevisionPrompt(
      'django__django-12308',
      '--- a/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n-old\n+new',
      'AssertionError: Expected 3, got 2',
      2
    );
    expect(prompt).toContain('django__django-12308');
    expect(prompt).toContain('Attempt: 2');
    expect(prompt).toContain('AssertionError');
  });

  it('includes the previous patch in the prompt', () => {
    const patch = '--- a/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n-old\n+new';
    const prompt = buildRevisionPrompt('test__test-1', patch, 'error', 1);
    expect(prompt).toContain(patch);
  });

  it('references MAX_ATTEMPTS in the prompt', () => {
    const prompt = buildRevisionPrompt('test__test-1', 'patch', 'error', 3);
    expect(prompt).toContain(`${MAX_ATTEMPTS}`);
  });
});

describe('extractPatchFromLLMResponse', () => {
  it('extracts patch from a markdown diff block', () => {
    const response = `Here is the fix:\n\`\`\`diff\n--- a/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n-old\n+new\n\`\`\`\nDone.`;
    const patch = extractPatchFromLLMResponse(response);
    expect(patch).toContain('--- a/foo.py');
    expect(patch).not.toContain('Here is the fix');
  });

  it('extracts a raw diff without markdown fences', () => {
    const response = `--- a/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n-old\n+new`;
    const patch = extractPatchFromLLMResponse(response);
    expect(patch).toContain('--- a/foo.py');
  });

  it('returns the full response as fallback when no diff is found', () => {
    const response = 'I cannot generate a patch for this.';
    const patch = extractPatchFromLLMResponse(response);
    expect(patch).toBe(response.trim());
  });
});

// ─── sweBenchConsensus tests ──────────────────────────────────────────────────

describe('parseTestCounts', () => {
  it('parses passed and failed counts from pytest output', () => {
    const output = '5 passed, 2 failed in 1.23s';
    const { passed, failed } = parseTestCounts(output);
    expect(passed).toBe(5);
    expect(failed).toBe(2);
  });

  it('handles output with only passed tests', () => {
    const output = '10 passed in 0.5s';
    const { passed, failed } = parseTestCounts(output);
    expect(passed).toBe(10);
    expect(failed).toBe(0);
  });

  it('handles output with only failed tests', () => {
    const output = '3 failed in 0.5s';
    const { passed, failed } = parseTestCounts(output);
    expect(passed).toBe(0);
    expect(failed).toBe(3);
  });

  it('returns zeros for unrecognized output', () => {
    const { passed, failed } = parseTestCounts('no test output here');
    expect(passed).toBe(0);
    expect(failed).toBe(0);
  });
});

describe('selectWinningPatch', () => {
  const makePatch = (overrides: Partial<CandidatePatch>): CandidatePatch => ({
    agentName: 'test',
    patch: 'default patch',
    testsPassed: false,
    testsPassedCount: 0,
    testsFailedCount: 5,
    testOutput: '',
    generationDurationMs: 100,
    evaluationDurationMs: 200,
    ...overrides,
  });

  it('selects a fully passing patch over partial ones', () => {
    const candidates: CandidatePatch[] = [
      makePatch({ agentName: 'a', patch: 'long patch text here', testsPassed: false, testsPassedCount: 3 }),
      makePatch({ agentName: 'b', patch: 'short pass', testsPassed: true, testsPassedCount: 5 }),
    ];
    const { winner, reason } = selectWinningPatch(candidates);
    expect(winner.agentName).toBe('b');
    expect(reason).toContain('fully-passing');
  });

  it('selects the shortest fully passing patch when multiple pass', () => {
    const candidates: CandidatePatch[] = [
      makePatch({ agentName: 'a', patch: 'a very long patch', testsPassed: true, testsPassedCount: 5 }),
      makePatch({ agentName: 'b', patch: 'short', testsPassed: true, testsPassedCount: 5 }),
    ];
    const { winner } = selectWinningPatch(candidates);
    expect(winner.agentName).toBe('b');
  });

  it('selects the patch with most passing tests when none fully pass', () => {
    const candidates: CandidatePatch[] = [
      makePatch({ agentName: 'a', patch: 'patch a', testsPassed: false, testsPassedCount: 2 }),
      makePatch({ agentName: 'b', patch: 'patch b', testsPassed: false, testsPassedCount: 4 }),
    ];
    const { winner, reason } = selectWinningPatch(candidates);
    expect(winner.agentName).toBe('b');
    expect(reason).toContain('partial');
  });

  it('returns the shortest patch when all candidates fail', () => {
    const candidates: CandidatePatch[] = [
      makePatch({ agentName: 'a', patch: 'long patch that fails', testsPassedCount: 0 }),
      makePatch({ agentName: 'b', patch: 'short', testsPassedCount: 0 }),
    ];
    const { winner } = selectWinningPatch(candidates);
    expect(winner.agentName).toBe('b');
  });
});

describe('buildAgentPrompt', () => {
  it('includes the instance ID and agent name', () => {
    const prompt = buildAgentPrompt(
      'django__django-12308',
      'Fix the bug in QuerySet.filter()',
      'def filter(self): pass',
      { name: 'conservative', temperature: 0.0, llmProvider: async () => '' }
    );
    expect(prompt).toContain('django__django-12308');
    expect(prompt).toContain('conservative');
  });

  it('includes the issue description and relevant code', () => {
    const prompt = buildAgentPrompt(
      'test__test-1',
      'The filter method is broken',
      'def filter(): return None',
      { name: 'creative', temperature: 0.4, llmProvider: async () => '' }
    );
    expect(prompt).toContain('The filter method is broken');
    expect(prompt).toContain('def filter(): return None');
  });
});
