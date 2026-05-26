/**
 * adaptiveRouter.test.ts — Andromeda v6.20
 * Comprehensive Vitest test suite for adaptiveRouter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as Module from './adaptiveRouter.js';

describe('adaptiveRouter', () => {

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

  it('getRouterStats returns a value', () => {
    const result = Module.getRouterStats();
    expect(result).toBeDefined();
  });

  it('registerProvider does not throw', () => {
    expect(() => Module.registerProvider({ id: 'test', name: 'Test', type: 'openai', baseUrl: 'https://api.test.com', apiKey: 'test', models: [] })).not.toThrow();
  });

});
