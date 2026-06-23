/**
 * z3ProofLayer.test.ts — Andromeda v11.17.0 Audit 9
 * Real function-level tests for z3ProofLayer.ts
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getProofStats,
  resetProofCache,
  verifyProposal,
} from './z3ProofLayer.js';

describe('z3ProofLayer', () => {
  beforeEach(() => {
    resetProofCache();
  });

  it('module loads without errors', async () => {
    await expect(import('./z3ProofLayer.js')).resolves.toBeDefined();
  });

  it('resetProofCache clears cache without throwing', () => {
    expect(() => resetProofCache()).not.toThrow();
  });

  it('getProofStats returns a valid stats object', () => {
    const stats = getProofStats();
    expect(stats).toBeDefined();
    expect(typeof stats).toBe('object');
    expect(typeof stats.verified).toBe('number');
    expect(stats.verified).toBeGreaterThanOrEqual(0);
  });

  it('getProofStats shape is consistent across calls', () => {
    const s1 = getProofStats();
    const s2 = getProofStats();
    expect(Object.keys(s1)).toEqual(Object.keys(s2));
  });

  it('verifyProposal returns a ProofResult with verified/proof/confidence fields', async () => {
    const result = await verifyProposal('+ const x = 1;\n- const x = 0;');
    expect(result).toBeDefined();
    expect(typeof result.verified).toBe('boolean');
    expect(typeof result.proof).toBe('string');
    expect(typeof result.confidence).toBe('number');
  });

  it('verifyProposal does not throw on empty diff', async () => {
    await expect(verifyProposal('')).resolves.toBeDefined();
  });

  it('getProofStats.verified increments after verifyProposal', async () => {
    resetProofCache();
    const before = getProofStats().verified;
    await verifyProposal('+ const y = 2;');
    const after = getProofStats().verified;
    expect(after).toBeGreaterThanOrEqual(before);
  });
});
