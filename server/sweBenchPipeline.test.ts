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
  extractFunctionLevelContext,
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

  it('returns empty string when no diff is found (prevents corrupted patches from error messages)', () => {
    const response = 'I cannot generate a patch for this.';
    const patch = extractPatchFromLLMResponse(response);
    expect(patch).toBe('');
  });

  it('returns empty string for error messages like Internet access disabled', () => {
    const response = 'Internet access disabled';
    const patch = extractPatchFromLLMResponse(response);
    expect(patch).toBe('');
  });
});

// ─── sweBenchConsensus tests ──────────────────────────────────────────────────

describe('parseTestCounts', () => {
  it('parses passed and failed counts from pytest output', () => {
    const output = '5 passed, 2 failed in 1.23s';
    const { passed, failed } = parseTestCounts(output, 'test__test-1');
    expect(passed).toBe(5);
    expect(failed).toBe(2);
  });

  it('handles output with only passed tests', () => {
    const output = '10 passed in 0.5s';
    const { passed, failed } = parseTestCounts(output, 'test__test-1');
    expect(passed).toBe(10);
    expect(failed).toBe(0);
  });

  it('handles output with only failed tests', () => {
    const output = '3 failed in 0.5s';
    const { passed, failed } = parseTestCounts(output, 'test__test-1');
    expect(passed).toBe(0);
    expect(failed).toBe(3);
  });

  it('returns zeros for unrecognized output', () => {
    const { passed, failed } = parseTestCounts('no test output here', 'test__test-1');
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

describe('extractFunctionLevelContext', () => {
  // Build a synthetic large Python file (>8000 chars) with multiple functions
  function makeLargeFile(): string {
    const header = `import os\nimport sys\nfrom typing import List\n\n`;
    const filler = `def unrelated_function_${Array.from({ length: 50 }, (_, i) => i).join('')}():\n    """Unrelated function."""\n    return None\n\n`;
    const targetFn = `def fix_the_bug(queryset, value):\n    """The function that needs fixing."""\n    if value is None:\n        raise ValueError("value cannot be None")\n    return queryset.filter(value=value)\n\n`;
    const testFn = `def test_fix_the_bug():\n    """Test for the bug fix."""\n    result = fix_the_bug([], 1)\n    assert result == []\n\n`;
    // Pad to > 8000 chars (need ~500 lines of padding)
    const padding = 'x = 1  # padding\n'.repeat(500);
    return header + filler + targetFn + testFn + padding;
  }

  it('returns full content for small files (<=8000 chars)', () => {
    const smallContent = 'def foo():\n    return 1\n';
    const result = extractFunctionLevelContext('foo.py', smallContent, '', []);
    expect(result).toBe(smallContent);
  });

  it('extracts functions mentioned in traceback for large files', () => {
    // buildSmartContext threshold is 10000 chars; pad to exceed it
    const content = makeLargeFile() + 'x = 1  # extra padding\n'.repeat(100);
    expect(content.length).toBeGreaterThan(10000);

    const traceback = `
Traceback (most recent call last):
  File "tests/test_query.py", line 42, in test_fix_the_bug
    result = fix_the_bug([], None)
  File "query.py", line 15, in fix_the_bug
    raise ValueError("value cannot be None")
ValueError: value cannot be None
`;

    const result = extractFunctionLevelContext('query.py', content, traceback, []);
    // Should include the target function
    expect(result).toContain('fix_the_bug');
    // Should include imports
    expect(result).toContain('import os');
    // Should be much smaller than the original
    expect(result.length).toBeLessThan(content.length);
  });

  it('includes imports and class headers in function-level view', () => {
    const content = makeLargeFile();
    const traceback = 'in fix_the_bug\nValueError: something';
    const result = extractFunctionLevelContext('query.py', content, traceback, []);
    expect(result).toContain('import os');
    expect(result).toContain('import sys');
  });

  it('falls back to skeleton context when no functions match traceback', () => {
    const content = makeLargeFile();
    const traceback = 'in completely_nonexistent_function\nError: something';
    const result = extractFunctionLevelContext('query.py', content, traceback, []);
    // Should still return something (skeleton fallback)
    expect(result.length).toBeGreaterThan(0);
    expect(typeof result).toBe('string');
  });

  it('uses keywords to find relevant functions when traceback is empty', () => {
    const content = makeLargeFile();
    const result = extractFunctionLevelContext('query.py', content, '', ['fix_the_bug']);
    expect(result).toContain('fix_the_bug');
  });

  it('includes the function-level view header comment', () => {
    // Must exceed 10000 chars to trigger buildSmartContext header generation
    const content = makeLargeFile() + 'x = 1  # extra padding\n'.repeat(100);
    expect(content.length).toBeGreaterThan(10000);
    const traceback = 'in fix_the_bug\nError';
    const result = extractFunctionLevelContext('query.py', content, traceback, []);
    // buildSmartContext now uses 'call-chain expanded view' or 'skeleton view'
    expect(result).toMatch(/call-chain expanded view|skeleton view/);
    expect(result).toContain('query.py');
  });
});

describe('buildAgentPrompt', () => {
  it('includes the instance ID and agent name', () => {
    const prompt = buildAgentPrompt(
      'django__django-12308',
      'Fix the bug in QuerySet.filter()',
      { 'filter.py': 'def filter(self): pass' },
      { name: 'conservative', temperature: 0.0, llmProvider: async () => '' }
    );
    expect(prompt).toContain('django__django-12308');
    expect(prompt).toContain('conservative');
  });

  it('includes the issue description and relevant code', () => {
    const prompt = buildAgentPrompt(
      'test__test-1',
      'The filter method is broken',
      { 'filter.py': 'def filter(): return None' },
      { name: 'creative', temperature: 0.4, llmProvider: async () => '' }
    );
    expect(prompt).toContain('The filter method is broken');
    expect(prompt).toContain('def filter(): return None');
  });
});
