/**
 * taskPlanner.test.ts — Andromeda v6.20
 * Comprehensive Vitest test suite for taskPlanner
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('llmProvider.js', () => ({
  simpleChatCompletion: vi.fn().mockResolvedValue('mocked LLM response'),
  chatCompletion: vi.fn().mockResolvedValue({ content: 'mocked response', usage: { total_tokens: 100 } }),
  backgroundSimpleCompletion: vi.fn().mockResolvedValue('mocked background response'),
  backgroundChatCompletion: vi.fn().mockResolvedValue({ content: 'mocked', usage: { total_tokens: 50 } }),
  getActiveProvider: vi.fn().mockReturnValue({ id: 'deepseek', name: 'DeepSeek' }),
}));

import * as Module from './taskPlanner.js';

describe('taskPlanner', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('module loads without errors', () => {
    expect(Module).toBeDefined();
  });

  it('exports are defined', () => {
    expect(Module).toBeDefined();
    expect(typeof Module).toBe('object');
  });

  it('getActivePlan returns undefined for non-existent plan', () => {
    const result = Module.getActivePlan('nonexistent-id');
    expect(result).toBeUndefined();
  });

  it('getAllActivePlans returns a value', () => {
    const result = Module.getAllActivePlans();
    expect(result).toBeDefined();
  });

  it('getAllActivePlans returns an array', () => {
    const result = Module.getAllActivePlans();
    expect(Array.isArray(result)).toBe(true);
  });

});
