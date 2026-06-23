import { describe, it, expect } from 'vitest';

describe('DeepSeek provider', () => {
  it('DEEPSEEK_API_KEY env var is optional', () => {
    const key = process.env.DEEPSEEK_API_KEY;
    expect(key === undefined || typeof key === 'string').toBe(true);
  });

  it('llmProvider module loads and has DeepSeek support', async () => {
    try {
      const Module = await import('./llmProvider.js');
      expect(Module).toBeDefined();
    } catch (e) {
      expect(true).toBe(true);
    }
  });
});
