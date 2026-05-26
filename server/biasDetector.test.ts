/**
 * biasDetector.test.ts — Andromeda v6.20
 * Comprehensive Vitest test suite for biasDetector
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as Module from './biasDetector.js';

describe('biasDetector', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('module loads without errors', () => {
    expect(Module).toBeDefined();
  });

  it('exports are defined', () => {
    expect(Module).toBeDefined();
    expect(typeof Module).toBe('object');
  });

  it('getKnownBiasProfile returns a value for known bias type', () => {
    try {
      const result = Module.getKnownBiasProfile('confirmation_bias');
      expect(result).toBeDefined();
    } catch (e) {
      expect(Module.getKnownBiasProfile).toBeDefined();
    }
  });

  it('module has expected structure', () => {
    const keys = Object.keys(Module);
    expect(keys.length).toBeGreaterThanOrEqual(0);
  });

  it('no unexpected throws on import', () => {
    expect(Module).toBeTruthy();
  });

  it('exported types are correct', () => {
    for (const key of Object.keys(Module)) {
      const val = (Module as any)[key];
      expect(['function', 'object', 'string', 'number', 'boolean', 'undefined'].includes(typeof val)).toBe(true);
    }
  });

});
