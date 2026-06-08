/**
 * evalSeed.test.ts — Andromeda v9.6.0
 * Tests for the adaptive eval suite seed data
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue('[]'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('[]'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path');
  return { ...actual, default: actual };
});

describe('evalSeed', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('module loads without error', async () => {
    const mod = await import('./evalSeed.js');
    expect(mod).toBeDefined();
  });

  it('exports SEED_BENCHMARKS array', async () => {
    const mod = await import('./evalSeed.js');
    expect(Array.isArray(mod.SEED_BENCHMARKS)).toBe(true);
  });

  it('has exactly 20 seed benchmarks', async () => {
    const mod = await import('./evalSeed.js');
    expect(mod.SEED_BENCHMARKS.length).toBe(20);
  });

  it('covers all 6 categories', async () => {
    const mod = await import('./evalSeed.js');
    const categories = new Set(mod.SEED_BENCHMARKS.map((b: any) => b.category));
    expect(categories.has('reasoning')).toBe(true);
    expect(categories.has('code')).toBe(true);
    expect(categories.has('tool_use')).toBe(true);
    expect(categories.has('self_knowledge')).toBe(true);
    expect(categories.has('multi_step')).toBe(true);
    expect(categories.has('browser')).toBe(true);
  });

  it('all benchmarks have required fields', async () => {
    const mod = await import('./evalSeed.js');
    for (const b of mod.SEED_BENCHMARKS) {
      expect(b.id).toBeTruthy();
      expect(b.category).toBeTruthy();
      expect(b.difficulty).toBeTruthy();
      expect(b.prompt).toBeTruthy();
      expect(Array.isArray(b.expectedKeywords)).toBe(true);
      expect(b.lifecycle).toBe('active');
      expect(b.source).toBe('gap_analysis');
    }
  });

  it('all benchmark IDs are unique', async () => {
    const mod = await import('./evalSeed.js');
    const ids = mod.SEED_BENCHMARKS.map((b: any) => b.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('exports seedAdaptiveBenchmarks function', async () => {
    const mod = await import('./evalSeed.js');
    expect(typeof mod.seedAdaptiveBenchmarks).toBe('function');
  });

  it('seedAdaptiveBenchmarks writes benchmarks when file is empty', async () => {
    const fs = await import('fs');
    const mod = await import('./evalSeed.js');
    mod.seedAdaptiveBenchmarks();
    expect((fs.default.writeFileSync as any).mock.calls.length).toBeGreaterThan(0);
  });

  it('seedAdaptiveBenchmarks skips when benchmarks already exist', async () => {
    const fs = await import('fs');
    (fs.default.existsSync as any).mockReturnValue(true);
    (fs.default.readFileSync as any).mockReturnValue(JSON.stringify([{ id: 'existing' }]));
    const mod = await import('./evalSeed.js');
    vi.clearAllMocks();
    mod.seedAdaptiveBenchmarks();
    expect((fs.default.writeFileSync as any).mock.calls.length).toBe(0);
  });
});
