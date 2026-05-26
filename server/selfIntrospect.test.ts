import { describe, it, expect } from 'vitest';

describe('selfIntrospect', () => {
  it('module loads without errors', async () => {
    const Module = await import('./selfIntrospect.js');
    expect(Module).toBeDefined();
  });

  it('introspectSelf is a function', async () => {
    const { introspectSelf } = await import('./selfIntrospect.js');
    expect(typeof introspectSelf).toBe('function');
  });

  it('getQuickStats returns an object if available', async () => {
    const Module = await import('./selfIntrospect.js');
    if (typeof Module.getQuickStats === 'function') {
      const stats = Module.getQuickStats();
      expect(typeof stats).toBe('object');
    } else {
      expect(Module).toBeDefined();
    }
  });

  it('initSelfIntrospect does not throw if available', async () => {
    const Module = await import('./selfIntrospect.js');
    if (typeof Module.initSelfIntrospect === 'function') {
      expect(() => Module.initSelfIntrospect()).not.toThrow();
    } else {
      expect(Module).toBeDefined();
    }
  });
});
