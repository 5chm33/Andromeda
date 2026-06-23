/**
 * tools/selfModifyTools.test.ts — Andromeda v6.20
 * Tests for tools/selfModifyTools
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../toolRegistry.js', () => ({
  registerTool: vi.fn(),
}));

describe('selfModifyTools', () => {
  it('module loads without throwing', async () => {
    await expect(import('./selfModifyTools.js')).resolves.toBeDefined();
  });

  it('registerSelfModifyTools is exported', async () => {
    const mod = await import('./selfModifyTools.js');
    expect(mod.registerSelfModifyTools).toBeDefined();
  });
});
