/**
 * tokenBudgetManager.test.ts — Andromeda v6.20
 * Comprehensive Vitest test suite for tokenBudgetManager
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as Module from './tokenBudgetManager.js';

describe('tokenBudgetManager', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('module loads without errors', () => {
    expect(Module).toBeDefined();
  });

  it('estimateTokenCount returns positive number', () => {
    const count = Module.estimateTokenCount('hello world this is a test');
    expect(count).toBeGreaterThan(0);
  });

  it('estimateTokenCount returns 0 for empty string', () => {
    const count = Module.estimateTokenCount('');
    expect(count).toBe(0);
  });

  it('estimateCodeTokens returns positive for code', () => {
    const count = Module.estimateCodeTokens('function hello() { return 42; }');
    expect(count).toBeGreaterThan(0);
  });

  it('getBudget returns budget object for session', () => {
    const budget = Module.getBudget('test-session-1');
    expect(budget).toBeDefined();
  });

  it('allocateTokens returns allocation result', () => {
    const result = Module.allocateTokens('test-session-2', 'system', 1000);
    expect(result).toHaveProperty('allocated');
  });

  it('recordUsage does not throw', () => {
    expect(() => Module.recordUsage('test-session-3', 100, 200)).not.toThrow();
  });

  it('canFitResponse returns object with fits property', () => {
    const result = Module.canFitResponse('test-session-4', 500);
    expect(result).toHaveProperty('canFit');
  });
});
