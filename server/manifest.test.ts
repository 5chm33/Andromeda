/**
 * manifest.test.ts — Andromeda v6.20
 * Comprehensive Vitest test suite for manifest
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('llmProvider.js', () => ({
  simpleChatCompletion: vi.fn().mockResolvedValue('mocked LLM response'),
  chatCompletion: vi.fn().mockResolvedValue({ content: 'mocked response', usage: { total_tokens: 100 } }),
  backgroundSimpleCompletion: vi.fn().mockResolvedValue('mocked background response'),
  backgroundChatCompletion: vi.fn().mockResolvedValue({ content: 'mocked', usage: { total_tokens: 50 } }),
  getActiveProvider: vi.fn().mockReturnValue({ id: 'deepseek', name: 'DeepSeek' }),
}));

vi.mock('memory.js', () => ({
  getMemory: vi.fn().mockReturnValue({}),
  setMemory: vi.fn(),
  getAllMemories: vi.fn().mockReturnValue([]),
  searchMemory: vi.fn().mockReturnValue([]),
}));

import * as Module from './manifest.js';

describe('manifest', () => {

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

  it('getManifestPrompt returns a value', () => {
    const result = Module.getManifestPrompt();
    expect(result).toBeDefined();
  });

  it('getFullManifest returns a value', () => {
    const result = Module.getFullManifest();
    expect(result).toBeDefined();
  });

});
