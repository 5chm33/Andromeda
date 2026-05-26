/**
 * circuitBreaker.test.ts — Andromeda v6.20
 * Comprehensive Vitest test suite for circuitBreaker
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as Module from './circuitBreaker.js';

describe('circuitBreaker', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('module loads without errors', () => {
    expect(Module).toBeDefined();
  });

  it('CircuitBreaker initializes in closed state', () => {
    const cb = new Module.CircuitBreaker('test', { failureThreshold: 3, resetTimeoutMs: 1000 });
    expect(cb.getStats().state).toBe('closed');
  });

  it('CircuitBreaker opens after threshold failures', async () => {
    const cb = new Module.CircuitBreaker('test-open-' + Date.now(), { failureThreshold: 3, resetTimeoutMs: 60000 });
    const failFn = vi.fn().mockRejectedValue(new Error('fail'));
    for (let i = 0; i < 3; i++) await cb.execute(failFn).catch(() => {});
    expect(cb.getStats().state).toBe('open');
  });

  it('CircuitBreaker getStats returns stats object', () => {
    const cb = new Module.CircuitBreaker('test-stats', { failureThreshold: 3, resetTimeoutMs: 1000 });
    const stats = cb.getStats();
    expect(stats).toHaveProperty('state');
    expect(stats).toHaveProperty('totalRequests');
  });

  it('getCircuitBreaker returns same instance for same name', () => {
    const cb1 = Module.getCircuitBreaker('svc1');
    const cb2 = Module.getCircuitBreaker('svc1');
    expect(cb1).toBe(cb2);
  });

  it('CircuitBreaker execute runs fn when closed', async () => {
    const cb = new Module.CircuitBreaker('test', { failureThreshold: 3, resetTimeoutMs: 1000 });
    const fn = vi.fn().mockResolvedValue('result');
    const result = await cb.execute(fn);
    expect(result).toBe('result');
  });

  it('CircuitBreaker execute throws CircuitOpenError when open', async () => {
    const cb = new Module.CircuitBreaker('test-throws-' + Date.now(), { failureThreshold: 2, resetTimeoutMs: 60000 });
    const failFn = vi.fn().mockRejectedValue(new Error('fail'));
    for (let i = 0; i < 2; i++) await cb.execute(failFn).catch(() => {});
    // Now circuit is open - next call should throw
    await expect(cb.execute(async () => 'x')).rejects.toThrow();
  });

  it('getAllCircuitBreakerStats returns record', () => {
    const stats = Module.getAllCircuitBreakerStats();
    expect(typeof stats).toBe('object');
  });
});
