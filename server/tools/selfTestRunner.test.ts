/**
 * tools/selfTestRunner.test.ts — Andromeda v6.20
 * Tests for tools/selfTestRunner
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../toolRegistry.js', () => ({
  registerTool: vi.fn(),
}));

describe('selfTestRunner', () => {
  it('module loads without throwing', async () => {
    await expect(import('./selfTestRunner.js')).resolves.toBeDefined();
  });

  it('runAllTests is exported', async () => {
    const mod = await import('./selfTestRunner.js');
    expect(mod.runAllTests).toBeDefined();
  });
  it('runTypeCheck is exported', async () => {
    const mod = await import('./selfTestRunner.js');
    expect(mod.runTypeCheck).toBeDefined();
  });
  it('selfHeal is exported', async () => {
    const mod = await import('./selfTestRunner.js');
    expect(mod.selfHeal).toBeDefined();
  });
  it('registerSelfTestTools is exported', async () => {
    const mod = await import('./selfTestRunner.js');
    expect(mod.registerSelfTestTools).toBeDefined();
  });
});
