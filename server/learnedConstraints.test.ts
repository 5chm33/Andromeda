/**
 * learnedConstraints.test.ts — Andromeda v9.6.0
 * Tests for the learned constraints module
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue('{"constraints":[]}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('{"constraints":[]}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

describe('learnedConstraints', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('module loads without error', async () => {
    const mod = await import('./learnedConstraints.js');
    expect(mod).toBeDefined();
  });

  it('exports recordRejection function', async () => {
    const mod = await import('./learnedConstraints.js');
    expect(typeof mod.recordRejection).toBe('function');
  });

  it('exports getLearnedConstraints function', async () => {
    const mod = await import('./learnedConstraints.js');
    expect(typeof mod.getLearnedConstraints).toBe('function');
  });

  it('recordRejection does not throw', async () => {
    const mod = await import('./learnedConstraints.js');
    expect(() => mod.recordRejection('eval()', 'Forbidden pattern: eval usage')).not.toThrow();
  });

  it('getLearnedConstraints returns an array', async () => {
    const mod = await import('./learnedConstraints.js');
    const constraints = mod.getLearnedConstraints();
    expect(Array.isArray(constraints)).toBe(true);
  });
});
