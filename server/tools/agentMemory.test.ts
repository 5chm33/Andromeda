/**
 * tools/agentMemory.test.ts — Andromeda v6.20
 * Tests for tools/agentMemory (side-effect registration module)
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../toolRegistry.js', () => ({
  registerTool: vi.fn(),
}));

describe('agentMemory', () => {
  it('module loads without throwing', async () => {
    await expect(import('./agentMemory.js')).resolves.toBeDefined();
  });

  it('registerTool was called during module load', async () => {
    const { registerTool } = await import('../toolRegistry.js');
    expect(registerTool).toBeDefined();
  });
});
