/**
 * evalDrivenTargeting.test.ts — Andromeda v9.6.0
 * Tests for eval-driven RSI targeting
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue('{}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('./llmProvider.js', () => ({
  simpleChatCompletion: vi.fn().mockResolvedValue('mocked response'),
  backgroundSimpleCompletion: vi.fn().mockResolvedValue('mocked response'),
}));

describe('evalDrivenTargeting', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('module loads without error', async () => {
    const mod = await import('./evalDrivenTargeting.js');
    expect(mod).toBeDefined();
  });

  it('exports getEvalDrivenTarget function', async () => {
    const mod = await import('./evalDrivenTargeting.js');
    expect(typeof mod.getEvalDrivenTarget).toBe('function');
  });

  it('exports recordEvalDrivenProposal function', async () => {
    const mod = await import('./evalDrivenTargeting.js');
    expect(typeof mod.recordEvalDrivenProposal).toBe('function');
  });

  it('getEvalDrivenTarget returns null when no history exists', async () => {
    const mod = await import('./evalDrivenTargeting.js');
    const result = await mod.getEvalDrivenTarget();
    expect(result).toBeNull();
  });

  it('recordEvalDrivenProposal does not throw', async () => {
    const mod = await import('./evalDrivenTargeting.js');
    expect(() => mod.recordEvalDrivenProposal('prop_001', 'reasoning', 'ai.ts', 0.6)).not.toThrow();
  });
});
