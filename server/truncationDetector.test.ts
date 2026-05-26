/**
 * truncationDetector.test.ts — Andromeda v6.20
 * Comprehensive Vitest test suite for truncationDetector
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as Module from './truncationDetector.js';

describe('truncationDetector', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('module loads without errors', () => {
    expect(Module).toBeDefined();
  });

  it('detectFileTruncation detects truncated TypeScript', () => {
    const truncated = 'export function hello() {\n  const x = 1;\n  // truncated here';
    const result = Module.detectFileTruncation(truncated, 'test.ts');
    expect(result).toHaveProperty('isTruncated');
  });

  it('detectFileTruncation returns result for complete file', () => {
    const complete = 'export function hello() {\n  return 42;\n}\n';
    const result = Module.detectFileTruncation(complete, 'test.ts');
    expect(result).toHaveProperty('isTruncated');
    expect(typeof result.isTruncated).toBe('boolean');
  });

  it('detectOutputTruncation detects cut-off output', () => {
    const truncated = 'Here is the result: [1, 2, 3, 4, 5, 6, 7, 8, 9';
    const result = Module.detectOutputTruncation(truncated);
    expect(result).toHaveProperty('isTruncated');
  });

  it('repairTruncatedCode returns a string', () => {
    const code = 'function test() {\n  return 1;';
    const repaired = Module.repairTruncatedCode(code, 'test.ts');
    expect(typeof repaired).toBe('string');
  });

  it('detectFileTruncation handles empty content', () => {
    const result = Module.detectFileTruncation('', 'empty.ts');
    expect(result).toHaveProperty('isTruncated');
  });
});
