/**
 * adaptiveEval.test.ts — Andromeda v9.6.0
 * Tests for the adaptive eval suite
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

vi.mock('./llmProvider.js', () => ({
  simpleChatCompletion: vi.fn().mockResolvedValue(JSON.stringify([{
    id: 'test_001',
    category: 'reasoning',
    difficulty: 'easy',
    prompt: 'Test prompt',
    expectedKeywords: ['answer'],
    forbiddenKeywords: [],
  }])),
  backgroundSimpleCompletion: vi.fn().mockResolvedValue('mocked'),
}));

vi.mock('./evalSeed.js', () => ({
  seedAdaptiveBenchmarks: vi.fn(),
}));

describe('adaptiveEval', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('module loads without error', async () => {
    const mod = await import('./adaptiveEval.js');
    expect(mod).toBeDefined();
  });

  it('exports initAdaptiveEval function', async () => {
    const mod = await import('./adaptiveEval.js');
    expect(typeof mod.initAdaptiveEval).toBe('function');
  });

  it('exports runAdaptiveEval function', async () => {
    const mod = await import('./adaptiveEval.js');
    expect(typeof mod.runAdaptiveEval).toBe('function');
  });

  it('exports evolveBenchmarks function', async () => {
    const mod = await import('./adaptiveEval.js');
    expect(typeof mod.evolveBenchmarks).toBe('function');
  });

  it('exports getBenchmarkEvolutionStats function', async () => {
    const mod = await import('./adaptiveEval.js');
    expect(typeof mod.getBenchmarkEvolutionStats).toBe('function');
  });

  it('exports getLatestGapAnalysis function', async () => {
    const mod = await import('./adaptiveEval.js');
    expect(typeof mod.getLatestGapAnalysis).toBe('function');
  });

  it('initAdaptiveEval does not throw', async () => {
    const mod = await import('./adaptiveEval.js');
    expect(() => mod.initAdaptiveEval()).not.toThrow();
  });

  it('getBenchmarkEvolutionStats returns valid shape', async () => {
    const mod = await import('./adaptiveEval.js');
    mod.initAdaptiveEval();
    const stats = mod.getBenchmarkEvolutionStats();
    expect(typeof stats.totalGenerated).toBe('number');
    expect(typeof stats.active).toBe('number');
    expect(typeof stats.avgPassRate).toBe('number');
  });

  it('getLatestGapAnalysis returns valid shape', async () => {
    const mod = await import('./adaptiveEval.js');
    mod.initAdaptiveEval();
    const gap = mod.getLatestGapAnalysis();
    expect(typeof gap.overallPassRate).toBe('number');
    expect(typeof gap.weakestCategory).toBe('string');
    expect(typeof gap.categoryPassRates).toBe('object');
  });

  it('evolveBenchmarks returns retired and promoted arrays', async () => {
    const mod = await import('./adaptiveEval.js');
    const result = mod.evolveBenchmarks([]);
    expect(Array.isArray(result.retired)).toBe(true);
    expect(Array.isArray(result.promoted)).toBe(true);
  });
});
