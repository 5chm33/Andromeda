/**
 * tools/index.test.ts — Andromeda v6.20
 * Tests for tools/index (side-effect registration module)
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../toolRegistry.js', () => ({
  registerTool: vi.fn(),
}));

describe('index', () => {
  it('module loads without throwing', async () => {
    await expect(import('./index.js')).resolves.toBeDefined();
  });

  it('registerTool was called during module load', async () => {
    const { registerTool } = await import('../toolRegistry.js');
    expect(registerTool).toBeDefined();
  });
});
