/**
 * systemMemory.test.ts — Andromeda v11.17.0 Audit 9
 * Real function-level tests for systemMemory.ts
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordSystemLearning,
  queryLearnings,
  updateBaseline,
  getBaselines,
  getDegradingMetrics,
  recordErrorPattern,
  findResolution,
  consolidateMemory,
} from './systemMemory.js';

describe('systemMemory', () => {
  it('module loads without errors', async () => {
    await expect(import('./systemMemory.js')).resolves.toBeDefined();
  });

  it('recordSystemLearning stores a learning entry', () => {
    expect(() => recordSystemLearning({
      title: 'Test learning',
      description: 'A test learning entry',
      lesson: 'Always test your code',
      outcome: 'success',
      category: 'testing',
      context: 'systemMemory.test.ts',
      confidence: 0.9,
      applicableTo: ['systemMemory.ts'],
    })).not.toThrow();
  });

  it('queryLearnings returns an array', () => {
    const results = queryLearnings({ context: 'systemMemory.test.ts' });
    expect(Array.isArray(results)).toBe(true);
  });

  it('updateBaseline records a metric and getBaselines retrieves it', () => {
    updateBaseline('test_metric', 'systemMemory.test.ts', 0.75);
    const baselines = getBaselines('systemMemory.test.ts');
    expect(Array.isArray(baselines)).toBe(true);
    const found = baselines.find(b => b.metric === 'test_metric');
    expect(found).toBeDefined();
    expect(found?.current).toBe(0.75);
  });

  it('getDegradingMetrics returns an array', () => {
    const degrading = getDegradingMetrics();
    expect(Array.isArray(degrading)).toBe(true);
    // All returned entries should have trend=degrading
    for (const b of degrading) {
      expect(b.trend).toBe('degrading');
    }
  });

  it('recordErrorPattern and findResolution round-trip', () => {
    recordErrorPattern({
      pattern: 'UNIQUE_TEST_ERROR_PATTERN_9999',
      resolution: 'Apply the unique test fix',
      module: 'systemMemory.test.ts',
    });
    const resolved = findResolution('UNIQUE_TEST_ERROR_PATTERN_9999', 'systemMemory.test.ts');
    expect(resolved).not.toBeNull();
    expect(resolved?.resolution).toBe('Apply the unique test fix');
  });

  it('findResolution returns null for unknown error', () => {
    const result = findResolution('COMPLETELY_UNKNOWN_ERROR_XYZ_12345');
    expect(result).toBeNull();
  });

  it('consolidateMemory returns merged/removed counts', () => {
    const result = consolidateMemory();
    expect(typeof result.merged).toBe('number');
    expect(typeof result.removed).toBe('number');
    expect(result.merged).toBeGreaterThanOrEqual(0);
  });
});
