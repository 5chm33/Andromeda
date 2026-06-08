/**
 * capabilityBootstrapper.test.ts — Andromeda v9.6.0
 * Tests for capability gap detection and bootstrapping
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue('{"gaps":[],"bootstrapped":[]}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    mkdtempSync: vi.fn().mockReturnValue('/tmp/test-bootstrap'),
    unlinkSync: vi.fn(),
    rmdirSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('{"gaps":[],"bootstrapped":[]}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  mkdtempSync: vi.fn().mockReturnValue('/tmp/test-bootstrap'),
  unlinkSync: vi.fn(),
  rmdirSync: vi.fn(),
}));

vi.mock('./llmProvider.js', () => ({
  simpleChatCompletion: vi.fn().mockResolvedValue(`
// Generated tool
export function newCapability(input: string): string {
  return input.toUpperCase();
}
`),
  backgroundSimpleCompletion: vi.fn().mockResolvedValue('mocked response'),
}));

describe('capabilityBootstrapper', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('module loads without error', async () => {
    const mod = await import('./capabilityBootstrapper.js');
    expect(mod).toBeDefined();
  });

  it('exports registerCapabilityGap function', async () => {
    const mod = await import('./capabilityBootstrapper.js');
    expect(typeof mod.registerCapabilityGap).toBe('function');
  });

  it('exports runBootstrapCycle function', async () => {
    const mod = await import('./capabilityBootstrapper.js');
    expect(typeof mod.runBootstrapCycle).toBe('function');
  });

  it('exports startCapabilityBootstrapper function', async () => {
    const mod = await import('./capabilityBootstrapper.js');
    expect(typeof mod.startCapabilityBootstrapper).toBe('function');
  });

  it('registerCapabilityGap does not throw', async () => {
    const mod = await import('./capabilityBootstrapper.js');
    expect(() => mod.registerCapabilityGap(
      'image_generation', 'Cannot generate images', 'tool_failure', 'high'
    )).not.toThrow();
  });

  it('runBootstrapCycle returns a result', async () => {
    const mod = await import('./capabilityBootstrapper.js');
    const result = await mod.runBootstrapCycle();
    expect(result).toBeDefined();
    expect(typeof result.processed).toBe('number');
    expect(typeof result.bootstrapped).toBe('number');
  });
});
