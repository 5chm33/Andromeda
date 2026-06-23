import { describe, it, expect } from 'vitest';

describe('behavioral_tests', () => {
  it('module loads without errors', async () => {
    const Module = await import('./behavioral_tests.js');
    expect(Module).toBeDefined();
  });

  it('runBehavioralTests is exported and callable', async () => {
    const Module = await import('./behavioral_tests.js');
    expect(Module.runBehavioralTests).toBeDefined();
    expect(typeof Module.runBehavioralTests).toBe('function');
  });

  it('formatBehavioralTestResults is exported and callable', async () => {
    const Module = await import('./behavioral_tests.js');
    expect(Module.formatBehavioralTestResults).toBeDefined();
    expect(typeof Module.formatBehavioralTestResults).toBe('function');
  });

});