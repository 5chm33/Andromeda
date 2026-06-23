/**
 * tools/dockerSandbox.test.ts — Andromeda v6.20
 * Tests for tools/dockerSandbox
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../toolRegistry.js', () => ({
  registerTool: vi.fn(),
}));

describe('dockerSandbox', () => {
  it('module loads without throwing', async () => {
    await expect(import('./dockerSandbox.js')).resolves.toBeDefined();
  });

  it('checkDockerAvailability is exported', async () => {
    const mod = await import('./dockerSandbox.js');
    expect(mod.checkDockerAvailability).toBeDefined();
  });
  it('cleanupAllSessions is exported', async () => {
    const mod = await import('./dockerSandbox.js');
    expect(mod.cleanupAllSessions).toBeDefined();
  });
});
