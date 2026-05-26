import { describe, it, expect } from 'vitest';

describe('dependency_upgrader', () => {
  it('module loads without errors', async () => {
    const Module = await import('./dependency_upgrader.js');
    expect(Module).toBeDefined();
  });

  it('scanOutdatedPackages is exported and callable', async () => {
    const Module = await import('./dependency_upgrader.js');
    expect(Module.scanOutdatedPackages).toBeDefined();
    expect(typeof Module.scanOutdatedPackages).toBe('function');
  });

  it('upgradePackage is exported and callable', async () => {
    const Module = await import('./dependency_upgrader.js');
    expect(Module.upgradePackage).toBeDefined();
    expect(typeof Module.upgradePackage).toBe('function');
  });

});