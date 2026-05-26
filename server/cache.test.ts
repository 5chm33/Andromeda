/**
 * cache.test.ts — Andromeda v6.20
 * Comprehensive Vitest test suite for cache
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as Module from './cache.js';

describe('cache', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('module loads without errors', () => {
    expect(Module).toBeDefined();
  });

  it('log does not throw for valid log levels', () => {
    expect(() => Module.log('info', 'test', 'test message')).not.toThrow();
    expect(() => Module.log('warn', 'test', 'warning')).not.toThrow();
    expect(() => Module.log('error', 'test', 'error')).not.toThrow();
  });

  it('getRecentLogs returns array', () => {
    Module.log('info', 'test', 'message 1');
    const logs = Module.getRecentLogs(10);
    expect(Array.isArray(logs)).toBe(true);
  });

  it('setLogLevel changes log level', () => {
    expect(() => Module.setLogLevel('debug')).not.toThrow();
    expect(Module.getLogLevel()).toBe('debug');
  });

  it('searchCacheKey returns consistent key for same inputs', () => {
    const key1 = Module.searchCacheKey('test query', 'gpt-4');
    const key2 = Module.searchCacheKey('test query', 'gpt-4');
    expect(key1).toBe(key2);
  });

  it('aiCacheKey returns consistent key for same messages', () => {
    const msgs = [{ role: 'user', content: 'hello' }];
    const key1 = Module.aiCacheKey(msgs);
    const key2 = Module.aiCacheKey(msgs);
    expect(key1).toBe(key2);
  });
});
