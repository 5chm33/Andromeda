import { describe, it, expect } from 'vitest';

describe('compilation_pipeline', () => {
  it('module loads without errors', async () => {
    const Module = await import('./compilation_pipeline.js');
    expect(Module).toBeDefined();
  });

  it('runSelfCompilation is exported and callable', async () => {
    const Module = await import('./compilation_pipeline.js');
    expect(Module.runSelfCompilation).toBeDefined();
    expect(typeof Module.runSelfCompilation).toBe('function');
  });

  it('formatBuildResults is exported and callable', async () => {
    const Module = await import('./compilation_pipeline.js');
    expect(Module.formatBuildResults).toBeDefined();
    expect(typeof Module.formatBuildResults).toBe('function');
  });

});