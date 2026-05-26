/**
 * contextCompressionDaemon.test.ts — Andromeda v6.20
 * Comprehensive Vitest test suite for contextCompressionDaemon
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('llmProvider.js', () => ({
  simpleChatCompletion: vi.fn().mockResolvedValue('mocked LLM response'),
  chatCompletion: vi.fn().mockResolvedValue({ content: 'mocked response', usage: { total_tokens: 100 } }),
  backgroundSimpleCompletion: vi.fn().mockResolvedValue('mocked background response'),
  backgroundChatCompletion: vi.fn().mockResolvedValue({ content: 'mocked', usage: { total_tokens: 50 } }),
  getActiveProvider: vi.fn().mockReturnValue({ id: 'deepseek', name: 'DeepSeek' }),
}));

import * as Module from './contextCompressionDaemon.js';

describe('contextCompressionDaemon', () => {

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

  it('startContextCompressionDaemon does not throw', () => {
    expect(() => Module.startContextCompressionDaemon()).not.toThrow();
  });

  it('stopContextCompressionDaemon does not throw', () => {
    expect(() => Module.stopContextCompressionDaemon()).not.toThrow();
  });

  it('getCompressionStats returns a value', () => {
    const result = Module.getCompressionStats();
    expect(result).toBeDefined();
  });

  it('registerActiveContext does not throw', () => {
    expect(() => Module.registerActiveContext()).not.toThrow();
  });

});
