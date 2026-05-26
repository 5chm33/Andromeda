import { describe, it, expect, vi } from 'vitest';

vi.mock('../llmProvider.js', () => ({
  setActiveProvider: vi.fn(),
  getActiveProvider: vi.fn().mockReturnValue({ id: 'deepseek', name: 'DeepSeek' }),
  chatCompletion: vi.fn().mockResolvedValue({ content: 'test' }),
  backgroundChatCompletion: vi.fn().mockResolvedValue({ content: 'test' }),
}));

describe('agentRoutes', () => {
  it('agentRoutes module loads without errors', async () => {
    const Module = await import('./agentRoutes.js');
    expect(Module).toBeDefined();
  });

  it('registerAgentRoutes is defined', async () => {
    const Module = await import('./agentRoutes.js');
    expect(typeof Module.registerAgentRoutes).toBe('function');
  });
});
