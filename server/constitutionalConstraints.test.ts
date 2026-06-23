/**
 * constitutionalConstraints.test.ts — Andromeda v11.17.0 Audit 9
 * Real function-level tests for constitutionalConstraints.ts
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkConstitution,
  getConstitutionRules,
  addConstitutionRule,
  resetConstitutionRules,
} from './constitutionalConstraints.js';

describe('constitutionalConstraints', () => {
  beforeEach(() => {
    resetConstitutionRules();
  });

  it('module loads without errors', async () => {
    await expect(import('./constitutionalConstraints.js')).resolves.toBeDefined();
  });

  it('resetConstitutionRules resets to DEFAULT_RULES (9 rules)', () => {
    addConstitutionRule('EXTRA RULE');
    resetConstitutionRules();
    const rules = getConstitutionRules();
    // DEFAULT_RULES has 9 entries
    expect(rules.length).toBe(9);
  });

  it('addConstitutionRule adds a rule on top of defaults', () => {
    addConstitutionRule('NEVER delete production data');
    const rules = getConstitutionRules();
    expect(rules.some(r => r.includes('production data'))).toBe(true);
    expect(rules.length).toBe(10); // 9 defaults + 1 new
  });

  it('getConstitutionRules returns an array', () => {
    const rules = getConstitutionRules();
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
  });

  it('checkConstitution passes for a benign proposal', () => {
    const result = checkConstitution({
      diff: '+ const x = 1;',
      targetFile: 'server/utils.ts',
      description: 'Increment constant',
    });
    expect(result).toBeDefined();
    expect(typeof result.allowed).toBe('boolean');
    expect(Array.isArray(result.violations)).toBe(true);
  });

  it('checkConstitution returns a score between 0 and 1', () => {
    const result = checkConstitution({
      diff: '+ const x = 1;',
      targetFile: 'server/utils.ts',
      description: 'Safe change',
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('multiple rules can be added and retrieved (on top of defaults)', () => {
    resetConstitutionRules();
    addConstitutionRule('Rule A');
    addConstitutionRule('Rule B');
    addConstitutionRule('Rule C');
    const rules = getConstitutionRules();
    // 9 defaults + 3 new
    expect(rules.length).toBe(12);
  });
});
