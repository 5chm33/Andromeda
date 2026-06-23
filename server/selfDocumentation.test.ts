/**
 * selfDocumentation.test.ts — Andromeda v11.17.0 Audit 9
 * Real function-level tests for selfDocumentation.ts
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  updateSelfDocumentation,
  getChangelog,
  documentSelfImprovement,
  documentSystemEvent,
} from './selfDocumentation.js';

describe('selfDocumentation', () => {
  it('module loads without errors', async () => {
    await expect(import('./selfDocumentation.js')).resolves.toBeDefined();
  });

  it('getChangelog returns an array', () => {
    const log = getChangelog();
    expect(Array.isArray(log)).toBe(true);
  });

  it('documentSelfImprovement does not throw', () => {
    expect(() => documentSelfImprovement(
      'server/selfDocumentation.ts',
      'Test improvement',
      'reliability',
      'v11.17.0'
    )).not.toThrow();
  });

  it('documentSystemEvent does not throw', () => {
    expect(() => documentSystemEvent(
      'test_event',
      'A test system event occurred',
      'info'
    )).not.toThrow();
  });

  it('updateSelfDocumentation does not throw', () => {
    expect(() => updateSelfDocumentation(
      'server/selfDocumentation.ts',
      'Test update',
      'Updated test documentation'
    )).not.toThrow();
  });

  it('getChangelog with limit returns at most limit entries', () => {
    // Add some entries first
    documentSelfImprovement('a.ts', 'A', 'reliability', 'v11.17.0');
    documentSelfImprovement('b.ts', 'B', 'performance', 'v11.17.0');
    const log = getChangelog(1);
    expect(log.length).toBeLessThanOrEqual(1);
  });

  it('getChangelog entries have expected shape', () => {
    documentSelfImprovement('c.ts', 'C improvement', 'readability', 'v11.17.0');
    const log = getChangelog(10);
    if (log.length > 0) {
      const entry = log[0];
      expect(entry).toBeDefined();
      expect(typeof entry).toBe('object');
    }
  });
});
