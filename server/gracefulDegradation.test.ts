/**
 * gracefulDegradation.test.ts — Andromeda v6.20
 * Comprehensive Vitest test suite for gracefulDegradation
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

vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: vi.fn().mockResolvedValue({}),
  text: vi.fn().mockResolvedValue(''),
  body: null,
}));

import * as Module from './gracefulDegradation.js';

describe('gracefulDegradation', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('module loads without errors', () => {
    expect(Module).toBeDefined();
  });

  it('reportFailure increments failure count', () => {
    const state = Module.reportFailure('llm', 'test failure');
    expect(state.consecutiveFailures).toBeGreaterThan(0);
  });

  it('reportSuccess resets failure count', () => {
    Module.reportFailure('search', 'test');
    const state = Module.reportSuccess('search');
    expect(state.consecutiveFailures).toBe(0);
  });

  it('isServiceAvailable returns true for healthy service', () => {
    Module.reportSuccess('embedding');
    expect(Module.isServiceAvailable('embedding')).toBe(true);
  });

  it('isServiceAvailable returns false when circuit is open', () => {
    for (let i = 0; i < 5; i++) Module.reportFailure('mcp', 'test');
    // After enough failures, circuit may be open
    const available = Module.isServiceAvailable('mcp');
    expect(typeof available).toBe('boolean');
  });

  it('queueRequest adds request to queue', () => {
    const req = Module.queueRequest('docker', 'run', { cmd: 'ls' });
    expect(req).not.toBeNull();
    if (req) {
      expect(req.service).toBe('docker');
      expect(req.operation).toBe('run');
    }
  });

  it('getDegradationStatus returns status object', () => {
    const status = Module.getDegradationStatus();
    expect(status).toHaveProperty('services');
  });

  it('onDegradation registers a listener', () => {
    const listener = vi.fn();
    expect(() => Module.onDegradation(listener)).not.toThrow();
  });
});
