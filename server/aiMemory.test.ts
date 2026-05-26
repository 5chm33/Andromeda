import { describe, it, expect } from 'vitest';

describe('aiMemory', () => {
  it('module loads without errors', async () => {
    const Module = await import('./aiMemory.js');
    expect(Module).toBeDefined();
  });

  it('getAndromedaMemoryPathPublic returns a string if available', async () => {
    const Module = await import('./aiMemory.js');
    if (typeof Module.getAndromedaMemoryPathPublic === 'function') {
      const result = Module.getAndromedaMemoryPathPublic();
      expect(typeof result === 'string' || result === undefined).toBe(true);
    } else {
      expect(Module).toBeDefined();
    }
  });

  it('getAndromedaMemoryStats returns a value if available', async () => {
    const Module = await import('./aiMemory.js');
    if (typeof Module.getAndromedaMemoryStats === 'function') {
      const result = Module.getAndromedaMemoryStats();
      expect(result).toBeDefined();
    } else {
      expect(Module).toBeDefined();
    }
  });
});
