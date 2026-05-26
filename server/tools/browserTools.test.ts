/**
 * tools/browserTools.test.ts — Andromeda v6.20
 * Tests for tools/browserTools
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../toolRegistry.js', () => ({
  registerTool: vi.fn(),
}));

describe('browserTools', () => {
  it('module loads without throwing', async () => {
    await expect(import('./browserTools.js')).resolves.toBeDefined();
  });

  it('browserToolDefinitions is exported', async () => {
    const mod = await import('./browserTools.js');
    expect(mod.browserToolDefinitions).toBeDefined();
  });
});
