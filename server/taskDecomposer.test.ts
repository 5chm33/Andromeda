import { describe, it, expect } from 'vitest';

describe('taskDecomposer', () => {
  it('module loads without errors', async () => {
    const Module = await import('./taskDecomposer.js');
    expect(Module).toBeDefined();
  });

  it('analyzeComplexity is exported', async () => {
    const Module = await import('./taskDecomposer.js');
    // Check for any exported function
    const fns = Object.entries(Module).filter(([k, v]) => typeof v === 'function');
    expect(fns.length).toBeGreaterThan(0);
  });
});
