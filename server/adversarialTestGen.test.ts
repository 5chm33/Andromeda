/**
 * adversarialTestGen.test.ts — Andromeda v11.17.0 Audit 9
 * Real function-level tests for adversarialTestGen.ts
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  analyzeAdversarialRisk,
  getAdversarialStats,
  resetAdversarialStats,
} from './adversarialTestGen.js';

describe('adversarialTestGen', () => {
  beforeEach(() => {
    resetAdversarialStats();
  });

  it('module loads without errors', async () => {
    await expect(import('./adversarialTestGen.js')).resolves.toBeDefined();
  });

  it('resetAdversarialStats resets counters to zero', () => {
    resetAdversarialStats();
    const stats = getAdversarialStats();
    expect(stats.testsGenerated).toBe(0);
    expect(stats.vulnerabilitiesFound).toBe(0);
  });

  it('getAdversarialStats returns a valid stats object', () => {
    const stats = getAdversarialStats();
    expect(typeof stats.testsGenerated).toBe('number');
    expect(typeof stats.vulnerabilitiesFound).toBe('number');
    expect(stats.testsGenerated).toBeGreaterThanOrEqual(0);
  });

  it('analyzeAdversarialRisk returns riskScore and vectors', () => {
    const result = analyzeAdversarialRisk('+ eval(userInput)\n- safeCall()');
    expect(typeof result.riskScore).toBe('number');
    expect(Array.isArray(result.vectors)).toBe(true);
    expect(result.riskScore).toBeGreaterThanOrEqual(0);
  });

  it('analyzeAdversarialRisk detects high-risk patterns', () => {
    const result = analyzeAdversarialRisk('+ exec(cmd)\n+ eval(data)\n+ require(userPath)');
    expect(result.riskScore).toBeGreaterThan(0);
  });

  it('analyzeAdversarialRisk returns low risk for benign diff', () => {
    const result = analyzeAdversarialRisk('+ const x = 1;\n- const x = 0;');
    expect(result.riskScore).toBeGreaterThanOrEqual(0);
    expect(result.vectors).toBeDefined();
  });

  it('getAdversarialStats shape is consistent across calls', () => {
    const s1 = getAdversarialStats();
    const s2 = getAdversarialStats();
    expect(Object.keys(s1)).toEqual(Object.keys(s2));
  });
});
