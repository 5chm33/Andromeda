import { describe, it, expect } from 'vitest';

describe('smoke_test_runner', () => {
  it('module loads without errors', async () => {
    const Module = await import('./smoke_test_runner.js');
    expect(Module).toBeDefined();
  });

  it('runSmokeTests is exported and callable', async () => {
    const Module = await import('./smoke_test_runner.js');
    expect(Module.runSmokeTests).toBeDefined();
    expect(typeof Module.runSmokeTests).toBe('function');
  });

});