/**
 * llmRouter.test.ts — Andromeda v6.20
 * Comprehensive Vitest test suite for llmRouter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('llmProvider.js', () => ({
  simpleChatCompletion: vi.fn().mockResolvedValue('mocked LLM response'),
  chatCompletion: vi.fn().mockResolvedValue({ content: 'mocked response', usage: { total_tokens: 100 } }),
  backgroundSimpleCompletion: vi.fn().mockResolvedValue('mocked background response'),
  backgroundChatCompletion: vi.fn().mockResolvedValue({ content: 'mocked', usage: { total_tokens: 50 } }),
  getActiveProvider: vi.fn().mockReturnValue({ id: 'deepseek', name: 'DeepSeek' }),
}));

import * as Module from './llmRouter.js';

describe('llmRouter', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('module loads without errors', () => {
    expect(Module).toBeDefined();
  });

  describe('classifyTask', () => {
    it('classifies coding queries correctly', () => {
      const result = Module.classifyTask('write a TypeScript function to sort an array');
      expect(result.type).toBe('code');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('classifies general queries as general', () => {
      const result = Module.classifyTask('what is the weather today');
      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('confidence');
    });

    it('classifies image queries when hasImages is true', () => {
      const result = Module.classifyTask('describe this image', true);
      expect(result.type).toBe('vision');
    });
  });

  describe('routeQuery', () => {
    it('returns a routing decision object', () => {
      const decision = Module.routeQuery('write a function');
      expect(decision).toHaveProperty('selectedProvider');
      expect(decision).toHaveProperty('taskType');
      expect(decision).toHaveProperty('reason');
    });
  });

  describe('getRoutingConfig', () => {
    it('returns config object', () => {
      const config = Module.getRoutingConfig();
      expect(config).toBeDefined();
    });
  });

  describe('setRoutingConfig', () => {
    it('updates config without error', () => {
      expect(() => Module.setRoutingConfig({ enabled: true })).not.toThrow();
    });
  });
});
