/**
 * ciRegressionGuard.test.ts — Andromeda v11.16.0 Audit 8
 * Real function-level tests for ciRegressionGuard.ts
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordMetrics, checkForRegressions, resetRegressionGuard,
  getMetricHistory, getRegressionGuardStatus,
} from './ciRegressionGuard';

describe('ciRegressionGuard', () => {
  beforeEach(() => {
    resetRegressionGuard();
  });

  it('should detect regressions', () => {
    recordMetrics('cycle1', { score: 100 });
    recordMetrics('cycle2', { score: 90 });
    const result = checkForRegressions('cycle2');
    expect(result.hasRegression).toBe(true);
    expect(result.regressions.length).toBe(1);
  });

  it('should not flag improvements', () => {
    recordMetrics('cycle1', { score: 90 });
    recordMetrics('cycle2', { score: 100 });
    const result = checkForRegressions('cycle2');
    expect(result.hasRegression).toBe(false);
    expect(result.regressions.length).toBe(0);
  });

  it('getMetricHistory returns object with recorded metrics', () => {
    recordMetrics('cycle1', { accuracy: 0.9, latency: 100 });
    const history = getMetricHistory();
    expect(typeof history).toBe('object');
    expect(history['accuracy']).toBeDefined();
  });

  it('getRegressionGuardStatus returns status object', () => {
    const status = getRegressionGuardStatus();
    expect(status).toBeDefined();
    expect(typeof status).toBe('object');
  });

  it('resetRegressionGuard clears all metrics', () => {
    recordMetrics('cycle1', { score: 100 });
    resetRegressionGuard();
    const history = getMetricHistory();
    expect(Object.keys(history).length).toBe(0);
  });

  it('no regression when only one data point', () => {
    recordMetrics('cycle1', { score: 80 });
    const result = checkForRegressions('cycle1');
    expect(result.hasRegression).toBe(false);
  });
});
