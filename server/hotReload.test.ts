import { describe, it, expect } from 'vitest';

describe('hotReload', () => {
  it('module loads without errors', async () => {
    const Module = await import('./hotReload.js');
    expect(Module).toBeDefined();
  });

  it('hotReloadModule is a function', async () => {
    const { hotReloadModule } = await import('./hotReload.js');
    expect(typeof hotReloadModule).toBe('function');
  });

  it('registerReloadableModule does not throw if available', async () => {
    const Module = await import('./hotReload.js');
    if (typeof Module.registerReloadableModule === 'function') {
      expect(() => Module.registerReloadableModule({ name: 'test', path: './test.js', version: '1.0.0' })).not.toThrow();
    } else {
      expect(Module).toBeDefined();
    }
  });
});
