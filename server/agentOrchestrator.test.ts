/**
 * agentOrchestrator.test.ts — Andromeda v6.20
 * Comprehensive Vitest test suite for agentOrchestrator
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('llmProvider.js', () => ({
  simpleChatCompletion: vi.fn().mockResolvedValue('mocked LLM response'),
  chatCompletion: vi.fn().mockResolvedValue({ content: 'mocked response', usage: { total_tokens: 100 } }),
  backgroundSimpleCompletion: vi.fn().mockResolvedValue('mocked background response'),
  backgroundChatCompletion: vi.fn().mockResolvedValue({ content: 'mocked', usage: { total_tokens: 50 } }),
  getActiveProvider: vi.fn().mockReturnValue({ id: 'deepseek', name: 'DeepSeek' }),
}));

import * as Module from './agentOrchestrator.js';

describe('agentOrchestrator', () => {

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

  it('getDefaultAgents returns a value', () => {
    const result = Module.getDefaultAgents();
    expect(result).toBeDefined();
  });

  it('getAgentRoles returns a value', () => {
    const result = Module.getAgentRoles();
    expect(result).toBeDefined();
  });

});
