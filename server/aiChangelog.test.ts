/**
 * aiChangelog.test.ts — Andromeda v9.6.0
 * Tests for the AI self-improvement changelog
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue(''),
    writeFileSync: vi.fn(),
    appendFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue(''),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path');
  return { ...actual, default: actual };
});

describe('aiChangelog', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('module loads without error', async () => {
    const mod = await import('./aiChangelog.js');
    expect(mod).toBeDefined();
  });

  it('exports appendChangelogEntry function', async () => {
    const mod = await import('./aiChangelog.js');
    expect(typeof mod.appendChangelogEntry).toBe('function');
  });

  it('appendChangelogEntry does not throw', async () => {
    const mod = await import('./aiChangelog.js');
    expect(() => mod.appendChangelogEntry(
      'prop_001', 'ai.ts', 'Test improvement', 'Better performance',
      'refactor', 'medium', 0.85, 'old code', 'new code', []
    )).not.toThrow();
  });

  it('appendChangelogEntry writes to filesystem', async () => {
    const fs = await import('fs');
    const mod = await import('./aiChangelog.js');
    mod.appendChangelogEntry(
      'prop_002', 'grounding.ts', 'Add null check', 'Prevent crash',
      'bugfix', 'high', 0.9, 'if (x)', 'if (x !== null)', []
    );
    const writeCalls = (fs.default.appendFileSync as any).mock.calls.length +
                       (fs.default.writeFileSync as any).mock.calls.length;
    expect(writeCalls).toBeGreaterThan(0);
  });
});
