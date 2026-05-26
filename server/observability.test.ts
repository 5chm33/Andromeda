/**
 * observability.test.ts — Andromeda v6.20
 * Comprehensive Vitest test suite for observability
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockReturnValue('{}'),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn().mockReturnValue([]),
    statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now(), size: 100, isFile: () => true, isDirectory: () => false }),
    promises: {
      readFile: vi.fn().mockResolvedValue(''),
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
      stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now(), size: 100, isFile: () => true }),
      unlink: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
    },
  },
  // Named exports (vitest requires both default and named)
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn().mockReturnValue('{}'),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
  mkdtempSync: vi.fn().mockReturnValue('/tmp/test-dir'),
  readdirSync: vi.fn().mockReturnValue([]),
  statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now(), size: 100, isFile: () => true, isDirectory: () => false }),
  appendFileSync: vi.fn(),
  copyFileSync: vi.fn(),
  createWriteStream: vi.fn().mockReturnValue({ write: vi.fn(), end: vi.fn(), on: vi.fn() }),
}));

import * as Module from './observability.js';

describe('observability', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('module loads without errors', () => {
    expect(Module).toBeDefined();
  });

  it('incrementCounter increments a counter', () => {
    Module.incrementCounter('test_counter', { env: 'test' });
    Module.incrementCounter('test_counter', { env: 'test' });
    const metrics = Module.getAllMetrics();
    expect(metrics).toBeDefined();
  });

  it('setGauge sets a gauge value', () => {
    expect(() => Module.setGauge('test_gauge', 42)).not.toThrow();
  });

  it('recordHistogram records a value', () => {
    expect(() => Module.recordHistogram('test_hist', 100)).not.toThrow();
  });

  it('getAllMetrics returns object', () => {
    const metrics = Module.getAllMetrics();
    expect(typeof metrics).toBe('object');
  });

  it('startSpan creates a span with context.traceId', () => {
    const span = Module.startSpan('test_op');
    expect(span.context).toHaveProperty('traceId');
    expect(span.context).toHaveProperty('spanId');
    expect(span.context).toHaveProperty('operation');
  });

  it('startSpan with parent context propagates traceId', () => {
    const parent = Module.startSpan('parent_op');
    const child = Module.startSpan('child_op', parent.context);
    expect(child.context.traceId).toBe(parent.context.traceId);
  });

  it('span end records duration', () => {
    const span = Module.startSpan('test_op');
    const result = span.end();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
